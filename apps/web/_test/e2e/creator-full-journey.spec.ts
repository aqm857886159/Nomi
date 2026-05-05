import { expect, test } from '@playwright/test'
import {
  addGenerationNode,
  appUrl,
  fillSelectedNodePrompt,
  mockNomiApi,
  mockWorkbenchAgent,
  openFreshStudioProject,
  resetBrowserState,
  selectNode,
  sendGenerationAssistantMessage,
  switchStep,
} from './helpers/nomiTestHarness'

test.describe('P0 creator full journey', () => {
  test.beforeEach(async ({ page }) => {
    await mockNomiApi(page)
    await mockWorkbenchAgent(page)
    await resetBrowserState(page)
  })

  test('navigates project library, opens studio, writes in creation, generates canvas nodes, previews, and persists after refresh', async ({ page }) => {
    await page.goto(appUrl('/studio'))
    await expect(page.getByText(/Nomi 项目库/)).toBeVisible()
    await page.getByLabel('搜索项目').fill('rain')
    await page.getByRole('button', { name: /新建项目/ }).click()
    await expect(page.getByLabel(/Nomi 工作台/)).toBeVisible()

    await switchStep(page, '创作')
    await expect(page.locator('.workbench-editor')).toBeVisible()
    await page.locator('.workbench-editor__content').click()
    await page.keyboard.type('雨夜街道开场，主角在霓虹下发现一张旧照片。')

    await page.locator('.workbench-creation-ai__input').fill('续写下一段并追加到文末')
    await page.getByLabel('创作 AI 发送').click()
    await expect(page.getByText(/AI 追加正文/)).toBeVisible()
    await page.getByRole('button', { name: /应用/ }).click()
    await expect(page.locator('.workbench-editor__content')).toContainText('AI 追加正文')

    await switchStep(page, '生成')
    await expect(page.getByLabel('AI 影像创作画布')).toBeVisible()
    await sendGenerationAssistantMessage(page, 'Agent', '用当前故事做两步雨夜分镜')
    await expect(page.getByText(/已创建 2 个待确认节点/)).toBeVisible()
    await expect(page.locator('.generation-canvas-v2-node')).toHaveCount(4)
    await expect(page.locator('.generation-canvas-v2__edge')).toHaveCount(2)

    const imageNode = await addGenerationNode(page, '图片')
    await selectNode(imageNode)
    await fillSelectedNodePrompt(page, '雨夜街道，霓虹反光，电影感构图。')
    await page.getByLabel('生成素材').click()
    await expect(imageNode).toHaveAttribute('data-status', 'success')
    await expect(imageNode.locator('img.generation-canvas-v2-node__media')).toBeVisible()

    await switchStep(page, '预览')
    await expect(page.getByLabel('预览区')).toBeVisible()
    await expect(page.getByLabel('预览播放器')).toBeVisible()
    await expect(page.getByLabel('预览区').getByRole('region', { name: '预览时间轴' })).toBeVisible()
    await page.getByLabel('预览画幅').selectOption('9:16')
    await expect(page.getByLabel('预览画幅')).toHaveValue('9:16')

    await page.reload()
    await expect(page.getByLabel(/Nomi 工作台/)).toBeVisible()
    await switchStep(page, '生成')
    await expect(page.locator('.generation-canvas-v2-node[data-kind="image"]')).toHaveCount(3)
    await page.getByLabel('返回项目库').click()
    await expect(page.getByText(/Nomi 项目库/)).toBeVisible()
    await expect(page.getByText(/未命名项目/)).toBeVisible()
    await page.getByText(/继续创作/).first().click()
    await expect(page.getByLabel(/Nomi 工作台/)).toBeVisible()
  })
})
