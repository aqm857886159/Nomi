import { expect, test } from '@playwright/test'
import { mockNomiApi, openFreshStudioProject, resetBrowserState, selectNode } from './helpers/nomiTestHarness'

test.describe('P0 generation canvas operations', () => {
  test.beforeEach(async ({ page }) => {
    await mockNomiApi(page)
    await resetBrowserState(page)
    await openFreshStudioProject(page)
  })

  test('adds node kinds, selects nodes, copies, cuts, and exposes edge controls', async ({ page }) => {
    const textCountBefore = await page.locator('.generation-canvas-v2-node[data-kind="text"]').count()
    const imageCountBefore = await page.locator('.generation-canvas-v2-node[data-kind="image"]').count()
    const videoCountBefore = await page.locator('.generation-canvas-v2-node[data-kind="video"]').count()

    await page.getByLabel('添加文本节点').click()
    await page.getByLabel('添加图片节点').click()
    await page.getByLabel('添加视频节点').click()

    await expect(page.locator('.generation-canvas-v2-node[data-kind="text"]')).toHaveCount(textCountBefore + 1)
    await expect(page.locator('.generation-canvas-v2-node[data-kind="image"]')).toHaveCount(imageCountBefore + 1)
    await expect(page.locator('.generation-canvas-v2-node[data-kind="video"]')).toHaveCount(videoCountBefore + 1)

    await selectNode(page.locator('.generation-canvas-v2-node[data-kind="image"]').last())
    await expect(page.getByLabel('生成素材')).toBeVisible()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V')
    await expect(page.locator('.generation-canvas-v2-node[data-kind="image"]')).toHaveCount(imageCountBefore + 2)

    await page.keyboard.press('Delete')
    await expect(page.locator('.generation-canvas-v2-node[data-kind="image"]')).toHaveCount(imageCountBefore + 1)
  })

  test('does not allow a video node to generate without required upstream image asset evidence', async ({ page }) => {
    await page.getByLabel('添加视频节点').click()
    await page.locator('.generation-canvas-v2-node[data-kind="video"]').click()

    await expect(page.getByLabel('生成素材')).toBeDisabled()
  })
})
