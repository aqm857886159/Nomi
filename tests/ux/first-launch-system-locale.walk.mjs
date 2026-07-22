#!/usr/bin/env node
// 首启系统语言探测走查（#1a）—— 验证「装完首启无存储偏好 → 界面跟随系统语言」。
//
// 靠 Electron 的 `--lang=<locale>` 开关伪造不同系统语言（官方：app.getLocale() 由该开关设定），
// 每次全新隔离环境（无存储 locale），断言 App 初始语言按映射走：
//   en-US → 英文（en）  ·  zh-CN → 中文  ·  de-DE → 英文（非中文系统一律给英文，#40 可达性）
// 再在英文实例里建项目回库，验证项目卡相对时间也本地化（曾硬编码「刚刚/分钟前」）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import { prepareIsolation, isolatedAppEnv, dismissSplashIfPresent } from '../../evals/lib/isoApp.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, '.first-launch-walk')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// 伪造系统语言启动一个全新隔离实例（无存储偏好）。
async function launchWithSystemLang(tag, lang) {
  const iso = prepareIsolation(path.join(os.tmpdir(), `nomi-fl-${tag}`), { requireCatalog: false })
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.', `--lang=${lang}`, `--user-data-dir=${iso.chromiumDir}`],
    cwd: repoRoot,
    // NOMI_TEST_SYSTEM_LOCALE=1：显式开启系统语言探测（其余走查默认关，保中文选择器确定性）。
    env: { ...isolatedAppEnv(iso), NOMI_TEST_SYSTEM_LOCALE: '1' },
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  await dismissSplashIfPresent(win)
  return { app, win, iso }
}

async function assertLocale(tag, lang, expected) {
  const { app, win, iso } = await launchWithSystemLang(tag, lang)
  try {
    const sysLocale = await win.evaluate(() => window.nomiDesktop?.i18n?.getSystemLocale?.() ?? '(no bridge)')
    const htmlLang = await win.evaluate(() => document.documentElement.lang)
    console.log(`\n▶ --lang=${lang}：getSystemLocale()=${sysLocale} · html lang=${htmlLang} · 期望=${expected}`)
    // 桥须返回非空 OS locale（证明 IPC 通）。注：Electron 对无本地化数据的 locale（如 de-DE）会归一化回退
    // 到 en-US——这不影响我们的映射结论（非中文一律 → 英文），故只断言「桥通」+「解析出的界面语言对」。
    check(`[${lang}] 桥读到非空系统语言（IPC 通）`, typeof sysLocale === 'string' && sysLocale.length > 0 && sysLocale !== '(no bridge)', `getSystemLocale=${sysLocale}`)
    check(`[${lang}] 首启界面语言=${expected}（跟随系统）`, htmlLang === expected, `html lang=${htmlLang}`)
    await win.screenshot({ path: path.join(shotsDir, `${tag}-${lang}.png`) })
    return { iso, win, app }
  } catch (error) {
    check(`[${lang}] 走查未抛错`, false, String(error))
    await app.close().catch(() => {})
    return null
  }
}

// ① en-US → 英文（且验英文库相对时间）
const en = await assertLocale('en', 'en-US', 'en')
if (en) {
  try {
    const { win, iso } = en
    // 英文起始页：New blank project 在、中文入口不在
    const enCta = await win.getByText('New blank project', { exact: false }).count()
    const zhCta = await win.getByText('新建空白项目', { exact: false }).count()
    check('[en] 起始页英文（New blank project 在、中文入口不在）', enCta > 0 && zhCta === 0, `en=${enCta} zh=${zhCta}`)
    // 建项目 → 回库 → 卡片相对时间应英文
    await win.getByText('New blank project', { exact: false }).first().click({ timeout: 10000 })
    // 等项目落盘
    const deadline = Date.now() + 12000
    while (Date.now() < deadline) {
      const dirs = fs.existsSync(iso.projectsDir) ? fs.readdirSync(iso.projectsDir).filter((n) => fs.existsSync(path.join(iso.projectsDir, n, '.nomi', 'project.json'))) : []
      if (dirs.length >= 1) break
      await win.waitForTimeout(300)
    }
    // 回项目库（点顶栏 Projects 面包屑）
    await win.getByText('Projects', { exact: true }).first().click({ timeout: 6000 }).catch(() => {})
    await win.waitForTimeout(1200)
    const bodyText = await win.evaluate(() => document.body.innerText)
    const hasEnTime = /just now|min ago|hr ago|days ago/i.test(bodyText)
    const hasZhTime = /刚刚|分钟前|小时前|天前/.test(bodyText)
    check('[en] 项目库相对时间英文（无中文时间串）', hasEnTime && !hasZhTime, `enTime=${hasEnTime} zhTime=${hasZhTime}`)
    await win.screenshot({ path: path.join(shotsDir, 'en-library-relative-time.png') })
  } catch (error) {
    check('[en] 相对时间走查未抛错', false, String(error))
  } finally {
    await en.app.close().catch(() => {})
  }
}

// ② zh-CN → 中文（证明不是「永远英文」，是真跟随系统）
const zh = await assertLocale('zh', 'zh-CN', 'zh-CN')
if (zh) await zh.app.close().catch(() => {})

// ③ de-DE → 英文（非中文系统一律给英文的映射）
const de = await assertLocale('de', 'de-DE', 'en')
if (de) await de.app.close().catch(() => {})

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length ? '❌' : '✅'} 首启系统语言走查：${results.length - failed.length}/${results.length} 通过`)
console.log(`截图：${shotsDir}`)
if (failed.length) {
  console.log('失败项：', failed.map((r) => r.name).join('; '))
  process.exit(1)
}
