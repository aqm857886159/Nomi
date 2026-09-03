/**
 * 件0：打通断言器的 app 模式（2026-09-03）
 *
 * Piece 3: Agent UI 对应断言器 —— 读 agent-ui-spec.generated.json，
 * 对运行中的应用（或样张本身）逐条断言挂点存在性、几何、文案、token。
 *
 * 使用方法（对真实 Electron app）：
 *   CONFORMANCE_TARGET=app node tests/ux/agent-ui-conformance.walk.mjs
 *
 * 使用方法（对样张做自检·阳性对照验证）：
 *   CONFORMANCE_TARGET=mockup node tests/ux/agent-ui-conformance.walk.mjs
 *   CONFORMANCE_TARGET=mockup ONLY_SCREEN=A node tests/ux/agent-ui-conformance.walk.mjs
 *   CONFORMANCE_TARGET=mockup ONLY_FORM=data-agent-header node tests/ux/agent-ui-conformance.walk.mjs
 *
 * 失败报错格式（必须指名道姓）：
 *   [A-01][data-agent-header] 高度不符: 期望 41px±4，实测 52px（超出 +7px）
 *   [A-06][data-agent-user-bubble] 右对齐失败: 右缘距 flow 右缘应 ≤12px，实测 28px
 *
 * 过滤：
 *   --only-screen A        只跑屏 A 的断言
 *   --only-form data-agent-header  只跑该挂点的断言
 *   --only-p0              只跑 P0 级断言
 *
 * 阳性对照（红灯先行）：
 *   --positive-control     故意改一个元素（header 高度 +20px），断言器必须报红。
 *                          对 mockup 模式和 app 模式均有效。
 *   测试：先跑 --positive-control（预期：红），再跑正常模式（预期：绿）。
 */
// 件0：断言器 app 模式打通（2026-09-03）
// 件1：断言入口归一（2026-09-03）——自动层不再有私有断言实现，
// TOKEN_STEP_PX / MAGNITUDE_RATIO 与意图层共用 _contract.mjs 的常量，
// 保证「max(4px 步进, 25%)」这一容差策略在两层完全一致（件4：容差策略统一）。
// assertMockupContract 在走查末尾消费 .auto.mjs 契约，确保门岗能检测到「契约被走查引用」。
import { chromium } from '/Users/aoqimin/Desktop/Nomi/node_modules/playwright/index.mjs'
import { TOKEN_STEP_PX, MAGNITUDE_RATIO, assertMockupContract } from './_contract.mjs'
import autoContract from '../../docs/design/mockups/contracts/2026-09-01-agent-ui-final-redesign.auto.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp, closeNomiApp } from './_launchApp.mjs'

// 件0：agentHostEnabled localStorage key（来自 src/utils/agentHostPreference.ts）
// 硬编码字面值，避免在 .mjs 里直接引入 .ts 源文件。值与源码保持同步。
const AGENT_HOST_ENABLED_KEY = 'nomi.agentHost.enabled'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SPEC_PATH = path.join(ROOT, 'docs/design/agent-ui-spec.generated.json')
const MOCKUP_PATH = path.join(ROOT, 'docs/design/mockups/2026-09-01-agent-ui-final-redesign.html')

// ── CLI 参数解析 ──────────────────────────────────────────────────────────────

const TARGET = process.env.CONFORMANCE_TARGET || 'mockup'
const ONLY_SCREEN = (() => {
  const idx = process.argv.indexOf('--only-screen')
  if (idx >= 0) return process.argv[idx + 1]
  return process.env.ONLY_SCREEN || null
})()
const ONLY_FORM = (() => {
  const idx = process.argv.indexOf('--only-form')
  if (idx >= 0) return process.argv[idx + 1]
  return process.env.ONLY_FORM || null
})()
const ONLY_P0 = process.argv.includes('--only-p0')
const POSITIVE_CONTROL = process.argv.includes('--positive-control')

