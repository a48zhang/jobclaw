import { test, expect } from './support/lightpanda.js'

test.describe('JobClaw Web UI', () => {
  test('loads chat page with local frontend assets and tab semantics', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('JobClaw')
    await expect(page.locator('link[href="/css/tw-compat.css"]')).toHaveCount(1)
    await expect(page.locator('script[src="/vendor/marked.min.js"]')).toHaveCount(1)
    await expect(page.locator('script[src="/vendor/dompurify-lite.js"]')).toHaveCount(1)
    await expect(page.locator('script[src*="tailwindcss.com"]')).toHaveCount(0)
    await expect(page.locator('script[src*="cdn.jsdelivr.net"]')).toHaveCount(0)
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

  test('resume tab shows step flow and task card baseline state', async ({ page }) => {
    await page.locator('[data-target="tab-resume"]').click()

    await expect(page.locator('#resume-step-flow')).toBeVisible()
    await expect(page.locator('#resume-step-generate-state')).toContainText('主操作')
    await expect(page.locator('#resume-task-card')).toBeVisible()
    await expect(page.locator('#gen-resume')).toBeVisible()
    await expect(page.locator('#review-uploaded-resume')).toBeVisible()
    await expect(page.locator('#resume-upload-status')).toBeVisible()
    await expect(page.locator('#resume-upload-status')).not.toHaveText('')
    await expect(page.locator('#resume-preview')).toHaveClass(/hidden/)
    await expect(page.locator('#resume-preview-empty')).toBeVisible()
  })

  test('jobs tab keeps refresh visible and hides batch toolbar by default', async ({ page }) => {
    await page.locator('[data-target="tab-jobs"]').click()

    await expect(page.locator('#jobs-filter-controls')).toBeVisible()
    await expect(page.locator('#jobs-status-filter')).toBeVisible()
    await expect(page.locator('#jobs-keyword-filter')).toBeVisible()
    await expect(page.locator('#jobs-filter-reset')).toBeVisible()

    await expect(page.locator('#refresh-jobs')).toBeVisible()
    await expect(page.locator('#jobs-batch-hint')).toBeVisible()
    await expect(page.locator('#jobs-batch-toolbar')).toHaveAttribute('aria-hidden', 'true')
    await expect(page.locator('#jobs-batch-toolbar')).toHaveClass(/hidden/)
  })

  test('config editor prompts before discarding unsaved changes', async ({ page }) => {
    await page.locator('[data-target="tab-config"]').click()

    const editor = page.locator('#md-editor')
    await expect(editor).toBeVisible()
    await editor.evaluate((element) => {
      const nextValue = `${element.value}\n# e2e dirty marker`
      element.value = nextValue
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await expect(page.locator('#save-status')).toContainText('未保存更改')

    const userinfoTab = page.locator('.config-tab-btn[data-file="userinfo"]')
    await userinfoTab.scrollIntoViewIfNeeded()
    await userinfoTab.click()

    await expect(page.locator('#ui-confirm-overlay')).toBeVisible()
    await page.locator('#ui-confirm-cancel').click()
    await expect(page.locator('#ui-confirm-overlay')).toBeHidden()
    await expect(page.locator('.config-tab-btn[data-file="targets"]')).toHaveClass(/font-bold/)

    await userinfoTab.click()
    await expect(page.locator('#ui-confirm-overlay')).toBeVisible()
    await page.locator('#ui-confirm-submit').click()
    await expect(page.locator('#ui-confirm-overlay')).toBeHidden()
    await expect(page.locator('.config-tab-btn[data-file="userinfo"]')).toHaveClass(/font-bold/)
  })

  test('chat status line and onboarding apply trusted entry narrative', async ({ page }) => {
    await expect(page.locator('#chat-runtime-status')).toBeVisible()
    await expect(page.locator('#chat-runtime-status')).toContainText(/等待指令|提交中|排队中|执行中|已完成|失败/)
    await expect(page.locator('#first-run-banner')).toBeVisible()
    await expect(page.locator('#first-run-banner')).toContainText('基础配置完成度')
    await expect(page.locator('#first-run-banner')).toContainText('targets.md')
  })

  test('chat tab exposes runtime workboard with task-first overview', async ({ page }) => {
    await expect(page.locator('#runtime-workboard')).toBeVisible()
    await expect(page.locator('#runtime-workboard')).toContainText('当前自动化状态')
    await expect(page.locator('#runtime-workboard')).toContainText('当前焦点')
    await expect(page.locator('#runtime-workboard')).toContainText('任务队列')
  })

  test('jobs tab differentiates empty state from filtered no-results while detail panel baseline renders', async ({ page }) => {
    await page.locator('[data-target="tab-jobs"]').click()
    await expect(page.locator('text=还没有职位数据。')).toBeVisible()
    await page.locator('#jobs-keyword-filter').fill('unlikely-filter-value')
    await expect(page.locator('text=当前筛选条件下无结果')).toBeVisible()
    await page.locator('#jobs-empty-reset').click()
    await expect(page.locator('text=还没有职位数据。')).toBeVisible()
  })

  test('configuration panel exposes grouped prompts, docs status, and restart note', async ({ page }) => {
    await page.locator('[data-target="tab-config"]').click()
    await expect(page.locator('text=必填项')).toBeVisible()
    await expect(page.locator('text=可选项')).toBeVisible()
    await expect(page.locator('#config-restart-note')).toBeVisible()
    await expect(page.locator('#targets-doc-status')).toBeVisible()
    await expect(page.locator('#userinfo-doc-status')).toBeVisible()
    const userinfoTab = page.locator('.config-tab-btn[data-file="userinfo"]')
    await userinfoTab.scrollIntoViewIfNeeded()
    await userinfoTab.click()
    await expect(page.locator('.config-tab-btn[data-file="userinfo"]')).toHaveClass(/font-bold/)
  })
})
