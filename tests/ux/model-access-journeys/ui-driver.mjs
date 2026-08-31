import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp } from '../_launchApp.mjs'
import { JourneyFailure } from './evidence.mjs'

export async function launchJourneyUi({ journey, recorder }) {
  const launched = await launchNomiApp({ name: `model-access-${journey.id.toLowerCase()}` })
  const { win, settingsDir } = launched
  const diagnostics = []
  win.on('pageerror', (error) => diagnostics.push(`pageerror: ${String(error)}`))
  win.on('console', (message) => { if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`) })
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'zh-CN'))
  await win.reload({ waitUntil: 'domcontentloaded' })
  const skip = win.locator('[data-splash-skip="true"]')
  if (await skip.isVisible().catch(() => false)) await skip.click()

  async function openModels() {
    await win.getByRole('button', { name: '设置', exact: true }).first().click()
    const dialog = win.getByRole('dialog', { name: '设置', exact: true })
    await dialog.waitFor({ state: 'visible', timeout: 8000 })
    await dialog.getByRole('button', { name: '模型', exact: true }).click()
    await win.locator('[data-settings-section="models"]').waitFor({ state: 'visible', timeout: 8000 })
    await win.waitForTimeout(600)
  }

  async function expandGenerationProviders() {
    const button = win.getByRole('button', { name: /接入生成模型/ }).first()
    await button.waitFor({ state: 'visible', timeout: 5000 })
    if (!(await win.getByRole('button', { name: '添加模型 / 中转站', exact: true }).isVisible().catch(() => false))) await button.click()
  }

  async function openRelayWizard() {
    await expandGenerationProviders()
    await win.getByRole('button', { name: '添加模型 / 中转站', exact: true }).click()
    await win.getByText('添加一个 AI 模型', { exact: true }).waitFor({ state: 'visible', timeout: 5000 })
  }

  async function fillRelay({ name, baseUrl, apiKey = 'sk-fixture-key' }) {
    await win.getByPlaceholder('如：TOAPI 中转').fill(name)
    await win.getByPlaceholder('https://api.openai.com/v1').fill(baseUrl)
    await win.getByPlaceholder('sk-...').fill(apiKey)
  }

  async function fetchModels() {
    await win.getByRole('button', { name: '拉取模型', exact: true }).click()
    const choose = win.getByRole('button', { name: /选择模型|挑选模型/ }).first()
    await choose.waitFor({ state: 'visible', timeout: 15_000 })
    await choose.click()
    await win.getByPlaceholder(/搜索.*模型|模型.*ID/i).last().waitFor({ state: 'visible', timeout: 5000 })
  }

  async function chooseModels(modelIds) {
    for (const modelId of modelIds) {
      const label = win.getByText(modelId, { exact: true })
      await label.waitFor({ state: 'visible', timeout: 5000 })
      await label.click()
    }
    const confirm = win.getByRole('button', { name: new RegExp(`(?:接入并验证|添加)\\s*${modelIds.length}\\s*个`) }).first()
    await confirm.click()
  }

  async function fetchAndChooseModels(modelIds) {
    await fetchModels()
    await chooseModels(modelIds)
  }

  async function waitForCatalogModels(modelIds, timeoutMs = 25_000) {
    const catalogPath = path.join(settingsDir, 'model-catalog.json')
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (fs.existsSync(catalogPath)) {
        const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
        if (modelIds.every((id) => catalog.models?.some((model) => model.modelKey === id))) return catalog
      }
      await win.waitForTimeout(300)
    }
    throw new JourneyFailure('models-not-persisted', `UI did not persist models within ${timeoutMs}ms`, { modelIds })
  }

  function catalogSnapshot() {
    const catalogPath = path.join(settingsDir, 'model-catalog.json')
    if (!fs.existsSync(catalogPath)) return null
    const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
    return {
      vendors: raw.vendors,
      models: raw.models,
      mappings: raw.mappings,
      apiKeyVendors: Object.keys(raw.apiKeysByVendor || {}).sort(),
    }
  }

  async function closeAccessModal() {
    const dialog = win.getByRole('dialog').filter({ hasText: '添加一个 AI 模型' }).last()
    if (!(await dialog.isVisible().catch(() => false))) return
    const action = dialog.getByRole('button', { name: /后台运行|转到后台|完成/ }).last()
    if (await action.isVisible().catch(() => false)) await action.click()
    else await dialog.getByRole('button', { name: /关闭/ }).last().click()
    await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  }

  async function closeSettings() {
    await closeAccessModal()
    const dialog = win.getByRole('dialog', { name: '设置', exact: true })
    if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  }

  async function openCanvas() {
    await closeSettings()
    const existing = win.locator('[data-project-card]').first()
    if (await existing.count()) await existing.click()
    else await win.getByText('新建空白项目', { exact: false }).first().click()
    await win.waitForTimeout(1800)
    await win.getByRole('button', { name: '生成', exact: false }).first().click()
    await win.waitForTimeout(800)
  }

  return {
    ...launched,
    diagnostics,
    openModels,
    expandGenerationProviders,
    openRelayWizard,
    fillRelay,
    fetchModels,
    chooseModels,
    fetchAndChooseModels,
    waitForCatalogModels,
    catalogSnapshot,
    closeAccessModal,
    closeSettings,
    openCanvas,
    screenshot: (name) => recorder.screenshot(win, name),
  }
}
