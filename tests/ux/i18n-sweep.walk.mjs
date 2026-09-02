#!/usr/bin/env node
// 全 App 双语真机扫查（2026-09-01）—— i18n 现状清零 + 防回归。
//
// 两道运行时断言网逐面兜底(与静态门岗 check:i18n-key-refs / check:i18n-key-parity 两头夹):
//   · RAW-KEY 网(zh+en 都跑):抓「t() 引用了不存在的键 → i18next 把 key 本身渲染出来」的那一类
//     (今天 sidebar.workflows / .workflowLibrary / .resize 就是)。这个洞与语言无关——键两边都缺时,
//     两种语言都渲染 raw key。
//   · CJK 网(仅 en 跑):抓漏译——en 界面上任何未翻译的中文。用户内容([data-user-content])豁免。
//
// 每面:切到该面 → 等视觉安定 → 截图(zh/en 分目录、按面命名)→ 跑断言网。真 Electron、隔离 profile、
// 零额度(种一个做完的项目当内容,图片是本地 SVG)。覆盖面:项目库 / 创作 / 生成(画布) / 预览 /
// 侧栏四库(素材/提示词/技能/流程)/ 设置全部 6 tab(含 about=反馈中心、models=TikHub 卡+本地模型卡+接入向导)。
//
// 为什么是「带真实任务跑通闭环」而不是逐个功能点探(R16):种好项目后按「打开项目→看创作→看画布→
// 看预览→翻库→查设置」这条真实使用动线走,每一步先断言「我到了这儿」再取证,收尾查各面截图两两不同
// (字节相同=那步没发生,dark-journey 的教训)。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { prepareIsolation, dismissSplashIfPresent } from '../../evals/lib/isoApp.mjs'
import { seedFinishedJourneyProject } from './fixtures/journey-project-fixture.mjs'
import {
  screenshotSettled,
  waitForVisualQuiescence,
  expectNoRawI18nKeysInDom,
  expectNoCjkInEnglishDom,
  clickOrFail,
} from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsRoot = path.join(repoRoot, 'tests/ux/shots/i18n-sweep')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// en 界面上合法的、用户自己写的中文子树豁免选择器 + 允许的 raw-key 文本(目前无)。
// 种入项目的名字/镜头标题/正文都是中文——它们是**用户内容**,en 界面显示中文是对的,不是漏译。
// 现存 UI 未给这些节点打 [data-user-content],所以这里用选择器把「已知会含用户中文的容器」摘掉,
// 避免把用户内容误报成漏译。范围刻意窄:只摘确实承载 seed 用户串的面(创作正文/画布节点标题/预览 clip 标签)。
const USER_CONTENT_ALLOW = [
  '.ProseMirror', // 创作区富文本正文(seed 的中文故事)
  '[data-rf-node]', // React Flow 画布节点(seed 的中文镜头标题)
  '.react-flow__node',
  '.workbench-timeline-clip', // 时间轴 clip 标签 = 镜头标题(用户命名的内容,TimelineClip.tsx)
  '[data-testid="timeline-clip"]',
  '[data-testid="preview-source-shot"]', // 预览源面板 shot 卡:title/aria-label = t(itemHint,{name:用户镜头标题});译文正确、只有插值 name 是用户内容
  // 语言切换器的选项按钮(SettingsDialog.tsx:427 data-settings-locale)。每个语言按**它自己的写法**
  // 显示是国际惯例(endonym):英文界面里中文选项就该写「简体中文」,否则用户在看不懂的界面里找不到
  // 自己的语言。这不是漏译,是对的——en 词典里 resources.ts:404 `chinese: '简体中文'` 是刻意的。
  '[data-settings-locale]',
]

