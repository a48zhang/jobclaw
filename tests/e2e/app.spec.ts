import { test, expect } from './support/lightpanda.js'

test.describe('JobClaw Web UI', () => {
  test('loads chat page and exposes primary chat controls with tab semantics', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('JobClaw')
    await expect(page.locator('nav[aria-label="主导航"] [role="tablist"]')).toBeVisible()
    await expect(page.locator('[data-target="tab-chat"]')).toHaveAttribute('role', 'tab')
    await expect(page.locator('[data-target="tab-chat"]')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('#tab-chat')).toHaveAttribute('role', 'tabpanel')
    await expect(page.locator('#chat-hints')).toBeVisible()
    await expect(page.locator('#tab-chat')).toBeVisible()
    await expect(page.locator('#chat-input')).toBeVisible()
    await expect(page.locator('#chat-send')).toBeVisible()
  })

  test('navigation updates aria-selected and panel visibility', async ({ page }) => {
    await page.locator('[data-target="tab-jobs"]').click()

    await expect(page.locator('[data-target="tab-jobs"]')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('[data-target="tab-chat"]')).toHaveAttribute('aria-selected', 'false')
    await expect(page.locator('#tab-jobs')).toHaveClass(/active/)
    await expect(page.locator('#tab-jobs')).toBeVisible()
    await expect(page.locator('#tab-chat')).not.toHaveClass(/active/)
    await expect(page.locator('#tab-chat')).toHaveAttribute('hidden', '')
  })

  test('resume tab shows empty state when no resume exists', async ({ page }) => {
    await page.locator('[data-target="tab-resume"]').click()

    await expect(page.locator('#gen-resume')).toBeVisible()
    await expect(page.locator('#review-uploaded-resume')).toBeVisible()
    await expect(page.locator('#resume-upload-status')).toBeVisible()
    await expect(page.locator('#resume-preview')).toHaveClass(/hidden/)
    await expect(page.locator('#resume-preview-empty')).toBeVisible()
  })

  test('jobs tab exposes filter controls and selection actions', async ({ page }) => {
    await page.locator('[data-target="tab-jobs"]').click()

    await expect(page.locator('#jobs-filter-controls')).toBeVisible()
    await expect(page.locator('#jobs-status-filter')).toBeVisible()
    await expect(page.locator('#jobs-keyword-filter')).toBeVisible()
    await expect(page.locator('#jobs-filter-reset')).toBeVisible()

    await expect(page.locator('#refresh-jobs')).toBeVisible()
    await expect(page.locator('#batch-apply')).toBeVisible()
    await expect(page.locator('#batch-fail')).toBeVisible()
    await expect(page.locator('#batch-favorite')).toBeVisible()
    await expect(page.locator('#batch-delete')).toBeVisible()
  })
})
