import { expect, test } from '@playwright/test'
import { appUrl, mockNomiApi, mockPublicShareProject } from './helpers/nomiTestHarness'

test.describe('P0 share read-only contract', () => {
  test('renders public flow data in V2 read-only canvas and blocks editing controls', async ({ page }) => {
    await mockNomiApi(page)
    await mockPublicShareProject(page)

    await page.goto(appUrl('/share/public-project/public-flow'))

    await expect(page.getByText('Nomi 分享')).toBeVisible()
    await expect(page.locator('.generation-canvas-v2-node[data-kind="image"]')).toHaveCount(1)
    await expect(page.getByLabel('生成画布工具栏')).not.toBeVisible()
    await expect(page.getByLabel('从此节点开始连线')).not.toBeVisible()
    await expect(page.getByLabel('生成素材')).not.toBeVisible()
  })
})