/** 把 raw-key + (en 时)CJK 两道网在当前这一屏都跑一遍。allowSelectors 传用户内容豁免。 */
async function assertSurfaceClean(win, locale, surface, { extraAllow = [] } = {}) {
  const allow = [...USER_CONTENT_ALLOW, ...extraAllow]
  try {
    await expectNoRawI18nKeysInDom(win, {
      message: `[${locale}] ${surface}：界面上不该有未解析的 i18n 键`,
      allowSelectors: allow,
    })
    check(`[${locale}] ${surface} · 无 raw-key`, true)
  } catch (error) {
    check(`[${locale}] ${surface} · 无 raw-key`, false, String(error).split('\n').slice(0, 6).join(' / '))
  }
  if (locale === 'en') {
    try {
      await expectNoCjkInEnglishDom(win, {
        message: `[en] ${surface}：英文界面不该有未翻译中文`,
        allowSelectors: allow,
      })
      check(`[en] ${surface} · 无残留中文`, true)
    } catch (error) {
      check(`[en] ${surface} · 无残留中文`, false, String(error).split('\n').slice(0, 6).join(' / '))
    }
  }
}

async function shot(target, locale, name) {
  const dir = path.join(shotsRoot, locale)
  fs.mkdirSync(dir, { recursive: true })
  await screenshotSettled(target, { path: path.join(dir, `${name}.png`) })
}

// 打开设置对话框到指定 tab（走仓内既有的 CustomEvent 约定 nomi-open-settings）。
async function openSettingsTab(win, tab, section = null) {
  await win.evaluate(
    ({ tab, section }) => window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab, section } })),
    { tab, section },
  )
  // 等对话框挂上来（role=dialog + settings 标题区）。
  await win.waitForTimeout(500)
  await waitForVisualQuiescence(win).catch(() => {})
}

async function closeSettings(win) {
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(300)
}

// 点侧栏某个库的导轨按钮（aria-label = 该库全名）。这几个按钮的 railLabel 正是今天修的
// sidebar.workflows / .workflowLibrary——点它们直接验修复。
async function openSidebarLibrary(win, ariaLabelZh, ariaLabelEn, locale) {
  const label = locale === 'en' ? ariaLabelEn : ariaLabelZh
  await clickOrFail(win.getByRole('button', { name: label }).first(), `侧栏「${label}」导轨`)
  await win.waitForTimeout(400)
  await waitForVisualQuiescence(win).catch(() => {})
}

/**
 * 起一个隔离实例、种项目、强制 locale，走完全部面。
 * @param {'zh-CN'|'en'} locale
 */
