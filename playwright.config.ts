import { defineConfig } from '@playwright/test';
import { chromiumPath } from './scripts/browser.mjs';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5414/dist/',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'], executablePath: chromiumPath() },
  },
  webServer: {
    command: 'node scripts/serve.mjs',
    url: 'http://127.0.0.1:5414/dist/',
    reuseExistingServer: false,
    timeout: 20_000,
  },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  ],
});
