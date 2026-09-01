#!/usr/bin/env node
// 项目库起始页切语言走查 —— 验证的**产品意图**：不必先建项目进工作台，第一屏就能把语言改掉。
//
// 路径变迁（这条走查曾因此长期假红，注释留着防再犯）：
//   #1b (98416778) 把 LanguageMenuButton 放进项目库顶栏，走查按 [aria-label="语言"] 写死。
//   feeb575b「顶栏右簇 7 个平铺 → 分 3 组」按设计系统 §1.5 把语言/外观/关于**归位设置**，
//   并 P1 删掉了 LanguageMenuButton 组件本身 —— 但没人改这条走查。
//   于是它天天红在一个「产品早就不长这样」的锚点上，红得毫无信息量（假红）。
//
// 所以本走查现在验的是**意图**而不是**某颗按钮**：起始页够得着的入口里能改语言、改完整库翻译。
// 入口从「顶栏常驻语言钮」变成「顶栏齿轮 → 设置 → 通用 → 语言」是 §1.5 的有意归位，
// feeb575b 声称「可达性零损失」—— 这条走查就是那句声明的持续证据。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareIsolation, launchIsolatedApp, dismissSplashIfPresent } from '../../evals/lib/isoApp.mjs'
import { screenshotSettled } from './_assert.mjs'

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

  // 起始页（未建任何项目）应默认中文，且改语言的入口在这一屏就够得着
  const onLibrary = await win.getByText('新建空白项目', { exact: false }).count()
  const settingsEntry = await win.locator('[data-open-settings]').count()
  check('停在项目库起始页（未建项目）', onLibrary > 0, `新建空白项目=${onLibrary}`)
  check('起始页顶栏够得着设置入口（语言归位后的唯一入口）', settingsEntry > 0, `齿轮=${settingsEntry}`)
  await screenshotSettled(win, { path: path.join(shotsDir, '01-library-zh.png') })

  // 起始页 → 齿轮 → 设置「通用」
  await win.locator('[data-open-settings]').first().click({ timeout: 8000 })
  await win.waitForTimeout(1000)
  const generalTab = win.locator('[data-settings-tab-id="general"]')
  check('设置里有「通用」分区', (await generalTab.count()) > 0)
  await generalTab.first().click({ timeout: 6000 })
  await win.waitForTimeout(800)

  // 语言分段控件：两个选项平铺可见（§1.5 改判 PR#50 的依据正是「不再是弹窗第三层的下拉」）
  const localeOptions = await win.locator('[data-settings-locale]').count()
  const zhPressed = await win.locator('[data-settings-locale="zh-CN"][aria-pressed="true"]').count()
  check('通用里语言两个选项平铺可见', localeOptions === 2, `选项=${localeOptions}`)
  check('当前选中简体中文', zhPressed > 0, `zh-CN pressed=${zhPressed}`)
  await screenshotSettled(win, { path: path.join(shotsDir, '02-settings-general-zh.png') })

  // 切 English
  await win.locator('[data-settings-locale="en"]').first().click({ timeout: 6000 })
  await win.waitForTimeout(1000)
  const enPressed = await win.locator('[data-settings-locale="en"][aria-pressed="true"]').count()
  check('切换后 English 变为选中态', enPressed > 0, `en pressed=${enPressed}`)

  // 关掉设置回起始页，看整库是不是真的翻了（这才是用户能感知的那件事）
  await win.keyboard.press('Escape')
  await win.waitForTimeout(1200)
  const enCta = await win.getByText('New blank project', { exact: false }).count()
  const zhCta = await win.getByText('新建空白项目', { exact: false }).count()
  check('起始页翻英文（New blank project 在、中文入口不在）', enCta > 0 && zhCta === 0, `en=${enCta} zh=${zhCta}`)
  await screenshotSettled(win, { path: path.join(shotsDir, '03-library-en.png') })
} finally {
  await app.close().catch(() => {})
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length ? '❌' : '✅'} 起始页切语言走查：${results.length - failed.length}/${results.length} 通过`)
console.log(`截图：${shotsDir}`)
if (failed.length) {
  console.log('失败项：', failed.map((r) => r.name).join('; '))
  process.exit(1)
}
