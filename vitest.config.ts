import { defineConfig } from 'vitest/config'

export default defineConfig({
  cacheDir: '.vitest-cache',
  test: {
    exclude: ['**/node_modules/**', '**/e2e/**', '**/.worktrees/**'],
  },
})
