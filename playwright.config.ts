import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'app.spec.ts',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  outputDir: '/tmp/jobclaw-playwright-results',
})
