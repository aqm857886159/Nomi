// 自定义 API：保存连接 → 手填、分类、勾选模型 → 确认后进入本机适配。
// 只用回环地址和假凭据，禁止测试访问供应商或生成素材。
import fs from 'node:fs'
import path from 'node:path'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { clickOrFail, expect, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import { openCustomApiWizard } from './_shell.mjs'
import { uiText, uiTextWith } from './full-walk/invariants.mjs'
import { assertOutsideRepo } from './uiDriverOptions.mjs'

const locale = process.argv[2] === 'en' ? 'en' : 'zh-CN'
const shotsDir = process.env.EVIDENCE_DIR ? assertOutsideRepo(process.env.EVIDENCE_DIR) : makeTempDir('model-pick-confirm-')
fs.mkdirSync(shotsDir, { recursive: true })
process.env.EVIDENCE_DIR = shotsDir
const text = (key, values) => values ? uiTextWith(locale, key, values) : uiText(locale, key)
const modelText = (key, values) => text(`onboardingProviders.modelControls.${key}`, values)
const models = [
  ['gpt-5.5', 'text'],
  ['flux-2-flex', 'image'],
  ['kling-v3', 'video'],
  ['doubao-tts-2.0', 'audio'],
  ['deepseek-v4-pro', 'text'],
]
const { win, close } = await launchNomiApp({
  name: 'model-pick-confirm',
  env: { NOMI_TEST_NETWORK_GUARD: '1' },
  initialLocalStorage: {
    'nomi:locale:v1': locale,
    'nomi:splash:v1': 'seen',
    'nomi:journey-tour:v1': 'seen',
    'nomi:canvas-gesture-hint:v1': 'seen',
  },
})
const snap = (name) => screenshotSettled(win, { path: path.join(shotsDir, `${locale}-${name}.png`) })

try {
  await openCustomApiWizard(win)
  const wizard = win.locator('[data-model-access-entry~="relay-model-discovery"]')
  const source = wizard.getByPlaceholder(text('modelSetup.vendorNamePlaceholder'), { exact: true })
  await expect(source).toBeVisible()
  await snap('01-connection')
  await source.fill('Picker loopback')
  await wizard.getByPlaceholder(text('modelSetup.openAiUrlPlaceholder'), { exact: true }).fill('http://127.0.0.1:1/v1')
  await wizard.getByPlaceholder(text('modelSetup.apiKeyPlaceholder'), { exact: true }).fill('sk-fixture-model-picker')
  await clickOrFail(wizard.getByRole('button', { name: text('modelSetup.saveConnection'), exact: true }), '保存连接')
  const saved = wizard.locator('[data-model-connection-saved]')
  await expect(saved).toBeVisible()
  await snap('02-connection-saved')

  await clickOrFail(saved.getByRole('button', { name: text('modelSetup.manualEnter'), exact: true }), '手动输入模型 ID')
  const manual = wizard.getByPlaceholder(modelText('manualPlaceholder'), { exact: true })
  await expect(wizard.getByText(modelText('endpointEmpty'), { exact: true })).toBeVisible()
  await expect(wizard.getByRole('button', { name: modelText('addModels', { count: 0 }), exact: true })).toBeDisabled()
  await snap('03-picker-empty')

  for (const [id, kind] of models) {
    await manual.fill(id)
    await manual.press('Enter')
    await expect(wizard.getByRole('button', { name: id, exact: true })).toBeVisible()
    await expect(wizard.getByRole('button', { name: modelText('retypeAria', { name: id }), exact: true })).toHaveText(modelText(`kind.${kind}`))
  }
  await expect(wizard.getByRole('button', { name: modelText('addModels', { count: models.length }), exact: true })).toBeEnabled()
  await snap('04-picker-grouped')

  const excluded = models.at(-1)[0]
  await clickOrFail(wizard.getByRole('button', { name: excluded, exact: true }), '取消一个已选模型')
  const confirm = wizard.getByRole('button', { name: modelText('addModels', { count: models.length - 1 }), exact: true })
  await expect(confirm).toBeEnabled()
  await snap('05-picker-toggled')
  await clickOrFail(confirm, '确认所选模型')

  const adapter = win.locator('[data-model-access-entry="provider-adapter"]')
  await expect(adapter).toBeVisible()
  for (const [id] of models.slice(0, -1)) await expect(adapter.getByText(id, { exact: true }).first()).toBeVisible()
  const submittedProbe = await proveProbe(adapter.getByText(models[0][0], { exact: true }), '适配页面能找到一个已提交的模型')
  await expectAbsent(adapter.getByText(excluded, { exact: true }), { provenBy: submittedProbe, message: '取消勾选的模型没有进入适配' })
  await snap('06-adapter-selection')
  console.log(`PASS ${locale}: 保存连接、四种模型类型、五选减一、仅四个模型进入适配。证据 ${shotsDir}`)
} finally {
  await close()
}