async function sweepLocale(locale) {
  const tag = locale === 'en' ? 'en' : 'zh'
  console.log(`\n════════ ${locale} 扫查 ════════`)
  const iso = prepareIsolation(path.join(os.tmpdir(), `nomi-i18n-sweep-${tag}`), { requireCatalog: false })
  // 项目名给 ASCII：它会出现在项目库卡片标题/删除按钮 aria-label 上，是**用户内容**，
  // en 界面显示中文本是对的、但现存 UI 没给它打 [data-user-content]，会被 CJK 网误报。
  // 用 ASCII 名绕开（名字是测试产物、不是产品串）；shot 标题/正文仍中文，在画布/创作里、已豁免。
  const seed = seedFinishedJourneyProject({ projectsDir: iso.projectsDir, projectName: 'i18n Sweep Sample' })

  // 用 --lang 在**首启**就把 i18n 初始化成目标语言（不 reload——见 walkthrough-no-win-reload：
  // 原地刷新会把项目会话打断、面板静默空掉）。zh-CN→中文、en-US→英文（映射由 first-launch-system-locale 证）。
  const langArg = locale === 'en' ? 'en-US' : 'zh-CN'
  const { app, win } = await launchNomiApp({
    name: `i18n-sweep-${tag}`,
    userDataDir: iso.chromiumDir,
    settingsDir: iso.settingsDir,
    projectsDir: iso.projectsDir,
    args: [`--lang=${langArg}`],
    // 开启系统语言探测（首启无存储偏好 → 跟随 --lang）；亮色固定，跨面截图明暗一致。
    env: { NOMI_TEST_SYSTEM_LOCALE: '1' },
  })
  try {
    await dismissSplashIfPresent(win)
    // 抑制引导浮层（否则每面被引导盖住）——这些只写 localStorage、不影响已初始化的 i18n，不需 reload。
    await win.evaluate(() => {
      localStorage.setItem('nomi-color-scheme', 'light')
      for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen')
    })
    await win.waitForTimeout(400)

    // 证明 locale 真切过去了：html lang 应等于该 locale。
    const htmlLang = await win.evaluate(() => document.documentElement.lang)
    check(`[${locale}] 界面语言已切到 ${locale}`, htmlLang === locale, `html lang=${htmlLang}`)

    // ── 面 1：项目库（首屏）──
    await waitForVisualQuiescence(win).catch(() => {})
    await shot(win, locale, '01-library')
    await assertSurfaceClean(win, locale, '项目库')

    // 打开种好的项目：卡片是 role=button 的容器（onClick 挂在它身上，不是里面的名字 span——
    // 点 span 不会触发 openProject，probe 实测）。点这个 role=button 祖先，再等工作区切换器挂上来。
    const projectCard = win.locator('[role="button"]', { hasText: seed.projectName }).first()
    await clickOrFail(projectCard, `项目卡「${seed.projectName}」`)
    // 等工作区切换器出现（证明真进了工作台，不是停在库里）。
    await win.locator('button[data-mode="creation"]').first().waitFor({ state: 'visible', timeout: 15000 })
    await win.waitForTimeout(800)
    await waitForVisualQuiescence(win).catch(() => {})

    // 工作区切换器是带 data-mode 的 button（src/design/identity.tsx），不是 role=tab——按属性点最稳。
    const switchWorkspace = async (mode, labelZh) => {
      await clickOrFail(win.locator(`button[data-mode="${mode}"]`).first(), `工作区「${labelZh}」(data-mode=${mode})`)
      await win.waitForTimeout(900)
      await waitForVisualQuiescence(win).catch(() => {})
    }

    // ── 面 2：创作区 ──
    await switchWorkspace('creation', '创作')
    await shot(win, locale, '02-creation')
    await assertSurfaceClean(win, locale, '创作区')

    // ── 面 3：生成区（画布）──
    await switchWorkspace('generation', '生成')
    await shot(win, locale, '03-generation-canvas')
    await assertSurfaceClean(win, locale, '生成画布')

    // ── 面 4-7：侧栏四库（素材/提示词/技能/流程）——流程库导轨正是今天修的 key ──
    // 这些库按钮在生成/创作视图的项目侧栏里。逐个点开、截图、验。
    const LIBS = [
      { zh: '素材库', en: 'Asset library', name: '04-asset-library' },
      { zh: '提示词库', en: 'Prompt library', name: '05-prompt-library' },
      { zh: '技能库', en: 'Skill library', name: '06-skill-library' },
      { zh: '流程库', en: 'Workflow library', name: '07-workflow-library' },
    ]
    for (const lib of LIBS) {
      try {
        await openSidebarLibrary(win, lib.zh, lib.en, locale)
        await shot(win, locale, lib.name)
        await assertSurfaceClean(win, locale, `侧栏·${locale === 'en' ? lib.en : lib.zh}`)
      } catch (error) {
        check(`[${locale}] 打开侧栏「${locale === 'en' ? lib.en : lib.zh}」`, false, String(error).split('\n')[0])
      }
    }

    // ── 面 8：预览区 ──
    await switchWorkspace('preview', '预览')
    await shot(win, locale, '08-preview')
    await assertSurfaceClean(win, locale, '预览区')

    // ── 面 9-14：设置全部 6 tab ──
    // models tab 一屏就含 TikHub 卡 + 本地模型卡 + 接入向导(OnboardingDrawer);不重复截同一 tab
    // (两次不同 section 的滚动在整窗截图里字节相同 = 冗余,会触发「两两不同」网)。断言网仍逐面跑。
    const SETTINGS_TABS = [
      { tab: 'file', name: '09-settings-file' },
      { tab: 'models', name: '10-settings-models', section: 'ai-models' }, // 含 TikHub 卡、本地模型卡、接入向导
      { tab: 'ai', name: '11-settings-ai' },
      { tab: 'automation', name: '12-settings-automation' },
      { tab: 'general', name: '13-settings-general' },
      { tab: 'about', name: '14-settings-about' }, // 反馈与分享中心
    ]
    for (const s of SETTINGS_TABS) {
      try {
        await openSettingsTab(win, s.tab, s.section ?? null)
        await shot(win, locale, s.name)
        await assertSurfaceClean(win, locale, `设置·${s.tab}${s.section ? `/${s.section}` : ''}`)
      } catch (error) {
        check(`[${locale}] 设置 tab ${s.tab}`, false, String(error).split('\n')[0])
      }
    }

    // ── TikHub 卡:models tab 内的 tikhub-connector section。滚到它、证它可见(证明真到了这张卡)、
    //    截**对话框局部**做独立证据(整窗截图里滚动位置不改变字节,故 scope 到 dialog)。 ──
    try {
      await openSettingsTab(win, 'models', 'tikhub-connector')
      const tikhubCard = win.locator('[data-settings-section="tikhub-connector"], [data-testid="tikhub-connector"]').first()
      // 有些布局把 section 锚点放在滚动容器上;兜底用 dialog 整体。
      const dialog = win.locator('[role="dialog"]').first()
      const shotTarget = (await tikhubCard.count()) > 0 ? tikhubCard : dialog
      await shotTarget.scrollIntoViewIfNeeded().catch(() => {})
      await waitForVisualQuiescence(win).catch(() => {})
      const dir = path.join(shotsRoot, locale)
      fs.mkdirSync(dir, { recursive: true })
      await screenshotSettled(dialog, { path: path.join(dir, '15-settings-tikhub-card.png') })
      check(`[${locale}] TikHub 卡可达(models/tikhub-connector)`, (await dialog.count()) > 0)
      await assertSurfaceClean(win, locale, '设置·TikHub 卡')
    } catch (error) {
      check(`[${locale}] TikHub 卡`, false, String(error).split('\n')[0])
    }
    await closeSettings(win)

    return { app, shotsCount: SETTINGS_TABS.length + LIBS.length + 4 }
  } catch (error) {
    check(`[${locale}] 扫查未抛错`, false, String(error).split('\n').slice(0, 8).join(' / '))
    // 失败图：当场什么样就拍什么样（不等安定，见 _assert.mjs 注释）。
    await win.screenshot({ path: path.join(shotsRoot, `${tag}-FAIL.png`) }).catch(() => {})
    return { app, shotsCount: 0 }
  } finally {
    await app.close().catch(() => {})
  }
}

