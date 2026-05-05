import { expect, test } from '@playwright/test'
import {
  addGenerationNode,
  fillSelectedNodePrompt,
  mockNomiApi,
  mockWorkbenchAgent,
  openFreshStudioProject,
  resetBrowserState,
  selectNode,
  sendGenerationAssistantMessage,
  switchStep,
} from './helpers/nomiTestHarness'

test.describe('P0 generation assistant modes and failures', () => {
  test.beforeEach(async ({ page }) => {
    await mockNomiApi(page)
    await mockWorkbenchAgent(page)
    await resetBrowserState(page)
    await openFreshStudioProject(page)
  })

  test('Agent mode creates editable planned nodes and planned edges', async ({ page }) => {
    await switchStep(page, '生成')
    const textCountBefore = await page.locator('.generation-canvas-v2-node[data-kind="text"]').count()
    const imageCountBefore = await page.locator('.generation-canvas-v2-node[data-kind="image"]').count()
    const edgeCountBefore = await page.locator('.generation-canvas-v2__edge').count()

    await sendGenerationAssistantMessage(page, 'Agent', '做两步雨夜分镜')

    await expect(page.getByText(/已创建 2 个待确认节点/)).toBeVisible()
    await expect(page.locator('.generation-canvas-v2-node[data-kind="text"]')).toHaveCount(textCountBefore + 1)
    await expect(page.locator('.generation-canvas-v2-node[data-kind="image"]')).toHaveCount(imageCountBefore + 1)
    await expect(page.locator('.generation-canvas-v2__edge')).toHaveCount(edgeCountBefore + 1)
  })

  test('chat mode answers without creating nodes or requiring a plan', async ({ page }) => {
    await switchStep(page, '生成')
    const nodeCountBefore = await page.locator('.generation-canvas-v2-node').count()

    await sendGenerationAssistantMessage(page, '问答', '这个节点为什么失败？')

    await expect(page.getByText(/这是问答回复/)).toBeVisible()
    await expect.poll(async () => page.locator('.generation-canvas-v2-node').count()).toBe(nodeCountBefore)
    await expect(page.getByText(/没有返回可解析的节点计划/)).not.toBeVisible()
  })

  test('refine mode updates selected prompt instead of creating another node', async ({ page }) => {
    const imageNode = await addGenerationNode(page, '图片')
    await selectNode(imageNode)
    const nodeCountBefore = await page.locator('.generation-canvas-v2-node').count()

    await sendGenerationAssistantMessage(page, '润色', '把选中节点改成电影感')

    await expect(page.getByText('已更新选中节点的提示词。')).toBeVisible()
    await expect.poll(async () => page.locator('.generation-canvas-v2-node').count()).toBe(nodeCountBefore)
    await expect(page.locator('.generation-canvas-v2-node__prompt-input')).toHaveValue(/电影感黄昏水彩镜头/)
  })

  test('explicit agent failure is visible and does not create nodes', async ({ page }) => {
    await switchStep(page, '生成')
    const nodeCountBefore = await page.locator('.generation-canvas-v2-node').count()
    await page.unroute('**/workbench/agents/chat**')
    await page.route('**/workbench/agents/chat**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'fixture agent failure' }),
      })
    })

    await sendGenerationAssistantMessage(page, 'Agent', '这次返回失败状态')

    await expect(page.getByText(/生成区 Agent 执行失败/)).toBeVisible()
    await expect(page.locator('.generation-canvas-v2-node')).toHaveCount(nodeCountBefore)
  })

  test('generation task failure marks the selected node with the upstream reason', async ({ page }) => {
    await page.unroute('**/api/tasks')
    await page.route('**/api/tasks', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'fixture-failed-task',
          kind: 'text_to_image',
          status: 'failed',
          assets: [],
          raw: { message: 'fixture model rejected prompt' },
        }),
      })
    })

    const imageNode = await addGenerationNode(page, '图片')
    await selectNode(imageNode)
    await fillSelectedNodePrompt(page, '触发失败的图像提示词')
    await page.getByLabel('生成素材').click()

    await expect(imageNode).toHaveAttribute('data-status', 'error')
    await expect(page.getByRole('alert')).toContainText('fixture model rejected prompt')
  })
})
