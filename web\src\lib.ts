import type { Session, Settings } from '../../shared/contracts';

export const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
export async function api<T = void>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}/api${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || 'The request failed.');
  return result as T;
}

export function dayKey(value: string | Date) {
  const date = new Date(value);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
}

export function dateTime(value: string, settings: Settings) {
  const date = new Date(value);
  const day = settings.dateFormat === 'iso' ? dayKey(date) : new Intl.DateTimeFormat(
    settings.dateFormat === 'day-first' ? 'en-GB' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' },
  ).format(date);
  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hourCycle: settings.timeFormat === '12h' ? 'h12' : 'h23',
  });
  return `${day} · ${time}`;
}

export function metrics(sessions: Session[]) {
  const successful = sessions.filter((session) => session.status === 'successful').length;
  const missing = sessions.flatMap((session) => session.results.filter((item) => item.status === 'missing'));
  const essential = missing.filter((item) => item.priority === 'essential').length;
  const byItem = new Map<string, { name: string; count: number }>();
  for (const item of missing) {
    const tally = byItem.get(item.itemId) ?? { name: item.name, count: 0 };
    tally.count++;
    byItem.set(item.itemId, tally);
  }
  return {
    total: sessions.length, successful, incomplete: sessions.length - successful,
    rate: sessions.length ? Math.round(successful / sessions.length * 100) : null,
    alerts: sessions.filter((session) => session.alertId).length, essential, optional: missing.length - essential,
    frequent: [...byItem.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

export function daily(sessions: Session[]) {
  const days = new Map<string, { day: string; checks: number; alerts: number }>();
  for (const session of sessions) {
    const day = dayKey(session.completedAt);
    const entry = days.get(day) ?? { day, checks: 0, alerts: 0 };
    entry.checks++;
    if (session.alertId) entry.alerts++;
    days.set(day, entry);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function downloadCsv(name: string, sessions: Session[]) {
  const lines = [['Verification ID', 'Started at', 'Completed at', 'Source', 'Outcome', 'Expected', 'Detected', 'Missing',
    'Detected items', 'Missing essential items', 'Missing optional items', 'Alert status']];
  for (const session of sessions) {
    const names = (status: 'detected' | 'missing', priority?: 'essential' | 'optional') => session.results
      .filter((item) => item.status === status && (!priority || item.priority === priority)).map((item) => item.name).join('; ');
    lines.push([
      session.id, session.startedAt, session.completedAt, session.source, session.status, String(session.expected),
      String(session.detected), String(session.missing), names('detected'), names('missing', 'essential'),
      names('missing', 'optional'), session.alertId ? (session.acknowledgedAt ? 'Acknowledged' : 'Open') : 'None',
    ]);
  }
  const escaped = lines.map((row) => row.map((value) =>
    `"${(/^[\s]*[=+\-@\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff', escaped], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name + '.csv' });
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function itemInput(item: import('../../shared/contracts').Item) {
  const { name, category, description, priority, monitoring, identifier, imageOverride } = item;
  return { name, category, description, priority, monitoring, identifier, imageOverride };
}

export type Action = <T,>(operation: () => Promise<T>, message?: string) => Promise<T | undefined>;
