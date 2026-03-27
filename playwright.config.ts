import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:3100',
  },
  webServer: {
    command: 'rm -rf /tmp/jobclaw-e2e && PATH=/home/ccnuacm/work/jobclaw/.tools/node-v22.14.0-linux-x64/bin:$PATH SERVER_PORT=3100 MCP_DISABLED=1 API_KEY=local MODEL_ID=local BASE_URL=http://localhost ./node_modules/.bin/tsx src/index.ts --workspace /tmp/jobclaw-e2e',
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
