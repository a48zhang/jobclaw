import { test, expect } from './support/lightpanda.js'

test.describe('JobClaw React UI', () => {
  test('loads the React app shell with conversation-first homepage', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('JobClaw')
    await expect(page.locator('text=任务入口')).toHaveCount(0)
    await expect(page.locator('text=Agent First')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '对话' })).toBeVisible()
    await expect(page.locator('#chat-input')).toBeVisible()
    await expect(page.getByRole('button', { name: '发送' })).toBeVisible()
    await expect(page.locator('[data-target="tab-chat"]')).toHaveAttribute('aria-selected', 'true')
  })

  test('navigation switches between user-facing work areas', async ({ page }) => {
    await page.getByRole('button', { name: '职位' }).click()
    await expect(page.locator('text=先找出现在值得处理的职位')).toBeVisible()
    await expect(page.locator('#jobs-search')).toBeVisible()

    await page.getByRole('button', { name: '配置' }).click()
    await expect(page.locator('text=把连接和资料补齐，后面的搜索和简历才会稳定')).toBeVisible()
    await expect(page.locator('text=连接设置')).toBeVisible()

    await page.getByRole('button', { name: '简历' }).click()
    await expect(page.locator('text=先生成最新版本，结果就留在本页')).toBeVisible()
    await expect(page.getByRole('button', { name: '生成最新简历' })).toBeVisible()
  })

  test('jobs page keeps only filters, list and detail', async ({ page }) => {
    await page.getByRole('button', { name: '职位' }).click()
    await expect(page.locator('#jobs-search')).toBeVisible()
    await expect(page.locator('#jobs-status')).toBeVisible()
    await expect(page.getByRole('button', { name: '刷新' })).toBeVisible()
    await expect(page.locator('aside[aria-label="职位详情"]')).toBeVisible()
    await expect(page.locator('#jobs-batch-toolbar')).toBeHidden()
  })

  test('config page prompts before discarding unsaved doc changes', async ({ page }) => {
    await page.getByRole('button', { name: '配置' }).click()

    const editor = page.locator('.doc-editor')
    await expect(editor).toBeVisible()
    await editor.fill('# dirty change')

    await page.getByRole('button', { name: /userinfo\.md/ }).click()
    await expect(page.locator('#ui-confirm-overlay')).toHaveClass(/is-open/)
    await expect(page.locator('#ui-confirm-message')).toContainText('当前内容还没有保存')
    await page.getByRole('button', { name: '留在当前页' }).click()
    await expect(page.getByRole('button', { name: /targets\.md/ })).toHaveClass(/is-active/)
  })

  test('resume page centers generation and keeps upload/review as optional actions', async ({ page }) => {
    await page.getByRole('button', { name: '简历' }).click()
    await expect(page.getByRole('button', { name: '生成最新简历' })).toBeVisible()
    await expect(page.getByRole('button', { name: '上传参考简历' })).toBeVisible()
    await expect(page.getByRole('button', { name: '获取改进建议' })).toBeVisible()
    await expect(page.locator('text=已有旧简历时再用')).toBeVisible()
  })

  test('intervention modal stays open after invalid submission', async ({ page }) => {
    await page.route('**/api/intervention', (route) => {
      route.fulfill({
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'validation failed' }),
      })
    })

    await page.evaluate(() => {
      window.showModal?.({
        agentName: 'main',
        ownerId: 'main',
        requestId: 'modal-invalid',
        prompt: '请选择一个操作',
        kind: 'single_select',
        options: ['backend', 'frontend'],
      } as any)
    })

    await expect(page.locator('text=需要确认')).toBeVisible()
    await page.locator('input[placeholder="输入内容..."]').fill('invalid-option')
    await page.getByRole('button', { name: '确认' }).click()
    await expect(page.locator('text=validation failed')).toBeVisible()
    await expect(page.locator('text=需要确认')).toBeVisible()
  })
})
