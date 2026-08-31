// APIMart 设置页 direct-key 走查（零额度）。
//
// 这条旅程只验证用户真正会走的设置路径：模型设置 → APIMart → 输入 key → 安全保存。
// Electron 使用隔离 profile；key 是合成值，不访问 APIMart，也不把凭证打印到报告。
// 生成 provider 的网络闭环由 project-agent-resident-real-tasks.walk.mjs 单独覆盖。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectVisible, screenshotSettled } from './_assert.mjs'

const FIXTURE_KEY = 'sk-ui-settings-fixture'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-apimart-key-settings-'))
const shotDir = path.join(repoRoot, 'tests/ux/shots/apimart-key-settings')
fs.mkdirSync(shotDir, { recursive: true })
const shotPath = path.join(shotDir, '01-connected.png')
let app

try {
  const launched = await launchNomiApp({
    name: 'apimart-key-settings',
    tempRoot,
    syntheticCredentialStorage: true,
    settleMs: 1200,
    env: { NOMI_DISABLE_AUTO_UPDATE: '1' },
    args: ['--no-proxy-server'],
  })
  app = launched.app
  const { win } = launched
  win.setDefaultTimeout(15_000)

  // 跳过首次启动遮罩后重载；是否出现遮罩不是本旅程的被测变量。
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      window.localStorage.setItem(key, 'seen')
    }
  })
  await win.reload()

  const settingsTrigger = win.locator('[data-testid="open-model-settings"]').first()
  await expectVisible(settingsTrigger, '模型设置入口应可见')
  await clickOrFail(settingsTrigger, '打开模型设置')

  const home = win.locator('[data-model-settings-page="home"]')
  await expectVisible(home, '模型设置首页应显示')
  const apimartRow = win.locator('[data-model-home-available="apimart"]')
  await expectVisible(apimartRow, 'APIMart 可接入行应显示')
  await clickOrFail(apimartRow, '打开 APIMart 设置')

  const keyPage = win.locator('[data-key-only-vendor="apimart"]')
  await expectVisible(keyPage, 'APIMart key 设置页应显示')
  const keyInput = win.locator('#key-only-apimart')
  await expectVisible(keyInput, 'APIMart key 输入框应显示')
  await expect(keyInput, 'APIMart key 必须以密码字段呈现').toHaveAttribute('type', 'password')
  await keyInput.fill(FIXTURE_KEY)

  const saveButton = win.getByRole('button', { name: /安全保存并完成|Save and finish|Save/ }).last()
  await expectVisible(saveButton, 'APIMart 安全保存按钮应显示')
  await clickOrFail(saveButton, '安全保存 APIMart key')

  const success = win.locator('[data-key-only-success]')
  await expectVisible(success, '保存后应显示连接结果')
  await expect(success, 'APIMart direct-key 保存应直接完成').toHaveAttribute('data-key-only-outcome', 'connected')

  // 只读取公开 DTO：确认启用状态与 key 存在，不读取/打印凭证值。
  const catalogState = await win.evaluate(() => {
    const vendor = window.nomiDesktop.modelCatalog.listVendors().find((item) => item.key === 'apimart')
    if (!vendor) return null
    return {
      enabled: vendor.enabled === true,
      hasApiKey: vendor.hasApiKey === true,
      credentialMode: vendor.credentialMode,
      credentialNotExposed: !Object.keys(vendor).some((key) => /^(apiKey|secret|token|credential)$/i.test(key)),
    }
  })
  expect(catalogState, 'APIMart 公开目录应返回已保存连接').toMatchObject({
    enabled: true,
    hasApiKey: true,
    credentialMode: 'direct-key',
    credentialNotExposed: true,
  })

  await screenshotSettled(win, { path: shotPath })
  console.log(JSON.stringify({
    result: 'passed',
    assertions: 13,
    screenshot: shotPath,
    networkCalls: 0,
    paidCalls: 0,
  }, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
} finally {
  try {
    if (app) await app.close()
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}
