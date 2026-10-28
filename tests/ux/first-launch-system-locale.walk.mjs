#!/usr/bin/env node
// 首启系统语言探测走查（#1a）—— 验证「装完首启无存储偏好 → 界面跟随系统语言」。
//
// 靠 Electron 的 `--lang=<locale>` 开关伪造不同系统语言（官方：app.getLocale() 由该开关设定），
// 每次全新隔离环境（无存储 locale），断言 App 初始语言按映射走：
//   en-US → 英文（en）  ·  zh-CN → 中文  ·  de-DE → 英文（非中文系统一律给英文，#40 可达性）
// 再在英文实例里建项目回库，验证项目卡相对时间也本地化（曾硬编码「刚刚/分钟前」）。
//
// 2026-10-27 起首启第一件事还验开屏「跳过」（中英三轨各一次，都是真首启）：开屏出现时「跳过」中心的最上层就是它自己、
// 真点一下（不 force）开屏关掉、项目库出现。起因：开屏手写 z-[60]，顶栏取 Mantine 默认 100，「跳过」被顶栏压住点不到；
// 此前这条走查和十来条别的走查都经 dismissSplashIfPresent 的 DOM click 兜底点掉它，所以一直是绿的。
// 2026-10-28 协调拍板方案 B（设计卡「协调 10-28 定 B」）：开屏仍整屏（层级走刻度 applicationModal，盖住顶栏），「跳过」挪到 40px
// 顶栏带外。DOM 命中只是一半——真用户点击还要过系统拖拽带 / Windows 原生三键区那一关（CDP 合成点击绕过它，见
// tests/ux/director-windowbar.walk.mjs 头注），所以几何三项是硬断言：中心点系统视角不是拖拽区、与 40px 带重叠 = 0、
// 不落在 Windows 原生三键区（推算，未在 Windows 实测）；外加「开屏整屏」一项（顶栏带的采样点全命中开屏）。
// 每一组断言在同一次运行内都有对照（运行时改样式，不动源码），证明它们不恒真：开屏压到 z-60 → 整屏一项必须翻红（顶栏压到开屏上面；
// 「跳过」在带外，层级退回去也盖不住它，所以层级的守卫落在「整屏」而不是「跳过命中」）；「跳过」挪回老位置 top 28px → 重叠与三键区两项必须翻红。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { prepareIsolation } from '../../evals/lib/isoApp.mjs'
import { screenshotSettled } from './_assert.mjs'
import { backToLibrary } from './_shell.mjs'
import { stationTimeout } from './_station-budget.mjs'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, '.first-launch-walk')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// 页内量一次「跳过」：中心命中谁、几何（拖拽带 / Windows 原生三键区推算）。
// 系统视角按 Chromium 收集拖拽区的规则近似：带 -webkit-app-region 的元素按 DOM 顺序、后者覆盖前者（drag 加、no-drag 减）。
async function measureSplashSkip(win) {
  return win.evaluate(() => {
    const skip = document.querySelector('[data-splash-skip="true"]')
    if (!skip) return { present: false }
    const rect = skip.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const hit = document.elementFromPoint(cx, cy)
    const regions = []
    for (const el of document.querySelectorAll('*')) {
      const value = getComputedStyle(el).getPropertyValue('-webkit-app-region').trim()
      if (value === 'drag' || value === 'no-drag') regions.push({ value, box: el.getBoundingClientRect() })
    }
    let centerStatus = 'none'
    for (const { value, box } of regions) {
      if (box.width > 0 && box.height > 0 && cx >= box.left && cx < box.right && cy >= box.top && cy < box.bottom) centerStatus = value
    }
    // 顶栏带（40px）里每 40px 取一点：开屏整屏时全命中开屏；顶栏压在开屏上面时命中顶栏。
    const bandHits = []
    for (let x = 20; x < window.innerWidth; x += 40) bandHits.push(Boolean(document.elementFromPoint(x, 20)?.closest('.nomi-splash')))
    const label = hit?.getAttribute('aria-label')
    return {
      present: true,
      isSkip: Boolean(hit?.closest('[data-splash-skip]')),
      hit: hit ? `${hit.tagName.toLowerCase()}${label ? `[${label}]` : ''}` : null,
      rect: `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
      centerStatus,
      overlapBand: Math.max(0, Math.min(rect.bottom, 40) - Math.max(rect.top, 0)),
      inWindowsCaptionZone: rect.left >= window.innerWidth - 138 && rect.top < 40,
      bandCovered: bandHits.filter(Boolean).length,
      bandSamples: bandHits.length,
    }
  })
}

// 首启开屏：先于一切别的断言。命中、几何三项、整屏、真点、项目库出现；中间夹同一次运行内的阳性对照（证明断言不恒真）。
async function assertSplashSkipReachable(win, tag, lang) {
  const skip = win.locator('[data-splash-skip="true"]')
  await skip.waitFor({ state: 'visible', timeout: stationTimeout() })
  // 淡入走完再量：命中不看透明度，这只是让截图读得清。
  await win.waitForFunction(() => {
    const el = document.querySelector('.nomi-splash')
    return Boolean(el) && Number(getComputedStyle(el).opacity) >= 0.99
  }, undefined, { timeout: stationTimeout() })
  const asIs = await measureSplashSkip(win)
  check(`[${lang}] 开屏出现时「跳过」中心最上层就是按钮自己`, asIs.isSkip, `命中=${asIs.hit}，按钮 ${asIs.rect}`)
  // 几何三项：真用户点击要过的那一关，CDP 合成点击量不到，只能量几何。
  check(`[${lang}] 几何：「跳过」中心点系统视角不是拖拽区（${asIs.centerStatus}）`, asIs.centerStatus !== 'drag', `按钮 ${asIs.rect}`)
  check(`[${lang}] 几何：「跳过」与 40px 顶栏带重叠 = 0`, asIs.overlapBand === 0, `重叠 ${asIs.overlapBand}px，按钮 ${asIs.rect}`)
  check(`[${lang}] 几何：「跳过」不落在 Windows 原生三键区（推算，未在 Windows 实测）`, !asIs.inWindowsCaptionZone, `inWindowsCaptionZone=${asIs.inWindowsCaptionZone}`)
  // 开屏整屏（方案 B：盖住顶栏，不是让开顶栏）：顶栏带的采样点全命中开屏，动画没被顶栏切。
  check(`[${lang}] 开屏整屏：顶栏带 ${asIs.bandSamples} 个采样点全命中开屏（没被顶栏切）`, asIs.bandSamples > 0 && asIs.bandCovered === asIs.bandSamples, `${asIs.bandCovered}/${asIs.bandSamples}`)
  await screenshotSettled(win, { path: path.join(shotsDir, `${tag}-${lang}-splash.png`) })

  // 对照 1（同一次运行内，运行时改内联 z-index，不动源码）：开屏压到 60，顶栏就压到开屏上面——顶栏带的采样点必须翻成别的元素（整屏断言翻红）。
  // 注意「跳过」本身的命中不会翻：方案 B 把它挪到了带外（y ≥ 48，顶栏只有 40px 高），层级退回去也盖不住它，只是动画被顶栏切掉一条。
  // 这一点是 B 的收益，也是为什么层级的守卫要落在「整屏」这一项上，而不是「跳过命中」那一项。
  await win.evaluate(() => { document.querySelector('.nomi-splash').style.zIndex = '60' })
  const lowered = await measureSplashSkip(win)
  check(`[${lang}] 阳性对照：开屏压到 z-60，顶栏压到开屏上面、顶栏带不再全是开屏（断言不恒真）`, lowered.bandSamples > 0 && lowered.bandCovered < lowered.bandSamples, `顶栏带命中开屏 ${lowered.bandCovered}/${lowered.bandSamples}；「跳过」命中=${lowered.hit}（在带外，不受层级影响）`)
  await win.evaluate(() => { document.querySelector('.nomi-splash').style.zIndex = '' })
  // 对照 2：「跳过」挪回老位置（原 top-7 = 28px），重叠与三键区两项必须翻红。中心系统视角这一项在 Mac 当前布局下翻不了
  // （右上图标簇是 no-drag，把老位置整块罩住，碰巧不是拖拽区），所以它守的是将来图标簇变窄的情形，对照里不测它。
  const originalTop = await win.evaluate(() => {
    const el = document.querySelector('[data-splash-skip="true"]')
    const before = el.style.top
    el.style.top = '28px'
    return before
  })
  const movedBack = await measureSplashSkip(win)
  check(`[${lang}] 阳性对照：「跳过」挪回老位置 top 28px，与顶栏带重叠 > 0 且落进三键区（断言不恒真）`, movedBack.overlapBand > 0 && movedBack.inWindowsCaptionZone, `重叠 ${movedBack.overlapBand}px，三键区=${movedBack.inWindowsCaptionZone}`)
  await win.evaluate((top) => { document.querySelector('[data-splash-skip="true"]').style.top = top }, originalTop)
  const restored = await measureSplashSkip(win)
  check(`[${lang}] 对照撤掉后恢复：「跳过」回到带外、命中是按钮自己`, restored.isSkip && restored.overlapBand === 0 && restored.bandCovered === restored.bandSamples, `重叠 ${restored.overlapBand}px，命中=${restored.hit}`)

  // 真点（Playwright 会做命中检查，被盖住会超时；不 force）。
  let clicked = true
  let clickDetail = ''
  try {
    await skip.click({ timeout: 3_000 })
  } catch (error) {
    clicked = false
    clickDetail = String(error).split('\n')[0].slice(0, 120)
  }
  check(`[${lang}] 真点「跳过」点得动（不 force）`, clicked, clickDetail)
  if (!clicked) {
    // 收尾：这条走查后面还要验语言，开屏得先关掉。上一条已经把红记下了，这一步不是放行。
    await win.evaluate(() => { document.querySelector('[data-splash-skip="true"]')?.click() })
  }
  await win.locator('.nomi-splash').waitFor({ state: 'detached', timeout: stationTimeout() })
  check(`[${lang}] 开屏关掉`, true)
  await win.locator('[data-shell-here]').waitFor({ state: 'visible', timeout: stationTimeout() })
  check(`[${lang}] 项目库出现（顶栏「${await win.locator('[data-shell-here]').innerText()}」）`, true)
  await screenshotSettled(win, { path: path.join(shotsDir, `${tag}-${lang}-after-skip.png`) })
}

// 伪造系统语言启动一个全新隔离实例（无存储偏好）。
async function launchWithSystemLang(tag, lang) {
  const iso = prepareIsolation(path.join(os.tmpdir(), `nomi-fl-${tag}`), { requireCatalog: false })
  const { app, win } = await launchNomiApp({
    name: `first-launch-system-locale-${tag}`,
    userDataDir: iso.chromiumDir,
    settingsDir: iso.settingsDir,
    projectsDir: iso.projectsDir,
    args: [`--lang=${lang}`],
    // NOMI_TEST_SYSTEM_LOCALE=1：显式开启系统语言探测（其余走查默认关，保中文选择器确定性）。
    env: { NOMI_TEST_SYSTEM_LOCALE: '1' },
  })
  await assertSplashSkipReachable(win, tag, lang)
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
    await screenshotSettled(win, { path: path.join(shotsDir, `${tag}-${lang}.png`) })
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
    // 回项目库：10-08 外壳起是「顶栏项目名菜单 → 回项目库」，原来的 Projects 面包屑已不存在——旧写法点空、还被 .catch 吞掉，
    // 于是这一步从 10-08 起一直停在工作区里读不到任何相对时间（红了没人看）。走共用的 backToLibrary，点不到就红。
    await backToLibrary(win)
    await win.locator('[data-shell-here]').waitFor({ state: 'visible', timeout: stationTimeout() })
    await win.waitForTimeout(1200)
    const bodyText = await win.evaluate(() => document.body.innerText)
    const hasEnTime = /just now|min ago|hr ago|days ago/i.test(bodyText)
    const hasZhTime = /刚刚|分钟前|小时前|天前/.test(bodyText)
    check('[en] 项目库相对时间英文（无中文时间串）', hasEnTime && !hasZhTime, `enTime=${hasEnTime} zhTime=${hasZhTime}`)
    await screenshotSettled(win, { path: path.join(shotsDir, 'en-library-relative-time.png') })
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