console.log(`\n=== Agent UI 对应断言器 ===`)
console.log(`目标：${TARGET === 'mockup' ? '样张（自检模式）' : '真实 Electron App'}`)
if (ONLY_SCREEN) console.log(`过滤：仅屏 ${ONLY_SCREEN}`)
if (ONLY_FORM) console.log(`过滤：仅挂点 ${ONLY_FORM}`)
if (ONLY_P0) console.log(`过滤：仅 P0 级断言`)
if (POSITIVE_CONTROL) console.log(`模式：阳性对照（故意注入缺陷，期望断言报红）`)
console.log()

// ── 读规格表 ──────────────────────────────────────────────────────────────────

if (!fs.existsSync(SPEC_PATH)) {
  console.error(`❌ 规格表不存在：${SPEC_PATH}`)
  console.error('   请先运行：node scripts/extract-design-spec.mjs')
  process.exit(1)
}

const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'))

// 过滤要跑的元素
let elements = spec.elements
if (ONLY_SCREEN) elements = elements.filter(e => e.screen === ONLY_SCREEN)
if (ONLY_FORM) elements = elements.filter(e => e.anchor === ONLY_FORM)
// P0 断言：A-01/A-03/A-05/A-06/A-07/A-10/A-11/A-12/A-13/A-16/A-17/A-18/A-19/A-20 / B-01/B-02/B-06/B-07 / C-01~04 / D-01~07
const P0_SPEC_REFS = new Set(['A-01','A-03','A-05','A-06','A-07','A-10','A-11','A-13','A-16','A-17','A-18','A-19','A-20','B-01','B-02','B-06','B-07','C-01','C-02','C-03','C-04','D-01','D-02','D-03','D-04','D-05','D-06','D-07'])
if (ONLY_P0) elements = elements.filter(e => P0_SPEC_REFS.has(e.specRef))

console.log(`将验证 ${elements.length} 条规格（共 ${spec.elements.length} 条）\n`)

// ── 断言结果收集 ──────────────────────────────────────────────────────────────

const failures = []
const passes = []
const skipped = []

function fail(anchor, specRef, message) {
  const msg = `[${specRef}][${anchor}] ${message}`
  failures.push(msg)
  console.error(`  ❌ ${msg}`)
}

function pass(anchor, specRef, message) {
  passes.push(`[${specRef}][${anchor}] ${message}`)
  // 不打印每一条 pass，只汇总
}

function skip(anchor, specRef, reason) {
  skipped.push(`[${specRef}][${anchor}] ${reason}`)
  console.log(`  ⏭ [${specRef}][${anchor}] ${reason}`)
}

// ── 几何容差检查（件1/件4：用 _contract.mjs 的 TOKEN_STEP_PX/MAGNITUDE_RATIO，不再自造容差逻辑）──

/** 统一容差：max(4px token步进, 期望值×25%)——意图层与自动层相同策略。 */
function uniformTolerance(expected) {
  return Math.max(TOKEN_STEP_PX, Math.abs(expected) * MAGNITUDE_RATIO)
}

function checkGeometry(elem, actualRect, anchor, specRef, injectedFaults = {}) {
  const expected = elem.geometry
  // 应用注入缺陷（阳性对照模式）
  const faultyExpected = { ...expected, ...injectedFaults }

  // 件4：统一用 max(4px, 25%) 策略，不再用规格表里的 tol.w/tol.h 固定值
  const wTol = uniformTolerance(faultyExpected.w)
  const hTol = uniformTolerance(faultyExpected.h)

  if (Math.abs(actualRect.w - faultyExpected.w) > wTol) {
    fail(anchor, specRef, `宽度不符: 期望 ${faultyExpected.w}px（容差 ±${Math.round(wTol)}px = max(${TOKEN_STEP_PX}px, ${MAGNITUDE_RATIO*100}%)），实测 ${actualRect.w}px（差 ${actualRect.w - faultyExpected.w > 0 ? '+' : ''}${actualRect.w - faultyExpected.w}px）`)
  } else {
    pass(anchor, specRef, `宽度 ${actualRect.w}px ✓`)
  }

  if (Math.abs(actualRect.h - faultyExpected.h) > hTol) {
    fail(anchor, specRef, `高度不符: 期望 ${faultyExpected.h}px（容差 ±${Math.round(hTol)}px = max(${TOKEN_STEP_PX}px, ${MAGNITUDE_RATIO*100}%)），实测 ${actualRect.h}px（差 ${actualRect.h - faultyExpected.h > 0 ? '+' : ''}${actualRect.h - faultyExpected.h}px）`)
  } else {
    pass(anchor, specRef, `高度 ${actualRect.h}px ✓`)
  }
}

