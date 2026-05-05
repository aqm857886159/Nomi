import { expect, test } from '@playwright/test'
import { mockNomiApi, openFreshStudioProject, resetBrowserState, switchStep } from './helpers/nomiTestHarness'

test.describe('P1 mobile creator layout smoke', () => {
  test('keeps the core creation, generation, and preview surfaces reachable on constrained viewports', async ({ page }) => {
    await mockNomiApi(page)
    await resetBrowserState(page)
    await openFreshStudioProject(page)

    await expect(page.getByLabel('Nomi 工作台')).toBeVisible()
    await switchStep(page, '创作')
    await expect(page.locator('.workbench-editor')).toBeVisible()
    await switchStep(page, '生成')
    await expect(page.getByLabel('AI 影像创作画布')).toBeVisible()
    await switchStep(page, '预览')
    await expect(page.getByLabel('预览区')).toBeVisible()
  })
})
