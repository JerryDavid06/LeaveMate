import { setTimeout as pause } from 'node:timers/promises';
import type { DepartureEvent, Item } from '../shared/contracts.js';

export interface DetectionWindow {
  event: DepartureEvent;
  deadlineMs: number;
  items: Item[];
}

export interface DetectionProvider {
  /** Resolve after the provider confirms a final result, or reject if it cannot finish. */
  collect(window: DetectionWindow, update: (detected: ReadonlyMap<string, string>) => void): Promise<ReadonlyMap<string, string>>;
}

export class SimulationDetectionProvider implements DetectionProvider {
  constructor(private readonly detectedIds: string[]) {}

  async collect({ deadlineMs }: DetectionWindow, update: Parameters<DetectionProvider['collect']>[1]) {
    await pause(Math.max(0, Math.min(650, deadlineMs - Date.now())));
    const reportedAt = new Date().toISOString();
    const detected = new Map(this.detectedIds.map((id) => [id, reportedAt]));
    update(detected);
    await pause(Math.max(0, deadlineMs - Date.now()));
    return detected;
  }
}

interface Report {
  identifiers: string[];
  complete: boolean;
  requireInWindow?: boolean;
}

/** Adapts authenticated, generic gateway reports to internal item IDs. */
export class GatewayDetectionProvider implements DetectionProvider {
  private receive?: (report: Report) => boolean;

  report(report: Report) {
    return this.receive?.(report) ?? false;
  }

  collect({ deadlineMs, items }: DetectionWindow, update: Parameters<DetectionProvider['collect']>[1]) {
    const itemIds = new Map(items.flatMap((item) => item.identifier ? [[item.identifier, item.id]] : []));
    const detected = new Map<string, string>();
    return new Promise<ReadonlyMap<string, string>>((resolve, reject) => {
      // A station can be momentarily delayed by Wi-Fi or HTTPS. Keep this window
      // open briefly after the display timer so its final report is not lost.
      const finalReportGraceMs = 20_000;
      const deadline = setTimeout(() => {
        this.receive = undefined;
        reject(new Error('The provider did not confirm the detection window. No missing-item result was recorded.'));
      }, Math.max(0, deadlineMs - Date.now()) + finalReportGraceMs);

      this.receive = ({ identifiers, complete, requireInWindow }) => {
        const now = Date.now();
        const allowedUntil = deadlineMs + finalReportGraceMs;
        if (requireInWindow && now > allowedUntil) return false;
        if (now <= allowedUntil) {
          for (const identifier of identifiers) {
            const id = itemIds.get(identifier);
            if (id && !detected.has(id)) detected.set(id, new Date(now).toISOString());
          }
          update(detected);
        }
        if (complete) {
          this.receive = undefined;
          clearTimeout(deadline);
          void pause(Math.max(0, deadlineMs - now)).then(() => resolve(detected));
        }
        return true;
      };
    });
  }
}
