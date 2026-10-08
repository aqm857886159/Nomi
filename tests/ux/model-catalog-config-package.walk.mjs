import { makeTempDir } from '../../scripts/_test-temp.mjs'
// R13 走查 —— 「重装之后我的模型配置还在不在、能不能搬走」（2026-09-21）。
//
// 起因是 Windows 群友那句「换路径重装、装回旧版后所有模型配置都没了」。配置一条都没丢；
// 少的是**一句话**和**一条退路**：界面没说「这一次没读到 / 这份只能读」，也没有任何办法把配置搬走。
//
// 这条走查证三件事，每件都在真 Electron、真 IPC、真设置页上：
//   ① 模型设置页的「高级」组里有**导出 / 导入**两颗动作，是图标 + tooltip，不是一串文字按钮；
//   ② 旁边那行常驻说明必须同时讲清两件会改变预期的事：**导出不含密钥**、**导入默认保留本机已有**；
//   ③ 点导出真的产出一份包，而且包里**一个密钥字段都没有**。
//
// 用法: pnpm run build && node tests/ux/model-catalog-config-package.walk.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectVisible, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = process.env.CONFIG_PACKAGE_WALK_OUT || path.join(repoRoot, 'tests/ux/shots/model-catalog-config-package')
fs.mkdirSync(outDir, { recursive: true })

const stamp = '2026-09-21T00:00:00.000Z'
const catalogJson = JSON.stringify({
  version: 12,
  vendors: [{ key: 'ux-local', name: 'UX Local', enabled: true, authType: 'bearer', providerKind: 'openai-compatible', baseUrlHint: 'https://example.invalid/v1', createdAt: stamp, updatedAt: stamp }],
  models: [{ vendorKey: 'ux-local', modelKey: 'demo-image', labelZh: 'Demo Image', kind: 'image', enabled: true, meta: {}, createdAt: stamp, updatedAt: stamp }],
  mappings: [],
  apiKeysByVendor: {},
}, null, 2)

const failures = []
const screenshots = []
let appInstance = null
let win = null

const snap = async (name) => {
  const file = path.join(outDir, name)
  await screenshotSettled(win, { path: file })
  screenshots.push(file)
}

/** 每种语言一次冷启动、一份全新 profile：语言只在启动时读一次，同一个 profile 第二次种不进去。 */
async function openModelSettings(locale) {
  const root = makeTempDir('nomi-config-package-')
  const settingsDir = path.join(root, 'settings')
  const projectsDir = path.join(root, 'projects')
  fs.mkdirSync(settingsDir, { recursive: true })
  fs.mkdirSync(projectsDir, { recursive: true })
  fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), catalogJson)
  appInstance = await launchNomiApp({
    name: `model-catalog-config-package-${locale}`,
    tempRoot: root, settingsDir, projectsDir,
    syntheticCredentialStorage: true,
    initialLocalStorage: {
      'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen',
      'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen',
    },
  })
  win = appInstance.win
  await clickOrFail(win.locator('button[aria-label="设置"], button[aria-label="Settings"]').first(), '顶栏设置按钮')
  await expectVisible(win.locator('[data-settings-dialog]'), '设置弹窗')
  await clickOrFail(win.locator('[data-settings-tab-id="models"]'), '设置「模型」页签')
  await expectVisible(win.locator('[data-model-settings-page="home"]'), '模型设置首页')
  // 证明真的在这一语言的现场，别把中文屏当成英文证据。
  await expectVisible(
    win.getByText(locale === 'en' ? 'Advanced' : '高级', { exact: false }).first(),
    `界面没有切到 ${locale}`,
  )
}

async function closeApp() {
  if (!appInstance) return
  const instance = appInstance
  appInstance = null
  await Promise.race([instance.app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))])
  await instance.close()
}