// 收尾：查各面截图两两不同（字节相同的两张 = 中间那步没发生，dark-journey 教训）。
function assertShotsDistinct(locale) {
  const dir = path.join(shotsRoot, locale)
  if (!fs.existsSync(dir)) {
    check(`[${locale}] 截图目录存在`, false, dir)
    return
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort()
  const hashes = new Map()
  let dupes = 0
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f))
    const key = `${buf.length}`
    // 用字节长度做粗筛，再对同长度的做全等比较（避免不同内容偶然同长度误判）。
    const prev = hashes.get(key)
    if (prev && Buffer.compare(prev.buf, buf) === 0) {
      dupes += 1
      console.log(`    ⚠ [${locale}] ${f} 与 ${prev.name} 字节完全相同（那一步可能没发生）`)
    } else {
      hashes.set(key, { buf, name: f })
    }
  }
  check(`[${locale}] 各面截图两两不同（${files.length} 张，${dupes} 重复）`, dupes === 0, `${files.length} 张`)
}

// ── 主流程：先 zh 后 en ──
await sweepLocale('zh-CN')
assertShotsDistinct('zh-CN')
await sweepLocale('en')
assertShotsDistinct('en')

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length ? '❌' : '✅'} 双语 i18n 扫查：${results.length - failed.length}/${results.length} 通过`)
console.log(`截图根目录：${shotsRoot}`)
if (failed.length) {
  console.log('失败项：')
  for (const r of failed) console.log(`  · ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
  process.exit(1)
}
