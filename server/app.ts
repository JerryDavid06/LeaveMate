import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import cors from 'cors';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { Server } from 'socket.io';
import { z } from 'zod';
import { images, type DepartureEvent, type ServerEvents } from '../shared/contracts.js';
import { Notifications, type Publish } from './alerts.js';
import { Database } from './database.js';
import { GatewayDetectionProvider, SimulationDetectionProvider } from './detection.js';
import { AppError, VerificationEngine } from './verification.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const uuid = z.uuid();
const itemInput = z.strictObject({
  name: text(100), category: text(60), description: z.string().trim().max(500),
  priority: z.enum(['essential', 'optional']), monitoring: z.boolean(),
  identifier: text(120).nullable(), imageOverride: z.enum(images).nullable(),
});
const settingsInput = z.strictObject({
  timeoutSeconds: z.number().int().min(1).max(60), timeFormat: z.enum(['12h','24h']),
  dateFormat: z.enum(['short','iso','day-first']), voiceEnabled: z.boolean(),
  voiceSelection: z.string().max(200), speechRate: z.number().min(0.5).max(2),
  voiceVolume: z.number().min(0).max(1), repeatVoice: z.boolean(),
  browserNotifications: z.boolean(), simulationMode: z.boolean(),
});

function matches(candidate: unknown, secret: string) {
  if (typeof candidate !== 'string') return false;
  const received = Buffer.from(candidate);
  const expected = Buffer.from(secret);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function createApp(database: Database, config: {
  origin?: string; deviceKey?: string; trustProxy?: boolean; staticDir?: string;
} = {}) {
  await database.recoverInterrupted();
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  const http = createServer(app);
  const acceptsOrigin = (origin: string | undefined) =>
    !origin || (config.origin ? origin === config.origin : /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  const origin = (requestOrigin: string | undefined, done: (error: Error | null, allowed?: boolean) => void) =>
    done(null, acceptsOrigin(requestOrigin));
  const io = new Server<Record<never, never>, ServerEvents>(http, {
    cors: { origin, methods: ['GET','POST'] },
    allowRequest: (request, done) => done(null, acceptsOrigin(request.headers.origin)),
    maxHttpBufferSize: 8192,
  });
  const publish: Publish = (event, ...args) => { io.emit(event, ...args); };
  const engine = new VerificationEngine(database, new Notifications(publish));
  let window: { provider: GatewayDetectionProvider; event: DepartureEvent } | null = null;

  app.use(helmet(), cors({ origin }), express.json({ limit: '32kb' }));
  if (config.staticDir) app.use(express.static(config.staticDir));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!acceptsOrigin(req.get('origin'))) return next(new AppError(403, 'This browser origin is not allowed.'));
    next();
  });
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many requests. Try again shortly.' } }));
  app.get('/api/health', async (_req, res) => {
    try {
      await database.health();
      res.json({ status: 'healthy' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  const deviceAuth: RequestHandler = (req, _res, next) => {
    if (!config.deviceKey) return next(new AppError(503, 'The device gateway is disabled.'));
    if (!matches(req.get('x-device-key'), config.deviceKey)) return next(new AppError(401, 'Invalid device credentials.'));
    next();
  };
  app.use('/api/gateway', deviceAuth);
  app.post('/api/gateway/heartbeat', async (req, res) => {
    const { deviceId } = z.strictObject({ deviceId: text(120) }).parse(req.body);
    await database.touchDevice(deviceId);
    publish('device_status_updated');
    res.status(204).end();
  });
  app.post('/api/gateway/departures', async (req, res) => {
    const event = z.strictObject({
      id: uuid, eventType: z.literal('DEPARTURE_DETECTED'), source: z.literal('hardware'),
      timestamp: z.iso.datetime({ offset: true }), deviceId: text(120),
    }).parse(req.body);
    const provider = new GatewayDetectionProvider();
    await database.touchDevice(event.deviceId);
    publish('device_status_updated');
    const progress = await engine.departure(event, provider);
    window = { provider, event };
    res.status(202).json(progress);
  });
  app.post('/api/gateway/departures/:id/reports', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const report = z.strictObject({
      identifiers: z.array(text(120)).max(300), complete: z.boolean(), requireInWindow: z.boolean().optional(),
    }).parse(req.body);
    if (!window || window.event.id !== id || engine.progress?.id !== id || !window.provider.report(report)) {
      throw new AppError(409, 'This detection window is unavailable.');
    }
    res.status(204).end();
  });

  app.get('/api/state', async (_req, res) => res.json(await database.snapshot()));
  app.get('/api/detection', (_req, res) => res.json({ progress: engine.progress, error: engine.lastError }));

  app.post('/api/items', async (req, res) => {
    const item = await database.saveItem(itemInput.parse(req.body));
    publish('state_changed');
    res.status(201).json(item);
  });
  app.put('/api/items/:id', async (req, res) => {
    const item = await database.saveItem(itemInput.parse(req.body), uuid.parse(req.params.id));
    if (!item) throw new AppError(404, 'Belonging not found.');
    publish('state_changed');
    res.json(item);
  });
  app.delete('/api/items/:id', async (req, res) => {
    if (!await database.deleteItem(uuid.parse(req.params.id))) throw new AppError(404, 'Belonging not found.');
    publish('state_changed');
    res.status(204).end();
  });
  app.put('/api/settings', async (req, res) => {
    await database.saveSettings(settingsInput.parse(req.body));
    publish('state_changed');
    res.status(204).end();
  });
  app.post('/api/simulation', rateLimit({ windowMs: 60_000, limit: 30, message: { error: 'Simulation limit reached. Try again in a minute.' } }), async (req, res) => {
    const { detectedIds } = z.strictObject({ detectedIds: z.array(uuid).max(500) }).parse(req.body);
    const event: DepartureEvent = {
      id: randomUUID(), eventType: 'DEPARTURE_DETECTED', source: 'simulation',
      timestamp: new Date().toISOString(), deviceId: null,
    };
    res.status(202).json(await engine.departure(event, new SimulationDetectionProvider(detectedIds)));
  });
  app.post('/api/alerts/read-all', async (_req, res) => {
    await database.markAllRead();
    publish('state_changed');
    res.status(204).end();
  });
  app.post('/api/alerts/:id/:action', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const action = z.enum(['read', 'acknowledge']).parse(req.params.action);
    if (!await database.changeAlert(id, action === 'acknowledge')) throw new AppError(404, 'Alert not found.');
    if (action === 'acknowledge') publish('alert_acknowledged', id);
    publish('state_changed');
    res.status(204).end();
  });

  app.use((_req, _res, next) => next(new AppError(404, 'Endpoint not found.')));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues.map((issue) => [issue.path.join('.'), issue.message].filter(Boolean).join(': ')).join('. ') });
    } else if (error instanceof AppError) {
      res.status(error.status).json({ error: error.message });
    } else if (error.code === '23505') {
      res.status(409).json({ error: 'That detection identifier is already in use.' });
    } else if (error.status === 400 || error.status === 413) {
      res.status(error.status).json({ error: 'Invalid or oversized request body.' });
    } else {
      console.error('API request failed', { code: error.code ?? error.name });
      res.status(500).json({ error: 'LeaveMate could not complete the request.' });
    }
  };
  app.use(errors);
  return { http, io, engine };
}
