export const categories = [
  'Personal Belongings', 'Electronics', 'Documents', 'Accessories', 'Keys', 'Other',
] as const;

export const images = ['wallet', 'laptop', 'keys', 'id-card', 'phone', 'documents'] as const;
export type ImageKey = typeof images[number];
export type Priority = 'essential' | 'optional';
export type Source = 'simulation' | 'hardware';

export interface ItemInput {
  name: string;
  category: string;
  description: string;
  priority: Priority;
  monitoring: boolean;
  identifier: string | null;
  imageOverride: ImageKey | null;
}

export interface Item extends ItemInput {
  id: string;
  image: ImageKey | null;
  createdAt: string;
  updatedAt: string;
}

export interface DepartureEvent {
  id: string;
  eventType: 'DEPARTURE_DETECTED';
  source: Source;
  timestamp: string;
  deviceId: string | null;
}

export interface Result {
  itemId: string;
  name: string;
  category: string;
  image: ImageKey | null;
  priority: Priority;
  status: 'detected' | 'missing';
  detectedAt: string | null;
}

export interface Session {
  id: string;
  source: Source;
  status: 'successful' | 'incomplete';
  startedAt: string;
  completedAt: string;
  expected: number;
  detected: number;
  missing: number;
  results: Result[];
  alertId: string | null;
  acknowledgedAt: string | null;
}

export interface Alert {
  id: string;
  sessionId: string;
  message: string;
  priority: 'high' | 'normal';
  createdAt: string;
  acknowledgedAt: string | null;
  isRead: boolean;
  items: Result[];
}

export interface Settings {
  timeoutSeconds: number;
  timeFormat: '12h' | '24h';
  dateFormat: 'short' | 'iso' | 'day-first';
  voiceEnabled: boolean;
  voiceSelection: string;
  speechRate: number;
  voiceVolume: number;
  repeatVoice: boolean;
  browserNotifications: boolean;
  simulationMode: boolean;
}

export interface Device {
  identifier: string;
  lastCommunication: string;
  connected: boolean;
}

export interface Snapshot {
  items: Item[];
  sessions: Session[];
  alerts: Alert[];
  settings: Settings;
  device: Device | null;
  backend: { version: string; database: 'local' | 'supabase' };
}

export interface DetectionProgress {
  id: string;
  source: Source;
  startedAt: string;
  deadline: string;
  expected: Omit<Result, 'status' | 'detectedAt'>[];
  detectedIds: string[];
}

export interface ServerEvents {
  departure_detected: (event: DepartureEvent) => void;
  detection_started: (progress: DetectionProgress) => void;
  detection_updated: (progress: DetectionProgress) => void;
  verification_completed: (session: Session) => void;
  verification_failed: (details: { id: string; message: string }) => void;
  missing_items_detected: (alert: Alert) => void;
  alert_created: (alert: Alert) => void;
  alert_acknowledged: (id: string) => void;
  device_status_updated: () => void;
  state_changed: () => void;
}

export function assignImage(name: string, category: string): ImageKey | null {
  const normalized = name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  const matches: [RegExp, ImageKey][] = [
    [/\b(wallet|purse)\b/, 'wallet'], [/\b(laptop|macbook|notebook computer)\b/, 'laptop'],
    [/\b(keys?|keyring|keychain)\b/, 'keys'], [/\b(id card|badge|identity card)\b/, 'id-card'],
    [/\b(phone|smartphone|iphone|android)\b/, 'phone'],
    [/\b(documents?|papers?|folder|passport)\b/, 'documents'],
  ];
  const categoryImages = new Map<string, ImageKey>([
    ['Personal Belongings', 'wallet'], ['Electronics', 'laptop'], ['Documents', 'documents'], ['Keys', 'keys'],
  ]);
  return matches.find(([pattern]) => pattern.test(normalized))?.[1]
    ?? categoryImages.get(category) ?? null;
}
