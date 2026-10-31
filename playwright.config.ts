import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:3100', viewport: { width: 390, height: 844 },
    browserName: 'chromium',
    launchOptions: {
      executablePath: process.env.CHROME_PATH || undefined,
      args: ['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
    },
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/e2e-server.mjs', url: 'http://127.0.0.1:3100/health',
    reuseExistingServer: false, timeout: 15000,
  },
});
