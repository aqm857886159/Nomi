import { expect, test } from '@playwright/test'
import { mockNomiApi, mockWorkbenchAgent, openFreshStudioProject, resetBrowserState, switchStep } from './helpers/nomiTestHarness'

test.describe('P0 creation AI document workflow', () => {
  test.beforeEach(async ({ page }) => {
    await mockNomiApi(page)
    await mockWorkbenchAgent(page)
    await resetBrowserState(page)
    await openFreshStudioProject(page)
    await switchStep(page, '创作')
  })

  test('submits with Enter, keeps Shift+Enter for line breaks, and can paste assistant text into the document', async ({ page }) => {
    const creationInput = page.locator('.workbench-creation-ai__input')
    await expect(creationInput).toBeVisible()

    await creationInput.fill('写一个雨夜开场')
    await creationInput.press('Shift+Enter')
    await expect(creationInput).toHaveValue('写一个雨夜开场\n')

    await creationInput.press('Enter')
    await expect(page.getByText(/AI 追加正文：写一个雨夜开场/)).toBeVisible()

    await page.getByLabel('粘贴到文档').click()
    await expect(page.getByLabel('已粘贴到文档')).toBeVisible()
    await expect(page.locator('.workbench-editor')).toContainText('AI 追加正文：写一个雨夜开场')
  })
})
