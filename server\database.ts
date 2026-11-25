import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { assignImage } from '../shared/contracts.js';
import type {
  Alert, DepartureEvent, Device, Item, ItemInput, Result, Session, Settings, Snapshot,
} from '../shared/contracts.js';

interface Queryable {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

const itemFields = `id, name, category, description, priority_type AS priority,
  image_reference AS image, image_override AS "imageOverride",
  detection_identifier AS identifier, monitoring_enabled AS monitoring,
  to_json(created_at) #>> '{}' AS "createdAt", to_json(updated_at) #>> '{}' AS "updatedAt"`;

const settingsFields = `verification_timeout AS "timeoutSeconds", time_format AS "timeFormat",
  date_format AS "dateFormat", voice_enabled AS "voiceEnabled", voice_selection AS "voiceSelection",
  round(voice_rate::numeric, 2)::float8 AS "speechRate", round(voice_volume::numeric, 2)::float8 AS "voiceVolume",
  repeat_until_acknowledged AS "repeatVoice",
  browser_notifications AS "browserNotifications", simulation_mode AS "simulationMode"`;

type SessionRow = Omit<Session, 'results'>;
type ResultRow = Result & { sessionId: string };
type AlertRow = Omit<Alert, 'items'>;
const deviceLifetimeMs = 90_000;

export class Database {
  private constructor(
    private readonly client: Queryable,
    private readonly inTransaction: <T>(work: (transaction: Queryable) => Promise<T>, consistent?: boolean) => Promise<T>,
    private readonly disconnect: () => Promise<void>,
    readonly kind: Snapshot['backend']['database'],
  ) {}

