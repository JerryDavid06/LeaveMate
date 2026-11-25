import { randomUUID } from 'node:crypto';
import type { Alert, ServerEvents, Session } from '../shared/contracts.js';

export type Publish = <K extends keyof ServerEvents>(event: K, ...args: Parameters<ServerEvents[K]>) => void;

export function createAlert(session: Session): Alert | null {
  const items = session.results.filter((item) => item.status === 'missing');
  if (!items.length) return null;
  const names = new Intl.ListFormat('en', { type: 'conjunction' }).format(items.map((item) => item.name));
  const verb = items.length === 1 ? 'was' : 'were';
  return {
    id: randomUUID(), sessionId: session.id, priority: items.some((item) => item.priority === 'essential') ? 'high' : 'normal',
    createdAt: session.completedAt, acknowledgedAt: null, isRead: false, items,
    message: `Warning. ${names} ${verb} not detected. Please check your belongings before leaving.`,
  };
}

export class Notifications {
  constructor(readonly publish: Publish) {}

  completed(session: Session, alert: Alert | null) {
    this.publish('verification_completed', session);
    if (alert) {
      this.publish('missing_items_detected', alert);
      this.publish('alert_created', alert);
    }
    this.publish('state_changed');
  }
}