try {
  for (const locale of ['zh-CN', 'en']) {
    await openModelSettings(locale)
    const tag = locale === 'zh-CN' ? 'zh' : 'en'
    const actions = win.locator('[data-catalog-package-actions="true"]')
    await actions.scrollIntoViewIfNeeded()
    await expectVisible(actions, `${tag}：高级组里没有配置导出/导入`)
    await snap(`${tag}-advanced-config-actions.png`)

    // ① 两颗动作是图标 + tooltip，不是一串文字当按钮（2026-09-21 用户原话）。
    for (const which of ['export', 'import']) {
      const button = actions.locator(`[data-catalog-package-action="${which}"]`)
      await expectVisible(button, `${tag}：${which} 动作没渲染`)
      const shape = await button.evaluate((element) => ({
        label: element.getAttribute('aria-label') || '',
        tooltip: element.getAttribute('title') || '',
        text: (element.textContent || '').trim(),
        icons: element.querySelectorAll('svg').length,
      }))
      if (!shape.label || !shape.tooltip) failures.push(`${tag}/${which}：缺 aria-label 或 tooltip`)
      if (shape.text.length > 0) failures.push(`${tag}/${which}：按钮上印了文字「${shape.text}」——说好用图标`)
      if (shape.icons < 1) failures.push(`${tag}/${which}：没有图标`)
    }

    // ② 旁边那行常驻说明必须讲清两件会改变预期的事。
    const hint = (await actions.locator('p').first().innerText()).replace(/\s+/g, ' ')
    const saysNoKeys = locale === 'en' ? /never contains keys/i.test(hint) : /不含密钥/.test(hint)
    const saysKeepLocal = locale === 'en' ? /keeps what you already have/i.test(hint) : /保留本机已有/.test(hint)
    if (!saysNoKeys) failures.push(`${tag}：说明里没写清「导出不含密钥」→ ${hint}`)
    if (!saysKeepLocal) failures.push(`${tag}：说明里没写清「导入默认保留本机已有」→ ${hint}`)
    // 排版纪律：详情面绝不能露出 Markdown 原文（2026-09-09 用户原话）。这一行是纯文本渲染的，
    // 词条里写 `**…**` 会被原样画在屏上——第一版就是这么漏出去的，靠肉眼才看见。
    if (/\*\*|__|`/.test(hint)) failures.push(`${tag}：说明里露出了 Markdown 标记 → ${hint}`)

    // ③ 导出真的产出一份包，而且一个密钥字段都没有。走的是真 IPC，不是模拟。
    const exported = await win.evaluate(async () => {
      const bridge = window.nomiDesktop?.modelCatalog
      if (!bridge) return { error: 'no bridge' }
      return { package: bridge.exportPackage() }
    })
    if (exported.error) {
      failures.push(`${tag}：拿不到导出结果（${exported.error}）`)
    } else {
      const text = JSON.stringify(exported.package)
      if (/"apiKey"|"secret"|"token"/i.test(text)) failures.push(`${tag}：导出的包里出现了密钥字段`)
      if (!/ux-local/.test(text)) failures.push(`${tag}：导出的包里没有这台机器上的那家连接，导出的是空的`)
    }

    await closeApp()
  }
} catch (error) {
  failures.push(`走查中断：${error?.message || error}`)
  await win?.screenshot({ path: path.join(outDir, '99-FAIL.png') }).catch(() => {})
} finally {
  await closeApp()
}

const report = [
  '# model catalog config package walk',
  '',
  `result: ${failures.length ? 'failed' : 'passed'}`,
  `screenshots: ${screenshots.join(', ')}`,
  'covers: export/import live in the advanced group as icon+tooltip actions; the standing hint states both "no keys in the export" and "import keeps what is already here"; exporting really produces a package and it carries no credential field.',
  failures.length ? `failures: ${failures.join(' | ')}` : 'failures: none',
].join('\n')
fs.writeFileSync(path.join(outDir, 'report.md'), `${report}\n`)
console.log(report)
expect(failures, 'config package walk').toEqual([])
