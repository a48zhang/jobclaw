import { test, expect } from '@playwright/test'
test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const url = route.request().url()
    if (
      url.startsWith('https://cdn.tailwindcss.com') ||
      url.startsWith('https://cdn.jsdelivr.net/npm/chart.js') ||
      url.startsWith('https://cdn.jsdelivr.net/npm/marked') ||
      url.startsWith('https://cdn.jsdelivr.net/npm/dompurify') ||
      url.startsWith('https://fonts.googleapis.com') ||
      url.startsWith('https://fonts.gstatic.com')
    ) {
      return route.abort()
    }
    return route.continue()
  })

  await page.addInitScript(() => {
    // @ts-expect-error stub
    window.Chart = function () { return { update() {} } }
    // @ts-expect-error stub
    window.marked = { setOptions() {}, parse: (text: string) => String(text || '') }
    // @ts-expect-error stub
    window.DOMPurify = { sanitize: (html: string) => html }
  })
})

test.describe('JobClaw Web UI', () => {
  test('loads chat page with first-run banner and hints', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('h1')).toContainText('JobClaw')
    await expect(page.locator('#chat-hints')).toBeVisible()
    await expect(page.locator('#first-run-banner')).toBeVisible()
  })

  test('resume preview is hidden until resume ready', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#resume-preview')).toBeHidden()
    await expect(page.locator('#resume-preview-empty')).toBeHidden()
  })

  test('jobs table supports selection controls', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.locator('[data-target="tab-jobs"]').click()

    await expect(page.locator('#refresh-jobs')).toBeVisible()
    await expect(page.locator('#batch-apply')).toBeVisible()
    await expect(page.locator('#batch-fail')).toBeVisible()
    await expect(page.locator('#batch-favorite')).toBeVisible()
    await expect(page.locator('#batch-delete')).toBeVisible()
  })
})
