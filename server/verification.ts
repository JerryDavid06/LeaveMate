import { setTimeout as pause } from 'node:timers/promises';
import type { DepartureEvent, DetectionProgress, Item, Result, Session } from '../shared/contracts.js';
import { createAlert, Notifications } from './alerts.js';
import { Database } from './database.js';
import type { DetectionProvider } from './detection.js';

export class AppError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function snapshotItem(item: Item): Omit<Result, 'status' | 'detectedAt'> {
  return { itemId: item.id, name: item.name, category: item.category, priority: item.priority, image: item.image };
}

export function compare(expected: DetectionProgress['expected'], detected: ReadonlyMap<string, string>): Result[] {
  return expected.map((item) => {
    const detectedAt = detected.get(item.itemId) ?? null;
    return { ...item, status: detectedAt ? 'detected' : 'missing', detectedAt };
  });
}

export class VerificationEngine {
  private active: DetectionProgress | null = null;
  private reserved = false;
  private running: Promise<void> | undefined;
  lastError: string | null = null;

  constructor(private readonly database: Database, private readonly notifications: Notifications) {}

  get progress() { return this.active; }
  async drain() { await this.running; }

  async departure(event: DepartureEvent, provider: DetectionProvider) {
    if (this.reserved) throw new AppError(409, 'A verification is already running.');
    this.reserved = true;
    try {
      const items = (await this.database.items()).filter((item) => item.monitoring);
      if (!items.length) throw new AppError(422, 'Enable monitoring for at least one belonging first.');
      const settings = await this.database.settings();
      if (event.source === 'simulation' && !settings.simulationMode) throw new AppError(409, 'Simulation is disabled in Settings.');
      const startedAt = new Date().toISOString();
      const deadlineMs = Date.parse(startedAt) + settings.timeoutSeconds * 1000;
      if (!await this.database.begin(event, items.length, startedAt, settings.timeoutSeconds)) {
        throw new AppError(409, 'This departure event was already received.');
      }
      const progress: DetectionProgress = {
        id: event.id, source: event.source, startedAt, deadline: new Date(deadlineMs).toISOString(),
        expected: items.map(snapshotItem), detectedIds: [],
      };
      this.active = progress;
      this.lastError = null;
      this.notifications.publish('departure_detected', event);
      this.notifications.publish('detection_started', progress);
      this.running = this.run(event, provider, items, deadlineMs, progress);
      return progress;
    } catch (error) {
      this.reserved = false;
      throw error;
    }
  }

  private async run(event: DepartureEvent, provider: DetectionProvider, items: Item[], deadlineMs: number, progress: DetectionProgress) {
    try {
      const detected = await provider.collect({ event, deadlineMs, items }, (update) => {
        this.active = { ...progress, detectedIds: [...update.keys()] };
        this.notifications.publish('detection_updated', this.active);
      });
      if (Date.now() < deadlineMs) await pause(deadlineMs - Date.now());
      const results = compare(progress.expected, detected);
      const missing = results.filter((item) => item.status === 'missing').length;
      const session: Session = {
        id: event.id, source: event.source, status: missing ? 'incomplete' : 'successful', startedAt: progress.startedAt,
        completedAt: new Date().toISOString(), expected: results.length, detected: results.length - missing,
        missing, results, alertId: null, acknowledgedAt: null,
      };
      const alert = createAlert(session);
      session.alertId = alert?.id ?? null;
      await this.database.finish(session, alert);
      this.active = null;
      this.reserved = false;
      this.notifications.completed(session, alert);
    } catch (error) {
      await this.database.fail(event.id).catch(() => console.error('Could not record failed verification', { id: event.id }));
      this.active = null;
      this.reserved = false;
      this.lastError = error instanceof Error && error.message.startsWith('The provider')
        ? error.message : 'Verification could not be saved. Try another departure.';
      this.notifications.publish('verification_failed', { id: event.id, message: this.lastError });
    }
  }
}
