import 'dotenv/config';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { Database } from './database.js';

async function main() {
  const { DATABASE_URL, FRONTEND_ORIGIN, DEVICE_API_KEY, PORT, NODE_ENV } = process.env;
  const production = NODE_ENV === 'production';
  if (production && (!DATABASE_URL || !FRONTEND_ORIGIN)) {
    throw new Error('Production requires DATABASE_URL and FRONTEND_ORIGIN.');
  }
  const database = await Database.open({ url: DATABASE_URL, localPath: process.env.LEAVEMATE_DB_PATH });
  const { http, io, engine } = await createApp(database, {
    origin: FRONTEND_ORIGIN, deviceKey: DEVICE_API_KEY, trustProxy: production,
    staticDir: production ? undefined : resolve('web/dist'),
  });
  const port = Number(PORT ?? 4100);
  const host = production ? '0.0.0.0' : '127.0.0.1';
  http.listen(port, host, () => console.info(`LeaveMate API on ${host}:${port} (${database.kind})`));
  const stop = async () => {
    await new Promise<void>((resolve) => io.close(() => { resolve(); }));
    await engine.drain();
    await database.close();
  };
  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());
}
void main().catch((error) => {
  console.error('LeaveMate startup failed. Check the environment and database schema.', { code: error.code ?? error.name });
  process.exitCode = 1;
});
