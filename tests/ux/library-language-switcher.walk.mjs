#!/usr/bin/env node
// 项目库起始页语言切换钮走查（#1b）—— 验证：不必先建项目进工作台，起始页第一屏就能切语言。
// 全新隔离实例（默认中文）→ 停在项目库页 → 断言语言钮在 → 点它切英文 → 库整页翻英文。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareIsolation, launchIsolatedApp, dismissSplashIfPresent } from '../../evals/lib/isoApp.mjs'

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

  // 起始页（未建任何项目）应默认中文，且语言钮就在顶栏
  const onLibrary = await win.getByText('新建空白项目', { exact: false }).count()
  const langBtnZh = await win.locator('[aria-label="语言"]').count()
  check('停在项目库起始页（未建项目）', onLibrary > 0, `新建空白项目=${onLibrary}`)
  check('起始页顶栏有语言切换钮（#1b 新增）', langBtnZh > 0, `语言钮=${langBtnZh}`)
  await win.screenshot({ path: path.join(shotsDir, '01-library-zh.png') })

  // 点语言钮 → 选 English
  await win.locator('[aria-label="语言"]').first().click({ timeout: 6000 })
  await win.waitForTimeout(400)
  await win.locator('[role="menuitemradio"]', { hasText: 'English' }).first().click({ timeout: 5000 })
  await win.waitForTimeout(1000)

  // 起始页整页翻英文（无需先建项目进工作台）
  const langBtnEn = await win.locator('[aria-label="Language"]').count()
  const enCta = await win.getByText('New blank project', { exact: false }).count()
  const zhCta = await win.getByText('新建空白项目', { exact: false }).count()
  check('切换后语言钮 aria-label→Language', langBtnEn > 0, `count=${langBtnEn}`)
  check('起始页翻英文（New blank project 在、中文入口不在）', enCta > 0 && zhCta === 0, `en=${enCta} zh=${zhCta}`)
  await win.screenshot({ path: path.join(shotsDir, '02-library-en.png') })
} finally {
  await app.close().catch(() => {})
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length ? '❌' : '✅'} 起始页语言钮走查：${results.length - failed.length}/${results.length} 通过`)
console.log(`截图：${shotsDir}`)
if (failed.length) {
  console.log('失败项：', failed.map((r) => r.name).join('; '))
  process.exit(1)
}
