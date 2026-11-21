import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 45_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4179',
    channel: process.env.LEAVEMATE_BROWSER_CHANNEL || undefined,
    launchOptions: { executablePath: process.env.LEAVEMATE_BROWSER_EXECUTABLE || undefined },
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: 'node build/server/index.js',
    url: 'http://127.0.0.1:4179/api/health',
    env: { PORT: '4179', NODE_ENV: 'test', LEAVEMATE_DB_PATH: 'memory://', DATABASE_URL: '', DEVICE_API_KEY: '' },
    timeout: 40_000,
  },
});
