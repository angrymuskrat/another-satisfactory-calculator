import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: '../../output/playwright',
  timeout: 45_000,
  workers: 1,
  use: { channel: 'chrome', headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
