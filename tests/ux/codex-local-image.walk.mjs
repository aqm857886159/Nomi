// R13 走查：Codex 本地生图开关必须真的写入目录并翻转详情页。
// 不调用 Codex、不使用额度；只验证用户点击 → IPC → 持久化 → UI 回读。
import { launchNomiApp } from './_launchApp.mjs'

const { app, win } = await launchNomiApp({ name: 'codex-local-image-toggle' })

try {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      window.localStorage.setItem(key, 'seen')
    }
  })
  await win.reload()
  await win.waitForTimeout(1200)

  const openSettings = win.locator('[data-testid="open-model-settings"]').first()
  await openSettings.waitFor({ timeout: 5000 })
  await openSettings.click()
  await win.locator('[data-model-settings-page="home"]').waitFor({ timeout: 5000 })

  const codexAvailable = win.locator('[data-model-home-available="codex-local"]')
  await codexAvailable.waitFor({ timeout: 5000 })
  await codexAvailable.click()
  await win.locator('[data-model-settings-page="connection"]').waitFor({ timeout: 5000 })

  const toggle = win.getByRole('button', { name: '开启 Codex 本地生图', exact: true })
  await toggle.waitFor({ timeout: 5000 })
  await toggle.click()
  await win.waitForFunction(() => {
    const vendor = window.nomiDesktop.modelCatalog.listVendors().find((item) => item.key === 'codex-local')
    return vendor?.enabled === true
  }, null, { timeout: 5000 })

  const result = await win.evaluate(() => {
    const vendor = window.nomiDesktop.modelCatalog.listVendors().find((item) => item.key === 'codex-local')
    return {
      enabled: vendor?.enabled === true,
      readyText: document.body.textContent?.includes('图片节点里可以选') === true,
      turnOffVisible: document.body.textContent?.includes('关闭') === true,
    }
  })
  if (!result.enabled || !result.readyText || !result.turnOffVisible) {
    throw new Error(`Codex toggle did not settle: ${JSON.stringify(result)}`)
  }
  console.log(`CODEX LOCAL IMAGE TOGGLE PASS: ${JSON.stringify(result)}`)
  await app.close()
} catch (error) {
  console.error(`CODEX LOCAL IMAGE TOGGLE FAIL: ${error?.stack || error}`)
  await app.close().catch(() => undefined)
  process.exitCode = 1
}
