import { expect, test } from '@playwright/test'
import { mockNomiApi, openFreshStudioProject, resetBrowserState, sendGenerationAssistantMessage, switchStep } from './helpers/nomiTestHarness'

test.describe('P0 model catalog and explicit failure states', () => {
  test.beforeEach(async ({ page }) => {
    await mockNomiApi(page)
    await resetBrowserState(page)
    await openFreshStudioProject(page)
  })

  test('opens the model integration surface from the app bar and generation assistant', async ({ page }) => {
    await page.getByLabel('打开模型接入').click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByLabel('模型接入 Agent')).toBeVisible()
    await page.keyboard.press('Escape')

    const launcher = page.getByRole('button', { name: 'Nomi 生成', exact: true })
    if (await launcher.isVisible().catch(() => false)) await launcher.click()
    await page.locator('.generation-canvas-v2-assistant[data-collapsed="false"]').getByLabel('模型接入').click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('shows explicit assistant failure instead of fake success when the agent endpoint fails', async ({ page }) => {
    await page.route('**/workbench/agents/chat**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'mocked agent failure' }),
      })
    })

    await sendGenerationAssistantMessage(page, 'Agent', '做一组节点')

    await expect(page.getByText(/生成区 Agent 执行失败/)).toBeVisible()
    await expect(page.getByText(/mocked agent failure/)).toBeVisible()
  })

  test('does not silently pass malformed agent plans', async ({ page }) => {
    await switchStep(page, '生成')
    const nodeCountBefore = await page.locator('.generation-canvas-v2-node').count()
    await page.route('**/workbench/agents/chat**', async (route) => {
      const response = { id: 'bad-plan', vendor: 'agents', text: 'not json' }
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: [
          `event: content\ndata: ${JSON.stringify({ delta: response.text })}\n\n`,
          `event: result\ndata: ${JSON.stringify({ response })}\n\n`,
          'event: done\ndata: {"reason":"finished"}\n\n',
        ].join(''),
      })
    })

    await sendGenerationAssistantMessage(page, 'Agent', '做一组节点')

    await expect(page.getByText(/没有返回可解析的节点计划/)).toBeVisible()
    await expect(page.locator('.generation-canvas-v2-node')).toHaveCount(nodeCountBefore)
  })
})
