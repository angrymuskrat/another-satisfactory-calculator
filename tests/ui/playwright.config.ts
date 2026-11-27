import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: '../../output/playwright',
  timeout: 45_000,
  workers: 1,
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173', channel: 'chrome', headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
