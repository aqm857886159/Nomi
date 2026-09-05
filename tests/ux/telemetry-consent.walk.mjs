// R16/R13 真实旅程：隐私与诊断默认关 → opt-in → 两次 mock 生成 → 查看摘要 → 删除 → 关闭。
// 运行时不提供 NOMI_APTABASE_APP_KEY，故全程验证「只在本机记录」且零网络请求。
import { launchNomiApp } from './_launchApp.mjs'
import { screenshotSettled, expectVisible, clickOrFail } from './_assert.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/telemetry-optin')
fs.mkdirSync(shotsDir, { recursive: true })
const failures = []
let shotNumber = 0
async function shot(win, name) {
  shotNumber += 1
  await screenshotSettled(win, { path: path.join(shotsDir, `${String(shotNumber).padStart(2, '0')}-${name}.png`) })
}

const { app, win } = await launchNomiApp({ name: 'telemetry-consent', env: { NOMI_APTABASE_APP_KEY: '' } })
try {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(key, 'seen')
    window.localStorage.setItem('nomi:locale:v1', 'zh-CN')
  })
  await win.reload()
  await win.getByRole('button', { name: '设置', exact: true }).click()
  await win.getByRole('button', { name: '通用', exact: true }).click()
  const section = win.locator('[data-settings-section="telemetry"]')
  await expectVisible(section, '隐私与诊断区块')
  await section.scrollIntoViewIfNeeded()
  await shot(win, '01-disabled')

  const toggle = section.getByRole('checkbox', { name: '帮助改进 Nomi', exact: true })
  if (await toggle.isChecked()) failures.push('新 profile 默认不应开启遥测')
  await toggle.check()
  if (await section.getAttribute('data-telemetry-state') !== 'unconfigured') failures.push('开启后应显示未配置端点')
  await shot(win, '02-enabled-local-only')

  // 两次真实生成任务的 mock 结果，经过同一个主进程 telemetry bridge，避免供应商额度与素材依赖。
  await win.evaluate(async () => {
    await window.nomiDesktop.telemetry?.track({ eventName: 'generation.completed', props: { capability: 'image', durationBucket: '1-5s', result: 'success', attemptCountBucket: '1' } })
    await window.nomiDesktop.telemetry?.track({ eventName: 'generation.completed', props: { capability: 'image', durationBucket: '1-5s', result: 'success', attemptCountBucket: '1' } })
  })
  await section.getByRole('button', { name: '查看待发 / 已发摘要', exact: true }).click()
  await expectVisible(section.locator('[data-telemetry-summary-list]'), '摘要列表')
  if (await section.locator('[data-telemetry-summary-list] div').count() !== 2) failures.push('两次 mock 生成应显示 2 条摘要')
  await shot(win, '03-summary-two-generations')

  await section.getByRole('button', { name: '删除全部', exact: true }).click()
  await expectVisible(section.locator('[data-telemetry-delete-confirm]'), '删除确认')
  await shot(win, '04-delete-confirm')
  await clickOrFail(section.locator('[data-telemetry-delete-confirm]').getByRole('button', { name: '确认', exact: true }), '确认删除遥测本地记录')
  await expectVisible(section.getByText('待发 0 条 · 已发 0 条', { exact: true }), '删除后摘要归零')
  await toggle.uncheck()
  if (await section.getAttribute('data-telemetry-state') !== 'disabled') failures.push('关闭遥测')
  await shot(win, '05-disabled-after-delete')

  console.log(`PASS: telemetry opt-in journey; ${shotNumber} screenshots → ${path.relative(repoRoot, shotsDir)}`)
  if (failures.length) throw new Error(failures.join('; '))
  await app.close()
} catch (error) {
  console.error(`TELEMETRY WALK FAIL: ${error?.stack || error}`)
  await app.close().catch(() => undefined)
  process.exitCode = 1
}
