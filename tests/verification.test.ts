import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { test } from 'node:test';
import { io } from 'socket.io-client';
import type { Alert, DetectionProgress, Item, ItemInput, Session, Snapshot } from '../shared/contracts.js';
import { createApp } from '../server/app.js';
import { Database } from '../server/database.js';

test('item CRUD, validation, realtime simulation, alerts and durable history', async () => {
  const testRoot = resolve('.leavemate-tests');
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'run-'));
  const db = await Database.open({ localPath: directory });
  const app = await createApp(db, { deviceKey: 'test-device-key' });
  app.http.listen(0, '127.0.0.1');
  await once(app.http, 'listening');
  const address = app.http.address();
  assert(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  const socket = io(origin, { transports: ['websocket'], reconnection: false });
  const api = (path: string, method = 'GET', body?: unknown, headers?: Record<string, string>) => fetch(origin + '/api' + path, {
    method, headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  const item: ItemInput = {
    name: 'Wallet', category: 'Personal Belongings', description: '', identifier: 'generic-wallet', monitoring: true,
    priority: 'essential', imageOverride: null,
  };
  const state = async () => await (await api('/state')).json() as Snapshot;
  const add = async (patch: Partial<ItemInput>) => {
    const response = await api('/items', 'POST', { ...item, ...patch });
    assert.equal(response.status, 201, await response.clone().text());
    return await response.json() as Item;
  };
  try {
    await once(socket, 'connect', { signal: AbortSignal.timeout(5000) });
    assert.equal((await api('/health')).status, 200);
    assert.equal((await state()).device, null);
    assert.equal((await state()).sessions.length, 0);
    assert.equal((await state()).settings.timeoutSeconds, 5);
    assert.equal((await api('/items', 'POST', { name: '' })).status, 400);
    const wallet = await add({});
    const keys = await add({ name: 'Keys', category: 'Keys', priority: 'optional', identifier: 'generic-keys' });
    const laptop = await add({ name: 'Laptop', category: 'Electronics', monitoring: false, identifier: null });
    assert.equal(wallet.image, 'wallet');
    assert.equal(laptop.image, 'laptop');
    assert.equal(laptop.identifier, null);
    assert.equal((await api('/items', 'POST', item)).status, 409);
    assert.equal((await api('/items/' + wallet.id, 'PUT', { ...item, name: 'Travel wallet' })).status, 200);
    const preferences = { ...(await state()).settings, timeoutSeconds: 1 };
    assert.equal((await api('/settings', 'PUT', preferences)).status, 204);

    const [started, updated, completed, emitted] = [
      once(socket, 'detection_started'), once(socket, 'detection_updated'),
      once(socket, 'verification_completed'), once(socket, 'alert_created'),
    ];
    const launch = await api('/simulation', 'POST', { detectedIds: [laptop.id, randomUUID()] });
    assert.equal(launch.status, 202);
    const window = await launch.json() as DetectionProgress;
    assert.equal((await api('/simulation', 'POST', { detectedIds: [] })).status, 409);
    assert.equal((await started)[0].id, window.id);
    assert.equal((await updated)[0].id, window.id);
    assert.equal((await state()).sessions.length, 0);
    const session = (await completed)[0] as Session;
    const alert = (await emitted)[0] as Alert;
    assert.equal(session.expected, 2);
    assert.equal(session.detected, 0);
    assert.equal(session.missing, 2);
    assert.equal(session.status, 'incomplete');
    assert(Date.parse(session.completedAt) >= Date.parse(window.deadline));
    assert.equal(alert.priority, 'high');
    assert.match(alert.message, /wallet/i);
    assert.match(alert.message, /keys/i);
    assert.equal(alert.items.length, 2);

    assert.equal((await api('/alerts/' + alert.id + '/read', 'POST')).status, 204);
    assert.equal((await state()).alerts[0].acknowledgedAt, null);
    const ack = once(socket, 'alert_acknowledged');
    assert.equal((await api('/alerts/' + alert.id + '/acknowledge', 'POST')).status, 204);
    assert.equal((await ack)[0], alert.id);
    const acknowledgedAt = (await state()).alerts[0].acknowledgedAt;
    assert(acknowledgedAt);
    assert.equal((await api('/alerts/' + alert.id + '/acknowledge', 'POST')).status, 204);
    assert.equal((await state()).alerts[0].acknowledgedAt, acknowledgedAt);

    const allClear = once(socket, 'verification_completed');
    assert.equal((await api('/simulation', 'POST', { detectedIds: [wallet.id, keys.id] })).status, 202);
    assert.equal((await allClear)[0].status, 'successful');
    assert.equal((await state()).alerts.length, 1);

    const gateway = { 'x-device-key': 'test-device-key' };
    const event = { id: randomUUID(), eventType: 'DEPARTURE_DETECTED', source: 'hardware', timestamp: new Date().toISOString(), deviceId: 'test-door' };
    assert.equal((await api('/gateway/heartbeat', 'POST', { deviceId: 'test-door' })).status, 401);
    assert.equal((await state()).device, null);
    assert.equal((await api('/gateway/heartbeat', 'POST', { deviceId: 'test-door' }, gateway)).status, 204);
    assert.equal((await state()).device?.connected, true);
    const received = await api('/gateway/departures', 'POST', event, gateway);
    assert.equal(received.status, 202);
    const hwWindow = await received.json() as DetectionProgress;
    const reports = '/gateway/departures/' + event.id + '/reports';
    const hwResult = once(socket, 'verification_completed');
    assert.equal((await api(reports, 'POST', { identifiers: ['generic-wallet'], complete: false }, gateway)).status, 204);
    assert.equal((await api(reports, 'POST', { identifiers: [], complete: true }, gateway)).status, 204);
    assert.equal((await state()).sessions.length, 2);
    const hardware = (await hwResult)[0] as Session;
    assert.equal(hardware.missing, 1);
    assert(hardware.alertId);
    assert.equal(hardware.source, 'hardware');
    assert(Date.parse(hardware.completedAt) >= Date.parse(hwWindow.deadline));
    assert.equal((await state()).alerts[0].priority, 'normal');
    assert.equal((await api('/gateway/departures', 'POST', event, gateway)).status, 409);

    const noCompletion = { ...event, id: randomUUID() };
    const failed = once(socket, 'verification_failed');
    assert.equal((await api('/gateway/departures', 'POST', noCompletion, gateway)).status, 202);
    await pause(1100);
    assert.equal((await state()).sessions.length, 3);
    assert.equal((await failed)[0].id, noCompletion.id);
    assert.equal((await state()).alerts.length, 2);

    assert.equal((await api('/settings', 'PUT', { ...preferences, simulationMode: false })).status, 204);
    assert.equal((await api('/simulation', 'POST', { detectedIds: [] })).status, 409);
    assert.equal((await api('/items/' + keys.id, 'DELETE')).status, 204);
    assert.equal((await api('/items/' + keys.id, 'DELETE')).status, 404);
  } finally {
    socket.close();
    await new Promise<void>((resolve) => app.io.close(() => { resolve(); }));
    await app.engine.drain();
    await db.close();
  }

  const reopened = await Database.open({ localPath: directory });
  try {
    const stored = await reopened.snapshot();
    assert.equal(stored.sessions.length, 3);
    assert.equal(stored.items.length, 2);
    assert.equal(stored.settings.simulationMode, false);
    assert.equal(stored.sessions[0].results.find((row) => row.name === 'Keys')?.status, 'missing');
    assert(stored.alerts.find((record) => record.priority === 'high')?.acknowledgedAt);
  } finally {
    await reopened.close();
    if (dirname(directory) === testRoot) await rm(directory, { force: true, recursive: true });
  }
});
