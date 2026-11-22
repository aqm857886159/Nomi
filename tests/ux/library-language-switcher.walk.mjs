#!/usr/bin/env node
// 项目库起始页语言切换走查（#1b）—— 验证：不必先建项目进工作台，起始页第一屏就能切语言。
// 全新隔离实例（默认中文）→ 停在项目库页 → 断言设置里的语言分段在（顶栏已没有独立语言钮，语言归位到设置「通用」）→ 切英文 → 库整页翻英文。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareIsolation, launchIsolatedApp, dismissSplashIfPresent } from '../../evals/lib/isoApp.mjs'
import { screenshotSettled } from './_assert.mjs'
import { openSettings, closeSettings, readAppLanguage, setAppLanguage } from './_shell.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, '.library-lang-walk')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const iso = prepareIsolation(path.join(os.tmpdir(), 'nomi-libswitch'), { requireCatalog: false })
const { app, win } = await launchIsolatedApp(repoRoot, iso)

try {
  await dismissSplashIfPresent(win)
  await win.evaluate(() => {
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1']) localStorage.setItem(k, 'seen')
  })
  await win.reload()
  await win.waitForTimeout(1500)
  await dismissSplashIfPresent(win)

  // 起始页（未建任何项目）应默认中文，且第一屏就能到语言分段（顶栏设置钮 → 通用）
  const onLibrary = await win.getByText('新建空白项目', { exact: false }).first().waitFor({ state: 'visible' }).then(() => true, () => false)
  check('停在项目库起始页（未建项目）', onLibrary, `新建空白项目=${onLibrary ? 1 : 0}`)
  const settings = await openSettings(win, { tab: 'general', label: '起始页打开设置' })
  const localeOptions = await settings.locator('[data-settings-locale]').count()
  check('起始页设置「通用」里有语言分段（#1b：不进工作台就能切）', localeOptions === 2, `语言选项=${localeOptions}`)
  await closeSettings(win)
  check('起始页默认是中文', (await readAppLanguage(win)) === 'zh-CN')
  await screenshotSettled(win, { path: path.join(shotsDir, '01-library-zh.png') })

  // 设置 → 通用 → 选 English
  await setAppLanguage(win, 'en', '起始页切英文')
  await win.waitForTimeout(1000)

  // 起始页整页翻英文（无需先建项目进工作台）
  const langEn = await readAppLanguage(win)
  const enCtaVisible = await win.getByText('New blank project', { exact: false }).first().waitFor({ state: 'visible' }).then(() => true, () => false)
  const zhCta = await win.getByText('新建空白项目', { exact: false }).count()
  check('切换后语言分段落在 English', langEn === 'en', `当前=${langEn}`)
  check('起始页翻英文（New blank project 在、中文入口不在）', enCtaVisible && zhCta === 0, `en=${enCtaVisible ? 1 : 0} zh=${zhCta}`)
  await screenshotSettled(win, { path: path.join(shotsDir, '02-library-en.png') })
} finally {
  await app.close().catch(() => {})
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length ? '❌' : '✅'} 起始页语言切换走查：${results.length - failed.length}/${results.length} 通过`)
console.log(`截图：${shotsDir}`)
if (failed.length) {
  console.log('失败项：', failed.map((r) => r.name).join('; '))
  process.exit(1)
}