  static async open(options: { url?: string; localPath?: string } = {}) {
    const schema = await readFile(new URL('../../database/schema.sql', import.meta.url), 'utf8')
      .catch(() => readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'));
    if (options.url) {
      const pool = new pg.Pool({
        connectionString: options.url, max: 5, connectionTimeoutMillis: 8000,
      });
      pool.on('error', (error) => console.error('Database connection error', { code: (error as NodeJS.ErrnoException).code }));
      try {
        await pool.query('SELECT id FROM leavemate.application_settings WHERE id = 1');
      } catch (error) {
        await pool.end();
        throw error;
      }
      return new Database(pool, async (work, consistent) => {
        const connection = await pool.connect();
        try {
          await connection.query(consistent ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : 'BEGIN');
          const result = await work(connection);
          await connection.query('COMMIT');
          return result;
        } catch (error) {
          await connection.query('ROLLBACK');
          throw error;
        } finally {
          connection.release();
        }
      }, () => pool.end(), 'supabase');
    }

    const local = await PGlite.create(options.localPath ?? resolve('.leavemate'));
    await local.exec(schema);
    return new Database(local, (work) => local.transaction(work), () => local.close(), 'local');
  }

  close() { return this.disconnect(); }
  async health() { await this.client.query('SELECT 1'); }

  async recoverInterrupted() {
    await this.client.query(`UPDATE leavemate.verification_sessions
      SET verification_status='failed', completed_at=now() WHERE verification_status='running'`);
  }

  async items(connection = this.client) {
    return (await connection.query<Item>(`SELECT ${itemFields} FROM leavemate.items ORDER BY created_at DESC, id`)).rows;
  }

  async saveItem(input: ItemInput, id?: string) {
    const values = [input.name, input.category, input.description, input.priority, input.identifier,
      input.monitoring, input.imageOverride, input.imageOverride ?? assignImage(input.name, input.category)];
    const sql = id
      ? `UPDATE leavemate.items SET name=$1, category=$2, description=$3, priority_type=$4,
         detection_identifier=$5, monitoring_enabled=$6, image_override=$7, image_reference=$8,
         updated_at=now() WHERE id=$9`
      : `INSERT INTO leavemate.items (name,category,description,priority_type,detection_identifier,
         monitoring_enabled,image_override,image_reference,id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`;
    return (await this.client.query<Item>(`${sql} RETURNING ${itemFields}`, [...values, id ?? randomUUID()])).rows[0];
  }

  async deleteItem(id: string) {
    return Boolean((await this.client.query('DELETE FROM leavemate.items WHERE id=$1 RETURNING id', [id])).rows.length);
  }

  async settings(connection = this.client) {
    return (await connection.query<Settings>(`SELECT ${settingsFields} FROM leavemate.application_settings WHERE id=1`)).rows[0];
  }

  async saveSettings(settings: Settings) {
    await this.client.query(`UPDATE leavemate.application_settings SET verification_timeout=$1, time_format=$2,
      date_format=$3, voice_enabled=$4, voice_selection=$5, voice_rate=$6, voice_volume=$7,
      repeat_until_acknowledged=$8, browser_notifications=$9, simulation_mode=$10 WHERE id=1`, [
      settings.timeoutSeconds, settings.timeFormat, settings.dateFormat, settings.voiceEnabled, settings.voiceSelection,
      settings.speechRate, settings.voiceVolume, settings.repeatVoice, settings.browserNotifications, settings.simulationMode,
    ]);
  }

  async lastDevice(connection = this.client): Promise<Device | null> {
    const result = (await connection.query<Omit<Device, 'connected'>>(`SELECT device_identifier AS identifier,
      to_json(last_communication) #>> '{}' AS "lastCommunication"
      FROM leavemate.device_status ORDER BY last_communication DESC LIMIT 1`)).rows[0];
    return result && { ...result, connected: Date.now() - Date.parse(result.lastCommunication) < deviceLifetimeMs } || null;
  }

  async touchDevice(identifier: string) {
    await this.client.query(`INSERT INTO leavemate.device_status (device_identifier,last_communication) VALUES ($1,now())
      ON CONFLICT (device_identifier) DO UPDATE SET last_communication=excluded.last_communication`, [identifier]);
  }

  async snapshot(): Promise<Snapshot> {
    return this.inTransaction(async (connection) => {
      const items = await this.items(connection);
      const settings = await this.settings(connection);
      const device = await this.lastDevice(connection);
      const sessions = (await connection.query<SessionRow>(`SELECT s.id, s.detection_source AS source,
        s.verification_status AS status, to_json(s.started_at) #>> '{}' AS "startedAt",
        to_json(s.completed_at) #>> '{}' AS "completedAt", s.expected_item_count AS expected,
        s.detected_item_count AS detected, s.missing_item_count AS missing, a.id AS "alertId",
        to_json(a.acknowledged_at) #>> '{}' AS "acknowledgedAt"
        FROM leavemate.verification_sessions s LEFT JOIN leavemate.alerts a ON a.session_id=s.id
        WHERE s.verification_status IN ('successful','incomplete') ORDER BY s.completed_at DESC, s.id`)).rows;
      const results = (await connection.query<ResultRow>(`SELECT session_id AS "sessionId", original_item_id AS "itemId",
        item_name AS name, category, image_reference AS image, priority_type AS priority, detection_status AS status,
        to_json(detected_at) #>> '{}' AS "detectedAt" FROM leavemate.verification_results ORDER BY item_name, original_item_id`)).rows;
      const alerts = (await connection.query<AlertRow>(`SELECT a.id, a.session_id AS "sessionId",
        a.alert_message AS message, a.priority, to_json(a.created_at) #>> '{}' AS "createdAt",
        to_json(a.acknowledged_at) #>> '{}' AS "acknowledgedAt", n.is_read AS "isRead"
        FROM leavemate.alerts a JOIN leavemate.notifications n ON n.alert_id=a.id ORDER BY a.created_at DESC, a.id`)).rows;
      const bySession = new Map<string, Result[]>();
      for (const { sessionId, ...result } of results) {
        const group = bySession.get(sessionId) ?? [];
        group.push(result);
        bySession.set(sessionId, group);
      }
      return {
        items, settings, device, backend: { version: '1.0.0', database: this.kind },
        sessions: sessions.map((session) => ({ ...session, results: bySession.get(session.id) ?? [] })),
        alerts: alerts.map((alert) => ({ ...alert, items: bySession.get(alert.sessionId)?.filter((row) => row.status === 'missing') ?? [] })),
      };
    }, true);
  }

  async begin(event: DepartureEvent, expected: number, startedAt: string, timeout: number) {
    const result = await this.client.query(`INSERT INTO leavemate.verification_sessions
      (id,event_type,event_timestamp,verification_status,expected_item_count,detection_source,device_identifier,started_at,timeout_seconds)
      VALUES ($1,$2,$3,'running',$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [event.id, event.eventType, event.timestamp, expected, event.source, event.deviceId, startedAt, timeout]);
    return result.rows.length > 0;
  }

  async finish(session: Session, alert: Alert | null) {
    await this.inTransaction(async (connection) => {
      for (const result of session.results) {
        await connection.query(`INSERT INTO leavemate.verification_results
          (id,session_id,item_id,original_item_id,item_name,category,image_reference,priority_type,detection_status,detected_at)
          VALUES ($1,$2,(SELECT id FROM leavemate.items WHERE id=$3 FOR KEY SHARE),$3,$4,$5,$6,$7,$8,$9)`, [
          randomUUID(), session.id, result.itemId, result.name, result.category, result.image,
          result.priority, result.status, result.detectedAt,
        ]);
      }
      if (alert) {
        await connection.query(`INSERT INTO leavemate.alerts (id,session_id,alert_message,priority,created_at)
          VALUES ($1,$2,$3,$4,$5)`, [alert.id, alert.sessionId, alert.message, alert.priority, alert.createdAt]);
        await connection.query(`INSERT INTO leavemate.notifications (id,alert_id,title,message,created_at)
          VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), alert.id, 'Missing belongings', alert.message, alert.createdAt]);
      }
      await connection.query(`UPDATE leavemate.verification_sessions SET verification_status=$2,
        detected_item_count=$3, missing_item_count=$4, completed_at=$5 WHERE id=$1`,
      [session.id, session.status, session.detected, session.missing, session.completedAt]);
    });
  }

  async fail(id: string) {
    await this.client.query(`UPDATE leavemate.verification_sessions SET verification_status='failed',
      completed_at=now() WHERE id=$1 AND verification_status='running'`, [id]);
  }

  async changeAlert(id: string, acknowledge: boolean) {
    return this.inTransaction(async (connection) => {
      if (acknowledge) {
        await connection.query(`UPDATE leavemate.alerts SET acknowledged_at=now()
          WHERE id=$1 AND acknowledged_at IS NULL`, [id]);
      }
      return Boolean((await connection.query(`UPDATE leavemate.notifications SET is_read=true
        WHERE alert_id=$1 RETURNING id`, [id])).rows.length);
    });
  }

  async markAllRead() {
    await this.client.query('UPDATE leavemate.notifications SET is_read=true WHERE NOT is_read');
  }
}
