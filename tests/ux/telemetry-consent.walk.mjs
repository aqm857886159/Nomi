// R16/R13 真实旅程：隐私与诊断默认关 → opt-in → 两次 mock 生成 → 查看摘要 → 删除 → 关闭。
// 运行时不提供 NOMI_INTAKE_ENDPOINT / NOMI_INTAKE_TOKEN，故全程验证「只在本机记录」且零网络请求。
import { launchNomiApp } from './_launchApp.mjs'
import { screenshotSettled, expect, expectAbsent, expectVisible, clickOrFail, proveProbe } from './_assert.mjs'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import path from 'node:path'
import { uiText, uiTextWith } from './full-walk/invariants.mjs'

const shotsDir = makeTempDir('nomi-telemetry-consent-evidence-')
process.env.EVIDENCE_DIR = shotsDir
const locale = 'zh-CN'
const copy = (key) => uiText(locale, `settings.general.telemetry.${key}`)
let shotNumber = 0
async function shot(win, name) {
  shotNumber += 1
  await screenshotSettled(win, { path: path.join(shotsDir, `${String(shotNumber).padStart(2, '0')}-${name}.png`) })
}

const { app, win } = await launchNomiApp({
  name: 'telemetry-consent',
  env: { NOMI_INTAKE_ENDPOINT: '', NOMI_INTAKE_TOKEN: '' },
  initialLocalStorage: {
    'nomi:splash:v1': 'seen',
    'nomi:journey-tour:v1': 'seen',
    'nomi:canvas-gesture-hint:v1': 'seen',
    'nomi:locale:v1': locale,
  },
})
try {
  await win.getByRole('button', { name: '设置', exact: true }).click()
  await win.getByRole('button', { name: '通用', exact: true }).click()
  const section = win.locator('[data-settings-section="telemetry"]')
  await expectVisible(section, '隐私与诊断区块')
  await section.scrollIntoViewIfNeeded()

  const toggle = section.getByRole('checkbox', { name: copy('toggle'), exact: true })
  const toggleLabel = section.locator('label').getByText(copy('toggle'), { exact: true })
  const readConsent = () => win.evaluate(() => window.nomiDesktop.settings.telemetry.get())
  await expect(toggle).toBeEnabled()
  await expect(toggle).not.toBeChecked()
  await expect(section).toHaveAttribute('data-telemetry-state', 'disabled')
  expect(await readConsent()).toMatchObject({ enabled: false, status: 'disabled' })
  await shot(win, '01-disabled')

  await toggleLabel.click()
  await expect(toggle).toBeChecked()
  await expect(section).toHaveAttribute('data-telemetry-state', 'unconfigured')
  expect(await readConsent()).toMatchObject({ enabled: true, status: 'unconfigured' })
  await shot(win, '02-enabled-local-only')

  // 两次真实生成任务的 mock 结果，经过同一个主进程 telemetry bridge，避免供应商额度与素材依赖。
  await win.evaluate(async () => {
    // 形状 = 渲染层真实交的那份（src/workbench/api/generationTelemetry.ts）：modelClass 由主进程按 vendorKey 补。
    const props = { capability: 'image', durationBucket: '1-5s', result: 'success', mode: 'text', submitDuration: '1-5s', waitDuration: 'none', upstreamStatus: 'ok' }
    await window.nomiDesktop.telemetry?.track({ eventName: 'generation.completed', vendorKey: 'apimart', props })
    await window.nomiDesktop.telemetry?.track({ eventName: 'generation.completed', vendorKey: 'my-relay', props })
  })
  await section.getByRole('button', { name: copy('viewSummary'), exact: true }).click()
  const summaryRows = section.locator('[data-telemetry-summary-list] > div')
  await expect(summaryRows).toHaveCount(2)
  const summaryProof = await proveProbe(summaryRows.first(), '摘要有生成记录')
  await shot(win, '03-summary-two-generations')

  await section.getByRole('button', { name: copy('deleteAll'), exact: true }).click()
  await expectVisible(section.locator('[data-telemetry-delete-confirm]'), '删除确认')
  await shot(win, '04-delete-confirm')
  await clickOrFail(section.locator('[data-telemetry-delete-confirm]').getByRole('button', { name: copy('deleteAll'), exact: true }), '确认删除遥测本地记录')
  const emptySummary = uiTextWith(locale, 'settings.general.telemetry.summary', { pending: 0, sent: 0 })
  await expectVisible(section.getByText(emptySummary, { exact: true }), '删除后摘要归零')
  await expectAbsent(summaryRows, { provenBy: summaryProof, message: '删除后没有摘要行' })
  await expect(toggle).toBeEnabled()
  await toggleLabel.click()
  await expect(toggle).not.toBeChecked()
  await expect(section).toHaveAttribute('data-telemetry-state', 'disabled')
  expect(await readConsent()).toMatchObject({ enabled: false, status: 'disabled' })
  await shot(win, '05-disabled-after-delete')

  console.log(`PASS: telemetry opt-in journey; ${shotNumber} checkpoints → ${shotsDir}`)
} catch (error) {
  console.error(`TELEMETRY WALK FAIL: ${error?.stack || error}`)
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
}
