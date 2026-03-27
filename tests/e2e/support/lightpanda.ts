import { test as base, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { chmod, copyFile, mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'

type Fixtures = {
  appBaseUrl: string
  browserContext: BrowserContext
  page: Page
}

const APP_READY_TIMEOUT_MS = 120_000
const LIGHTPANDA_HOST = '127.0.0.1'
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const LIGHTPANDA_SOURCE_PATH =
  process.env['LIGHTPANDA_EXECUTABLE_PATH'] ?? path.join(os.homedir(), '.cache/lightpanda-node', 'lightpanda')

function randomPort(base: number): number {
  return base + Math.floor(Math.random() * 1000)
}

function collectOutput(proc: ChildProcess): { read: () => string } {
  let output = ''
  proc.stdout?.on('data', (chunk) => {
    output += chunk.toString()
  })
  proc.stderr?.on('data', (chunk) => {
    output += chunk.toString()
  })
  return {
    read: () => output,
  }
}

async function waitForHttpReady(url: string, proc: ChildProcess, readOutput: () => string): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < APP_READY_TIMEOUT_MS) {
    if (proc.exitCode !== null) {
      throw new Error(`E2E app server exited early (${proc.exitCode}).\n${readOutput()}`)
    }

    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
      // Server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  throw new Error(`Timed out waiting for E2E app server at ${url}.\n${readOutput()}`)
}

async function stopProcess(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null) return

  proc.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (proc.exitCode === null) {
        proc.kill('SIGKILL')
      }
      resolve()
    }, 5_000)

    proc.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function installExternalAssetStubs(page: Page): Promise<void> {
  await page.route('https://**/*', async (route) => {
    const url = route.request().url()

    if (url.startsWith('https://cdn.tailwindcss.com')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'window.tailwind = window.tailwind || {};',
      })
      return
    }

    if (url.includes('/chart.js@4/dist/chart.umd.min.js')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          window.Chart = class Chart {
            constructor(ctx, config) {
              this.ctx = ctx
              this.data = config?.data ?? {}
              this.options = config?.options ?? {}
            }
            update() {}
            destroy() {}
          };
        `,
      })
      return
    }

    if (url.includes('/marked/marked.min.js')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          window.marked = {
            setOptions() {},
            parse(value) { return String(value ?? ''); },
          };
        `,
      })
      return
    }

    if (url.includes('/dompurify@') && url.endsWith('/purify.min.js')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          window.DOMPurify = {
            sanitize(value) { return String(value ?? ''); },
          };
        `,
      })
      return
    }

    if (url.startsWith('https://fonts.googleapis.com/')) {
      await route.fulfill({
        status: 200,
        contentType: 'text/css',
        body: '',
      })
      return
    }

    if (url.startsWith('https://fonts.gstatic.com/')) {
      await route.fulfill({
        status: 200,
        contentType: 'font/woff2',
        body: '',
      })
      return
    }

    await route.abort()
  })
}

async function startLightpandaServer(port: number): Promise<{ proc: ChildProcess; cleanup: () => Promise<void> }> {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'jobclaw-lightpanda-'))
  const executablePath = path.join(binDir, 'lightpanda')

  await copyFile(LIGHTPANDA_SOURCE_PATH, executablePath)
  await chmod(executablePath, 0o755)

  const proc = spawn(executablePath, ['serve', '--host', LIGHTPANDA_HOST, '--port', String(port)], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => resolve(), 250)
    proc.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    proc.once('spawn', () => {
      clearTimeout(timer)
      setTimeout(resolve, 250)
    })
  })

  return {
    proc,
    cleanup: async () => {
      await stopProcess(proc)
      await rm(binDir, { recursive: true, force: true })
    },
  }
}

export const test = base.extend<Fixtures>({
  appBaseUrl: [
    async ({}, use) => {
      const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'jobclaw-e2e-'))
      const port = randomPort(33_000)
      const appBaseUrl = `http://127.0.0.1:${port}`
      const serverProc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', '--workspace', workspaceRoot], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          SERVER_PORT: String(port),
          MCP_DISABLED: '1',
          API_KEY: 'local',
          MODEL_ID: 'local',
          BASE_URL: 'http://localhost',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const serverOutput = collectOutput(serverProc)

      try {
        await waitForHttpReady(appBaseUrl, serverProc, serverOutput.read)
        await use(appBaseUrl)
      } finally {
        await stopProcess(serverProc)
        await rm(workspaceRoot, { recursive: true, force: true })
      }
    },
    { scope: 'worker' },
  ],

  browserContext: [
    async ({}, use) => {
      const cdpPort = randomPort(42_000)
      const lightpandaServer = await startLightpandaServer(cdpPort)
      const browser: Browser = await chromium.connectOverCDP(`http://${LIGHTPANDA_HOST}:${cdpPort}`)
      const browserContext = browser.contexts()[0] ?? (await browser.newContext())

      try {
        await use(browserContext)
      } finally {
        await browser.close().catch(() => {})
        await lightpandaServer.cleanup()
      }
    },
    { scope: 'worker' },
  ],

  page: async ({ browserContext, appBaseUrl }, use) => {
    const page = await browserContext.newPage()

    await installExternalAssetStubs(page)
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('h1')
    await page.waitForSelector('#chat-input')

    try {
      await use(page)
    } finally {
      await page.close()
    }
  },
})

export { expect }
