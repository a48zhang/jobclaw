import { test as base, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { lightpanda } from '@lightpanda/browser'

type Fixtures = {
  page: Page
}

const test = base.extend<Fixtures>({
  page: async ({ baseURL }, use) => {
    const port = 9322 + Math.floor(Math.random() * 1000)
    const lightpandaProc = await lightpanda.serve({
      host: '127.0.0.1',
      port,
    })
    const browser: Browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const context: BrowserContext = browser.contexts()[0]
    const page = await context.newPage()
    if (baseURL) {
      await page.goto(baseURL, { waitUntil: 'load' })
    }
    try {
      await use(page)
    } finally {
      await page.close()
      await browser.close()
      lightpandaProc.stdout.destroy()
      lightpandaProc.stderr.destroy()
      lightpandaProc.kill()
    }
  },
})

test.describe('JobClaw Web UI', () => {
  test('loads chat page and exposes primary chat controls', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('JobClaw')
    await expect(page.locator('#chat-hints')).toBeVisible()
    await expect(page.locator('#tab-chat')).toBeVisible()
    await expect(page.locator('#chat-input')).toBeVisible()
    await expect(page.locator('#chat-send')).toBeVisible()
  })

  test('resume tab shows empty state when no resume exists', async ({ page }) => {
    await page.locator('[data-target="tab-resume"]').click()
    await expect(page.locator('#resume-preview')).toBeHidden()
    await expect(page.locator('#resume-preview-empty')).toBeVisible()
  })

  test('jobs table supports selection controls', async ({ page }) => {
    await page.locator('[data-target="tab-jobs"]').click()

    await expect(page.locator('#refresh-jobs')).toBeVisible()
    await expect(page.locator('#batch-apply')).toBeVisible()
    await expect(page.locator('#batch-fail')).toBeVisible()
    await expect(page.locator('#batch-favorite')).toBeVisible()
    await expect(page.locator('#batch-delete')).toBeVisible()
  })
})