// ── 辅助：提取 oklch L 通道 ───────────────────────────────────────────────────

function parseOklchL(colorStr) {
  const m = colorStr.match(/oklch\(\s*([\d.]+)/)
  if (m) return parseFloat(m[1])
  // 尝试从 rgb 计算近似 L（粗略）
  const rgb = colorStr.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/)
  if (rgb) {
    const r = parseFloat(rgb[1]) / 255
    const g = parseFloat(rgb[2]) / 255
    const b = parseFloat(rgb[3]) / 255
    return 0.2126 * r + 0.7152 * g + 0.0722 * b  // 相对亮度近似
  }
  return null
}

// ── 启动浏览器 / 准备现场 ─────────────────────────────────────────────────────

let page
let nomiApp = null  // Electron app handle（仅 app 模式使用）

if (TARGET === 'mockup') {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  page = await browser.newPage()
  await page.goto(`file://${MOCKUP_PATH}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
} else {
  // ── app 模式：起真实 Electron App，备场后才开始断言 ─────────────────────────
  // 件0：准备现场（步骤①②③④）
  //   ① 建临时隔离 profile 目录
  //   ② 置 agentHostEnabled=true（在 settingsDir 或 launchApp 后 evaluate 进 localStorage）
  //   ③ 起 Electron，等窗口
  //   ④ 导航：首启蒙层设 seen → reload → 新建空白项目 → 进生成画布 → 开 Agent 面板
  //   ⑤ 自证在现场：确认 [data-agent-panel] 存在，否则明确报「现场没准备好」并退出

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-conf0-'))
  const settingsDir = path.join(tempRoot, 'settings')
  const userDataDir = path.join(tempRoot, 'user-data')
  const projectsDir = path.join(tempRoot, 'projects')
  for (const dir of [settingsDir, userDataDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })

  console.log(`临时 profile：${tempRoot}`)
  console.log(`起动真实 Electron App（隔离 profile）...\n`)

  nomiApp = await launchNomiApp({
    name: 'agent-conformance',
    settingsDir, userDataDir, projectsDir,
    args: ['--disable-gpu', '--disable-software-rasterizer'],
    settleMs: 2000,
  })
  page = nomiApp.win

  // ── ② 置 agentHostEnabled=true（在首次载入后写 localStorage，reload 后生效）──
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(2200)
  await page.evaluate((key) => {
    // 首启蒙层/引导标 seen；关闭引导巡游；置 agentHostEnabled
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      localStorage.setItem(k, 'seen')
    }
    localStorage.setItem(key, 'true')
  }, AGENT_HOST_ENABLED_KEY)

  // reload 让 agentHostEnabled 生效（模块级缓存读 localStorage 值）
  // 注意：进项目后再 reload 会让 getActiveWorkbenchProjectId() 恒 null，面板静默空掉。
  // 所以在进项目前 reload。
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(2500)

  // ── ③ 新建空白项目 ────────────────────────────────────────────────────────
  console.log('  → 新建空白项目...')
  const blankCta = page.locator('button, [role="button"]', { hasText: '新建空白项目' }).first()
  try {
    await blankCta.waitFor({ state: 'visible', timeout: 15000 })
    await blankCta.click()
  } catch (e) {
    console.error(`❌ 现场没准备好：找不到「新建空白项目」按钮（${e.message}）`)
    process.exit(1)
  }
  await page.waitForTimeout(3000)

  // ── ④ 切换到「生成」工作区 ───────────────────────────────────────────────
  console.log('  → 切换到生成画布...')
  const genTab = page.locator('button, [role="button"], [role="tab"]', { hasText: /^生成$/ }).first()
  try {
    await genTab.waitFor({ state: 'visible', timeout: 10000 })
    await genTab.click()
    await page.locator('.generation-canvas-v2__stage').first().waitFor({ state: 'visible', timeout: 15000 })
  } catch (e) {
    console.error(`❌ 现场没准备好：切换到生成画布失败（${e.message}）`)
    process.exit(1)
  }
  await page.waitForTimeout(1000)

  // ── ④b 展开 Agent 面板 ──────────────────────────────────────────────────
  // 常驻助手可能处于折叠状态（显示为药丸按钮），需要展开。
  // 参考 agent-runtime-walk-support.mjs openCanvas() 的做法。
  console.log('  → 展开 Agent 面板...')
  const collapsedLauncher = page.locator('[data-agent-resident-collapsed="true"]')
  try {
    if (await collapsedLauncher.isVisible({ timeout: 3000 })) {
      await collapsedLauncher.click()
      await page.waitForTimeout(500)
    }
  } catch {
    // 可能已经展开了，继续
  }
  await page.waitForTimeout(1000)

  // ── ⑤ 自证在现场（件0 的灵魂）────────────────────────────────────────────
  // 教训 assert-you-are-in-the-situation-you-claim：开始逐条断言前先确认现场正确。
  // 找不到 [data-agent-panel] → 明确报「现场没准备好」，绝不退化成逐条报「元素不存在」。
  // 这两种失败的修法完全相反：① 现场没准备好→去备场；② 挂点缺→去补挂点。
  console.log('\n  → 自证在现场：检查 [data-agent-panel] 是否存在...')
  const panelEl = await page.$('[data-agent-panel]')
  if (!panelEl) {
    // 截图辅助排查（不依赖截图做判断，只是辅助）
    const shot = path.join(tempRoot, 'scene-not-ready.png')
    await page.screenshot({ path: shot }).catch(() => {})
    console.error(`❌ 现场没准备好：[data-agent-panel] 不在 DOM 中——Agent 面板未挂载。`)
    console.error(`   可能原因：agentHostEnabled 未生效（需 localStorage.setItem('${AGENT_HOST_ENABLED_KEY}', 'true') + reload）。`)
    console.error(`   截图：${shot}`)
    console.error(`   注意：这是「备场失败」，与「实现缺挂点」是完全不同的问题，修法相反。`)
    if (nomiApp) await closeNomiApp(nomiApp.app).catch(() => {})
    process.exit(1)
  }
  console.log('  ✓ [data-agent-panel] 存在，进入断言循环。\n')
}

// ── 阳性对照：注入缺陷 ────────────────────────────────────────────────────────

if (POSITIVE_CONTROL) {
  if (TARGET === 'mockup') {
    console.log('【阳性对照】注入缺陷：将 .asst-head 高度强制改为 +20px（期望断言报红）\n')
    await page.evaluate(() => {
      const el = document.querySelector('.asst-head')
      if (el) {
        el.style.setProperty('height', '61px', 'important')  // 正常 ~41px，+20px 超出 ±4 容差
        el.setAttribute('data-positive-control', 'true')
      }
    })
  } else {
    // app 模式阳性对照：找到 [data-agent-header]，注入假高度（让断言必须红）
    console.log('【阳性对照】注入缺陷：将 [data-agent-header] 高度强制改为 +20px（期望断言报红）\n')
    await page.evaluate(() => {
      const el = document.querySelector('[data-agent-header]')
      if (el) {
        el.style.setProperty('height', '61px', 'important')  // +20px 必超出 max(4px, 25%) 容差
        el.setAttribute('data-positive-control', 'true')
      } else {
        // 元素不存在时插入一个幽灵元素让断言能红（阳性对照：有缺陷的断言器必须报红）
        const ghost = document.createElement('div')
        ghost.setAttribute('data-agent-header', 'true')
        ghost.style.cssText = 'height:61px;width:300px;position:fixed;top:0;left:0;'
        ghost.setAttribute('data-positive-control', 'true')
        document.body.appendChild(ghost)
      }
    })
  }
  await page.waitForTimeout(100)
}

// ── 逐元素断言 ────────────────────────────────────────────────────────────────

let currentScreen = null

for (const elem of elements) {
  // 切换到对应屏（仅 mockup 模式：真实 app 没有 .screen/.on 结构）
  if (elem.screen !== currentScreen) {
    currentScreen = elem.screen
    console.log(`\n--- 屏 ${currentScreen} ---`)

    if (TARGET === 'mockup') {
      await page.evaluate((s) => {
        document.querySelectorAll('.screen').forEach(el => el.classList.remove('on'))
        const target = document.querySelector(`[data-screen="${s}"]`)
        if (target) target.classList.add('on')
      }, currentScreen)
      await page.waitForTimeout(200)
    }
    // app 模式：不执行屏切换——断言直接在当前 DOM 里找挂点。
    // 屏 A 的所有挂点应在展开的 Agent 面板里同时存在。
  }

  const { anchor, cssSelector, specRef, desc } = elem
  console.log(`\n  验证 [${specRef}] ${anchor} (${desc})`)

  // 1. 存在性断言：找到对应的 CSS 类元素（样张自检）或 data-agent-* 挂点（真实 app）
  //
  // 件0：修畸形选择器（规格里共 1 条属性限定形式：data-agent-at-token[data-stale=true]）
  // 错误形式：[data-agent-at-token[data-stale=true]] ← 嵌套括号，CSS 语法非法，Playwright 崩溃
  // 正确形式：[data-agent-at-token][data-stale="true"] ← 两个独立属性选择器并列
  //
  // 处理规则：若 anchor 含 "[...]" 后缀（属性限定），则将其转成合法的 CSS 属性选择器并列形式。
  // 样张模式直接用 cssSelector（已正确），app 模式需要从 anchor 构建选择器。
  let selector
  if (TARGET === 'mockup') {
    selector = cssSelector
  } else {
    // 把 anchor 里的属性限定 "[attr=val]" 拆分为独立的 CSS 选择器片段
    // 例：data-agent-at-token[data-stale=true]
    //   → base: data-agent-at-token
    //   → qualifier: [data-stale=true] → [data-stale="true"]（给值加双引号）
    //   → result: [data-agent-at-token][data-stale="true"]
    const qualifierMatch = anchor.match(/^([^[]+)(\[.+\])$/)
    if (qualifierMatch) {
      const base = qualifierMatch[1].trim()
      // 把 [attr=val] 里没有引号的值加上引号（CSS 属性选择器值必须带引号才合法）
      const qualifier = qualifierMatch[2].replace(/=([^"'\]]+)\]/, '="$1"]')
      selector = `[${base}]${qualifier}`
    } else {
      selector = `[${anchor}]`
    }
  }
  const actualElem = await page.$(selector)

  if (!actualElem) {
    fail(anchor, specRef, `元素不存在: 找不到 ${selector}`)
    // 无法继续几何断言
    continue
  }

  pass(anchor, specRef, '存在 ✓')

  // 2. 几何断言
  const actualRect = await actualElem.boundingBox()
  if (!actualRect) {
    fail(anchor, specRef, `元素不可见（boundingBox 为 null）`)
    continue
  }

  const rect = { w: Math.round(actualRect.width), h: Math.round(actualRect.height), x: Math.round(actualRect.x), y: Math.round(actualRect.y) }

  // 阳性对照模式：缺陷已经直接注入 DOM（高度改成 61px）——几何断言对比真实 DOM 值
  // 与规格期望值（~41px）自然报红，不需要额外修改 injectedFaults。
  checkGeometry(elem, rect, anchor, specRef, {})

  // 3. 特定元素的额外语义断言
  if (anchor === 'data-agent-header') {
    // A-01：头部高度应 ≤40px（单行证明）
    if (rect.h > 44) {
      fail(anchor, specRef, `头部高度超出单行上限：期望 ≤44px，实测 ${rect.h}px`)
    } else {
      pass(anchor, specRef, `头部单行高度 ${rect.h}px ≤44px ✓`)
    }
  }

  if (anchor === 'data-agent-user-bubble') {
    // A-06：右对齐验证
    // 找 flow 元素
    const flowEl = await page.$('.flow')
    if (flowEl) {
      const flowRect = await flowEl.boundingBox()
      if (flowRect) {
        const rightGap = flowRect.right - actualRect.right
        if (rightGap > 12) {
          fail(anchor, specRef, `右对齐失败: 右缘距 flow 右缘应 ≤12px，实测 ${Math.round(rightGap)}px`)
        } else {
          pass(anchor, specRef, `右对齐: 距 flow 右缘 ${Math.round(rightGap)}px ≤12px ✓`)
        }
      }
    }
  }

  if (anchor === 'data-agent-tool-line') {
    // A-11：单行高度 ≤32px
    if (rect.h > 32) {
      fail(anchor, specRef, `工具行高度超出单行：期望 ≤32px，实测 ${rect.h}px`)
    } else {
      pass(anchor, specRef, `工具行高度 ${rect.h}px ≤32px ✓`)
    }
  }

  if (anchor === 'data-agent-proposal-receipt') {
    // A-13：文案应含「已加」+数字+「节点」
    const text = await actualElem.innerText()
    if (!/已加\s*\d+\s*个节点/.test(text)) {
      fail(anchor, specRef, `文案不符: 期望含「已加 N 个节点」，实测「${text.slice(0, 50)}」`)
    } else {
      pass(anchor, specRef, `文案含「已加 N 个节点」✓`)
    }
  }

  if (anchor === 'data-agent-compaction-line') {
    // A-03：文案应含「已折叠」
    const text = await actualElem.innerText()
    if (!/已折叠/.test(text)) {
      fail(anchor, specRef, `文案不符: 期望含「已折叠」，实测「${text.slice(0, 50)}」`)
    } else {
      pass(anchor, specRef, `文案含「已折叠」✓`)
    }
  }

  if (anchor === 'data-agent-usage-pill') {
    // A-02：文案应匹配「还能聊 ~N 轮」
    const text = await actualElem.innerText()
    if (!/还能聊\s*~\d+\s*轮/.test(text)) {
      fail(anchor, specRef, `文案不符: 期望匹配「还能聊 ~N 轮」，实测「${text.slice(0, 80)}」`)
    } else {
      pass(anchor, specRef, `文案匹配「还能聊 ~N 轮」✓`)
    }
  }

  if (anchor === 'data-agent-composer-attach' || anchor === 'data-agent-composer-mode' ||
      anchor === 'data-agent-composer-model' || anchor === 'data-agent-composer-prompt') {
    // A-19：底排钮高度 28px±1（即 ≤29px）
    if (rect.h < 24 || rect.h > 32) {
      fail(anchor, specRef, `底排钮高度不符: 期望 28px±4，实测 ${rect.h}px`)
    } else {
      pass(anchor, specRef, `底排钮高度 ${rect.h}px ✓`)
    }
    // A-19：零常驻文字（innerText 应为空或只有 icon 字符）
    const text = (await actualElem.innerText()).trim()
    if (text.length > 3 && !/^[\u{1F000}-\u{1FFFF}]$/u.test(text)) {
      // 容许 icon 字符（Tabler icon 是 pseudo，innerText 可能为空）
      // 如果有超过 3 个字符且不是 emoji，则视为有常驻文字
      fail(anchor, specRef, `底排钮含常驻文字（期望 icon-only）：「${text.slice(0, 30)}」`)
    }
  }

  if (anchor === 'data-agent-model-alert') {
    // A-20：红点直径应 ≤8px
    if (rect.w > 10 || rect.h > 10) {
      fail(anchor, specRef, `红点尺寸超出：期望 ≤8px×8px，实测 ${rect.w}×${rect.h}px`)
    } else {
      pass(anchor, specRef, `红点尺寸 ${rect.w}×${rect.h}px ≤8px ✓`)
    }
  }

  if (anchor === 'data-agent-pinned-head') {
    // D-02：细条高度 ≈ 一条工具行（28px±4）
    if (rect.h < 20 || rect.h > 40) {
      fail(anchor, specRef, `细条头部高度不符: 期望 28px±8，实测 ${rect.h}px`)
    } else {
      pass(anchor, specRef, `细条头部高度 ${rect.h}px ✓`)
    }
  }
}

// ── 颜色断言：光暗双模（样张自检） ───────────────────────────────────────────

if (TARGET === 'mockup' && !ONLY_FORM && !ONLY_SCREEN) {
  console.log('\n--- 光暗双模颜色断言 ---')

  // 切回屏 A
  await page.evaluate(() => {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('on'))
    const target = document.querySelector('[data-screen="A"]')
    if (target) target.classList.add('on')
  })
  await page.waitForTimeout(200)

  // 亮色模式：用户气泡背景应是深色（nomi-ink）
  const bubbleBg = await page.$eval('.userbubble', el => getComputedStyle(el).backgroundColor)
  const bubbleLApprox = parseOklchL(bubbleBg)
  if (bubbleLApprox !== null && bubbleLApprox > 0.5) {
    fail('data-agent-user-bubble', 'A-06', `亮色模式气泡背景过亮（L≈${bubbleLApprox.toFixed(2)}，期望 L<0.5，即接近 nomi-ink）`)
  } else {
    pass('data-agent-user-bubble', 'A-06', `亮色模式气泡背景 L≈${bubbleLApprox?.toFixed(2)} ✓`)
  }

  // 切换到暗色模式
  await page.evaluate(() => {
    document.body.classList.add('dark')
  })
  await page.waitForTimeout(200)

  const bubbleBgDark = await page.$eval('.userbubble', el => getComputedStyle(el).backgroundColor)
  const darkLApprox = parseOklchL(bubbleBgDark)
  // 暗色模式气泡背景应是亮色（nomi-ink 在暗色是 oklch(0.93) 即偏亮）
  if (darkLApprox !== null && darkLApprox < 0.3) {
    fail('data-agent-user-bubble', 'A-06', `暗色模式气泡背景过暗（L≈${darkLApprox.toFixed(2)}，期望 L>0.3）`)
  } else {
    pass('data-agent-user-bubble', 'A-06', `暗色模式气泡背景 L≈${darkLApprox?.toFixed(2)} ✓`)
  }

  // 恢复亮色
  await page.evaluate(() => { document.body.classList.remove('dark') })
}

// ── 反断言：§2.1 的结构性检查（对样张做红夹具验证） ─────────────────────────

if (TARGET === 'mockup' && !ONLY_FORM && !ONLY_SCREEN) {
  console.log('\n--- 反断言（禁用词 · 对样张当前版本） ---')

  // 样张作为「已整改 v3」版本，应不含 §2.2 的禁用词
  const FORBIDDEN_VOCAB = [
    '当前现场', '结果卡区', '过闸', '校验分', '阈值', '看日志',
    '原位', 'M 线', '取证据', '本会话不再提示', '确认全部',
  ]

  // 限定范围：Agent 面板区域（.asst 子树），排除 .caption（设计注释）
  await page.evaluate(() => {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('on'))
    const target = document.querySelector('[data-screen="A"]')
    if (target) target.classList.add('on')
  })
  await page.waitForTimeout(100)

  for (const word of FORBIDDEN_VOCAB) {
    const found = await page.$eval('.asst', (el, w) => {
      // 排除 .caption（设计说明，不是 UI 文案）
      const text = el.innerText || ''
      return text.includes(w)
    }, word).catch(() => false)

    if (found) {
      fail('data-agent-panel', 'R-06', `禁用词出现在 agent 面板：「${word}」（应已被 v3 整改删除）`)
    } else {
      pass('data-agent-panel', 'R-06', `禁用词「${word}」不存在 ✓`)
    }
  }
}

// ── 件1：自动层契约（assertMockupContract）——与逐元素断言同一次运行 ──────────────
// 这里消费 .auto.mjs 契约，确保：① 门岗检测到契约被走查引用；② 两层契约在同一次 node 调用里执行。
// 注意：auto 契约规则跨多屏，需要按 spec 的 specRef 前缀切屏后分批调用。
// 仅在 mockup 模式下有意义（真实 app 用 data-agent-* 锚点，auto 契约用 cssSelector）。
if (TARGET === 'mockup' && !ONLY_FORM && !POSITIVE_CONTROL) {
  console.log('\n--- 自动层形态契约（assertMockupContract 按屏分批）---')
  // auto 契约规则按 name 里的 specRef 前缀（A/B/D）分批切屏
  const screenOf = (rule) => {
    const m = rule.name.match(/^\[([A-Z])/)
    return m ? m[1] : 'A'
  }
  const screens = [...new Set(autoContract.geometry.map(screenOf))]
  let autoTotal = 0
  for (const screen of screens) {
    const screenRules = autoContract.geometry.filter(r => screenOf(r) === screen)
    if (!screenRules.length) continue
    await page.evaluate((s) => {
      document.querySelectorAll('.screen').forEach(el => el.classList.remove('on'))
      const target = document.querySelector(`[data-screen="${s}"]`)
      if (target) target.classList.add('on')
    }, screen)
    await page.waitForTimeout(150)
    const screenContract = { ...autoContract, surface: `${autoContract.surface}·屏${screen}`, geometry: screenRules }
    try {
      const n = await assertMockupContract(page, screenContract)
      autoTotal += n
      passes.push(`自动层契约屏${screen} ${n} 条全符`)
    } catch (err) {
      failures.push(`自动层契约屏${screen}：${err.message}`)
      console.error(err.message)
    }
  }
  console.log(`  自动层共跑 ${autoTotal} 条规则`)
}

// ── 关闭浏览器 / Electron app ─────────────────────────────────────────────────

if (TARGET === 'mockup') {
  await page.context().browser()?.close().catch(() => {})
} else if (nomiApp) {
  await closeNomiApp(nomiApp.app).catch(() => {})
}

// ── 汇总结果 ──────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60))
console.log(`断言汇总：${passes.length} 通过 / ${failures.length} 失败 / ${skipped.length} 跳过`)
console.log('='.repeat(60))

if (POSITIVE_CONTROL && failures.length === 0) {
  console.error('\n【阳性对照失败】：注入了缺陷但断言全部通过——断言器没有抓住缺陷，需要检查断言逻辑。')
  process.exit(1)
}

if (POSITIVE_CONTROL && failures.length > 0) {
  console.log('\n【阳性对照成功】：断言器正确抓住了注入的缺陷：')
  for (const f of failures) console.log(`  ✓ 预期红：${f}`)
  console.log('\n断言器验证通过 — 可以信任它的绿灯结果。')
  process.exit(0)
}

if (failures.length > 0) {
  console.error(`\n❌ ${failures.length} 条断言失败：`)
  for (const f of failures) console.error(`  ${f}`)
  process.exit(1)
} else {
  console.log(`\n✅ 全部 ${passes.length} 条断言通过`)
  if (skipped.length > 0) console.log(`   ${skipped.length} 条跳过（见上方 ⏭ 标记）`)
  process.exit(0)
}
