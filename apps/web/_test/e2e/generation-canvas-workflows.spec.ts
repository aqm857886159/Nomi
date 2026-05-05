import { expect, test } from '@playwright/test'
import {
  addGenerationNode,
  fillSelectedNodePrompt,
  mockNomiApi,
  mockWorkbenchAgent,
  openFreshStudioProject,
  resetBrowserState,
  selectNode,
  switchStep,
} from './helpers/nomiTestHarness'

test.describe('P0 generation canvas workflows', () => {
  test.beforeEach(async ({ page }) => {
    await mockNomiApi(page)
    await mockWorkbenchAgent(page)
    await resetBrowserState(page)
    await openFreshStudioProject(page)
  })

  test('supports canvas CRUD, model selection, mocked generation, zoom, and deletion', async ({ page }) => {
    await expect(page.locator('.generation-canvas-v2-node')).toHaveCount(2)
    const nodeCountBefore = await page.locator('.generation-canvas-v2-node').count()
    const videoCountBefore = await page.locator('.generation-canvas-v2-node[data-kind="video"]').count()
    const imageNode = await addGenerationNode(page, '图片')
    await selectNode(imageNode)
    await fillSelectedNodePrompt(page, '一张用于端到端测试的雨夜城市图。')

    await expect(page.getByLabel('模型').last()).toBeVisible()
    await page.getByLabel('模型').last().selectOption('fixture-image-model')
    await expect(page.getByLabel('模型').last()).toHaveValue('fixture-image-model')
    await expect(page.getByLabel('比例').last()).toBeVisible()

    const videoNode = await addGenerationNode(page, '视频')
    await expect(page.locator('.generation-canvas-v2-node')).toHaveCount(nodeCountBefore + 2)
    await selectNode(videoNode)
    await fillSelectedNodePrompt(page, '镜头缓慢推进，霓虹倒影在地面流动。')
    await page.getByLabel('模型').last().selectOption('fixture-video-model')
    await expect(page.getByLabel('时长').last()).toBeVisible()

    await selectNode(videoNode)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V')
    await expect(page.locator('.generation-canvas-v2-node[data-kind="video"]')).toHaveCount(videoCountBefore + 2)

    await page.getByLabel('重置视图').click()
    await page.getByLabel('缩放比例').fill('120')
    await expect(page.getByLabel('缩放比例')).toHaveValue('120')

    await selectNode(page.locator('.generation-canvas-v2-node[data-kind="video"]').last())
    await page.keyboard.press('Delete')
    await expect(page.locator('.generation-canvas-v2-node[data-kind="video"]')).toHaveCount(videoCountBefore + 1)

    await selectNode(imageNode)
    await page.getByLabel('生成素材').click()
    await expect(imageNode).toHaveAttribute('data-status', 'success')
    await expect(imageNode.locator('img.generation-canvas-v2-node__media')).toHaveAttribute('src', /nomi-fixture-image/)
  })

  test('timeline and preview expose real editing controls without external media calls', async ({ page }) => {
    const imageNode = await addGenerationNode(page, '图片')
    await selectNode(imageNode)
    await fillSelectedNodePrompt(page, '预览烟测图片')
    await page.getByLabel('生成素材').click()
    await expect(imageNode).toHaveAttribute('data-status', 'success')
    await expect(page.getByRole('region', { name: '生成时间轴' })).toBeVisible()
    const generationTimeline = page.getByRole('region', { name: '生成时间轴' })
    await expect(generationTimeline.locator('[data-testid="timeline-track"][data-track-type="image"]')).toBeVisible()
    await generationTimeline.getByLabel('生成时间轴-放大时间轴').click()
    await generationTimeline.locator('.workbench-timeline-track__clips').first().click()

    await switchStep(page, '预览')
    await expect(page.getByLabel('预览播放器')).toBeVisible()
    await expect(page.getByText('画面预览')).toBeVisible()
    await page.getByLabel('切换安全框').click()
    await expect(page.getByLabel('切换安全框')).toHaveAttribute('aria-pressed', 'true')
    await page.getByLabel('画面适配').selectOption('cover')
    await expect(page.getByLabel('画面适配')).toHaveValue('cover')
  })

  test('model catalog drawer surfaces catalog health, vendors, models, and mappings', async ({ page }) => {
    await page.getByLabel('打开模型接入').click()

    await expect(page.getByText('接入模型')).toBeVisible()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByLabel('模型接入 Agent')).toBeVisible()
    await expect(page.getByText('直接对话接入模型')).toBeVisible()
  })
})
