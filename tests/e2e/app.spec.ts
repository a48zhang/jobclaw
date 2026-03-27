import { test, expect } from './support/lightpanda.js'

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
