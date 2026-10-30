// Current visible workaround for a declaration whose input controls were not projected.
// This edits the existing capability form, never injects a contract into the catalog.
import { expect, proveProbe, expectAbsent } from './_assert.mjs'
import { openModelSettings } from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'

export async function configureRelayMinimumThroughVisibleUi(win, plan, capture) {
  const hasControls = await win.evaluate(async (wanted) => {
    const row = (await window.nomiDesktop.modelCatalog.listModels({})).find((r) => r.vendorKey === wanted.vendorKey && r.modelKey === wanted.modelKey)
    return row?.meta?.customCapabilityContract?.modes?.some((mode) => ['duration', 'resolution'].every((key) => mode.params?.some((p) => p.key === key))) ?? false
  }, plan)
  if (hasControls) return { manualInputSetup: false }
  const locale = await win.evaluate(() => localStorage.getItem('nomi:locale:v1') || 'zh-CN')
  const tr = (key) => uiText(locale, `onboardingProviders.workspace.capability.${key}`)
  await openModelSettings(win)
  await win.locator(`[data-model-home-connection="${plan.vendorKey}"]`).click()
  await win.getByText(plan.modelKey, { exact: true }).last().click()
  await win.getByRole('button', { name: new RegExp(`设置 ${plan.modelKey} 的输入与生成方式|Set inputs and generation for ${plan.modelKey}`) }).click()
  const page = win.locator('[data-model-settings-page="capability"]')
  await page.locator('[data-capability-mode-row="0"]').click()
  const field = (name) => page.locator(`[data-capability-field="${name}"]`)
  const select = async (name, label) => {
    await field(name).getByRole('button').click()
    await win.getByRole('option').and(win.getByTitle(label, { exact: true })).click()
  }
  await page.getByRole('button', { name: tr('editor.addParameter'), exact: true }).click()
  await field('modes.0.parameters.0.key').fill('duration')
  await field('modes.0.parameters.0.label').fill(locale === 'en' ? 'Duration' : '时长')
  await select('modes.0.parameters.0.type', tr('parameterType.number'))
  await field('modes.0.parameters.0.min').fill(String(plan.duration))
  await field('modes.0.parameters.0.max').fill('15')
  const numberGrid = field('modes.0.parameters.0.key').locator('xpath=ancestor::label[1]/..')
  const useDefault = numberGrid.getByRole('switch')
  await useDefault.focus()
  await useDefault.press('Space')
  await expect(useDefault).toBeChecked()
  await field('modes.0.parameters.0.defaultValue').fill(String(plan.duration))
  await page.getByRole('button', { name: tr('editor.addParameter'), exact: true }).click()
  await field('modes.0.parameters.1.key').fill('resolution')
  await field('modes.0.parameters.1.label').fill(locale === 'en' ? 'Resolution' : '清晰度')
  await select('modes.0.parameters.1.type', tr('parameterType.select'))
  await page.getByRole('button', { name: tr('editor.addOption'), exact: true }).click()
  await field('modes.0.parameters.1.options.0.value').fill(plan.resolution)
  await field('modes.0.parameters.1.options.0.label').fill(plan.resolution)
  await select('modes.0.parameters.1.defaultValue', plan.resolution)
  await capture('manual-input-controls')
  const capabilityProof = await proveProbe(page, 'Capability editor is present before saving')
  await page.getByRole('button', { name: tr('editor.save'), exact: true }).click()
  await expectAbsent(page, { provenBy: capabilityProof, message: 'Saving closes the capability editor' })
  const detail = win.locator('[data-model-settings-dialog]')
  const detailProof = await proveProbe(detail, 'Model detail remains above Settings after saving capability')
  await detail.getByRole('button', { name: /^(关闭|Close)$/ }).click()
  await expectAbsent(detail, { provenBy: detailProof, message: 'Close the model detail before closing Settings' })
  await win.locator('[data-settings-close]').click()
  return { manualInputSetup: true, reason: 'declaration did not project visible duration and resolution controls' }
}
