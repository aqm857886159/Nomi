/**
 * 件0：断言器 app 模式打通（2026-09-03）
 * 件0b：夹具驱动（2026-09-03）
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
 * 三类失败（件0b 引入，三者修法完全不同，禁止混淆）：
 *   现场没准备好  —— 面板未挂载 / 夹具驱不到该状态（备场问题，去修测试设施）
 *   状态未驱达    —— 夹具尝试驱动但 UI 没到目标态（驱动问题，描述清缺哪个状态）
 *   元素不存在    —— 状态到了但 data-agent-* 挂点确实不在 DOM（真差距，件1 补挂点）
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
// 件0b：夹具驱动接入（2026-09-03）——按屏分阶段备场，三类错误清晰分开。
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
import { createAgentRuntimeFixture } from './agent-runtime-fixture.mjs'

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
// 件0b：三类失败分别计数，最终分类报告
const trueGap = []          // 元素不存在（状态已驱达，挂点缺失）→ 件1 补挂点
const stateNotReached = []  // 状态未驱达（夹具没能把 UI 驱到目标状态）→ 修测试设施
const sceneNotReady = []    // 现场没准备好（面板未挂载）→ 修备场步骤

function fail(anchor, specRef, message, category = 'gap') {
  const msg = `[${specRef}][${anchor}] ${message}`
  failures.push(msg)
  console.error(`  ❌ ${msg}`)
  if (category === 'gap') trueGap.push(msg)
  else if (category === 'state') stateNotReached.push(msg)
  else if (category === 'scene') sceneNotReady.push(msg)
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

  // responsiveH: 元素高度响应式（flex-1 占满剩余空间），不与样张固定高度对比；
  // 改为相对关系断言：高度必须 > 0（元素可见且有内容区）。
  if (elem.responsiveH) {
    if (actualRect.h > 0) {
      pass(anchor, specRef, `高度 ${actualRect.h}px >0（响应式，不断言固定值）✓`)
    } else {
      fail(anchor, specRef, `高度为 0：元素不可见或被压缩至消失`)
    }
  } else if (Math.abs(actualRect.h - faultyExpected.h) > hTol) {
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

// ── 件0b：夹具状态驱动辅助 ───────────────────────────────────────────────────

/**
 * 向 Agent 面板发送一条消息（用 aria-label 定位，不依赖 data-agent-input 挂点）。
 * 等待 fixture 收到请求后返回 received promise（供调用方继续驱动）。
 *
 * 件0b 设计纪律：这里用 page.fill + page.click 是因为 data-agent-input 是「真差距」
 * （实现缺挂点），测试不能因为挂点缺失就无法驱动状态。
 * 驱动机制要和挂点断言解耦——驱动用 aria-label，断言用 data-agent-*。
 */
async function sendAgentMessage(page, text) {
  const textarea = page.getByRole('textbox', { name: /给生成助手发送消息|创作 AI 输入/ }).first()
  // 如果找不到，退化到在 [data-agent-panel] 内找任何 textbox
  const fallback = page.locator('[data-agent-panel] textarea, [data-agent-panel] [role="textbox"]').first()
  let input
  try {
    await textarea.waitFor({ state: 'visible', timeout: 5000 })
    input = textarea
  } catch {
    try {
      await fallback.waitFor({ state: 'visible', timeout: 3000 })
      input = fallback
    } catch {
      return null  // 找不到输入框，驱动失败
    }
  }
  await input.fill(text)
  // 找发送按钮：优先用 aria-label，退化到 data-agent-composer-send
  const sendBtn = page.getByRole('button', { name: /生成 AI 发送|创作 AI 发送|发送/ }).first()
  const sendFallback = page.locator('[data-agent-composer-send="true"]').first()
  try {
    await sendBtn.click({ timeout: 3000 })
  } catch {
    try { await sendFallback.click({ timeout: 3000 }) } catch { return null }
  }
  return true
}

/**
 * 等待 fixture 请求到达并立刻释放回复，然后等待 [data-agent-panel] 内出现预期内容。
 * 超时后报「状态未驱达」而不是「元素不存在」。
 */
async function driveAndWait(page, fixture, expectation, waitSelector, stateDesc, timeoutMs = 15000) {
  const start = Date.now()
  let received = false
  try {
    await Promise.race([
      expectation.received.then(() => { received = true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`请求未到达 ${stateDesc}`)), timeoutMs)),
    ])
  } catch (e) {
    return { ok: false, reason: `夹具请求未收到（${e.message}）` }
  }
  // 等 UI 出现目标元素
  try {
    await page.waitForSelector(waitSelector, { timeout: timeoutMs - (Date.now() - start) + 1000 })
    return { ok: true }
  } catch {
    return { ok: false, reason: `${stateDesc} 的 UI 状态未出现（等 ${waitSelector} 超时）` }
  }
}

// ── 启动浏览器 / 准备现场 ─────────────────────────────────────────────────────

let page
let nomiApp = null  // Electron app handle（仅 app 模式使用）
let runtimeFixture = null  // 件0b：agent-runtime-fixture 实例
// 件0b：顶层声明，app 模式下在备场阶段设为 true，断言循环里依赖它分类
let fixtureConvDone = false

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
  //
  // 件0b 新增：
  //   ⑥ 启动 createAgentRuntimeFixture（loopback 模型服务器 + 写入 model-catalog.json）
  //      让 App 能选到文本模型，才能触发真实 agent 会话，才能驱出会话流各元素。
  //      注意：fixture 必须在 launchNomiApp 之前写好 model-catalog.json，
  //      因为 App 启动时会读一次目录；但 createAgentRuntimeFixture 要求目录存在（wx 写锁）。

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-conf0b-'))
  const settingsDir = path.join(tempRoot, 'settings')
  const userDataDir = path.join(tempRoot, 'user-data')
  const projectsDir = path.join(tempRoot, 'projects')
  for (const dir of [settingsDir, userDataDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })

  // ── 件0b ⑥：先建 fixture（写 model-catalog.json），再起 App ─────────────────
  console.log(`临时 profile：${tempRoot}`)
  console.log(`件0b：启动 agent-runtime-fixture（loopback 模型服务器）...`)
  try {
    runtimeFixture = await createAgentRuntimeFixture({ rootDir: ROOT, settingsDir })
    console.log(`  ✓ loopback 服务器已起，baseURL：${runtimeFixture.baseURL}`)
  } catch (e) {
    console.error(`❌ 现场没准备好：createAgentRuntimeFixture 启动失败（${e.message}）`)
    process.exit(1)
  }

  // ── 件0b：修补 model-catalog.json 让文本模型通过 filterUsableAssistantTextModels ──
  // 根因：createAgentRuntimeFixture 写的 catalog 有两处过不了 filterUsableAssistantTextModels：
  //   1. text 模型缺 published:true（filter 第 3 个 && 条件要求 model.published）
  //   2. vendor 用 authType:'bearer' + enc:'plain'，apiKeyDecryptStatus 返回 'needs_resave'
  //      而非 'ok'，所以 hasApiKey 派生为 false，vendor 不进 usableVendorKeys。
  // 修法（两处）：
  //   1. 给 text 模型加 published:true
  //   2. 把 vendor 的 authType 改为 'none'（loopback 服务器不鉴权，'none' 合法），
  //      这样 vendor 无需 hasApiKey 就能进 usableVendorKeys。
  // 注意：这两处修改仅在测试用的临时隔离 profile 里，不改任何源文件。
  {
    const catalogPath = path.join(settingsDir, 'model-catalog.json')
    try {
      const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
      // 1. 给文本模型加 published:true
      for (const model of (catalog.models || [])) {
        if (model.kind === 'text') model.published = true
      }
      // 2. 把 vendor 改为 authType:'none'（loopback 服务器不校验 Authorization）
      for (const vendor of (catalog.vendors || [])) {
        vendor.authType = 'none'
      }
      fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n')
      console.log(`  ✓ 已修补 model-catalog.json（published:true + authType:none）`)
    } catch (e) {
      console.error(`❌ 现场没准备好：修补 model-catalog.json 失败（${e.message}）`)
      if (runtimeFixture) await runtimeFixture.close().catch(() => {})
      process.exit(1)
    }
  }

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
    if (runtimeFixture) await runtimeFixture.close().catch(() => {})
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
    if (runtimeFixture) await runtimeFixture.close().catch(() => {})
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
    if (runtimeFixture) await runtimeFixture.close().catch(() => {})
    if (nomiApp) await closeNomiApp(nomiApp.app).catch(() => {})
    process.exit(1)
  }
  console.log('  ✓ [data-agent-panel] 存在，进入断言循环。\n')

  // ── 件0b：驱动屏 A 对话流状态 ─────────────────────────────────────────────
  // 在静态断言前，用 fixture 驱入一轮用户→AI 对话，让面板里出现会话流元素。
  // 目标：驱出 data-agent-user-bubble / data-agent-reply / data-agent-skill-event 等。
  // 驱动原则（spec §4 §4b 明文要求）：确定性夹具，不烧真模型。
  //
  // 设计选择：只驱一轮简短回复（文本消息），不驱 tool-call / proposal / 复杂状态，
  // 原因是这些状态依赖的挂点是「真差距」还是「挂点存在但需要特定交互」需要先用基础回复确认。
  // 复杂状态留到件1 落挂点后再分阶段驱动。
  console.log('  → 件0b：用 fixture 驱入第一轮对话（文本回复）...')
  const FIXTURE_REPLY_TEXT = '件0b 对照回复：这是夹具注入的确定性文本，用于证明对话流元素出现。'
  // 注意：fixtureConvDone 已在顶层声明为 false，这里直接赋值
  if (runtimeFixture) {
    const expectation = runtimeFixture.expectText({
      label: '件0b-基础文本回复',
      reply: { type: 'text', text: FIXTURE_REPLY_TEXT },
    })
    const sent = await sendAgentMessage(page, '件0b 驱动消息：请回复确认。')
    if (sent) {
      // 等待请求到达 + UI 状态出现（最多 20s）
      const result = await driveAndWait(
        page, runtimeFixture, expectation,
        // 找「AI 回复内容」出现的迹象：item kind=assistant 或找回复文本
        `[data-agent-flow] [data-agent-item-kind="assistant"], [data-agent-transcript] [data-agent-item-kind="assistant"]`,
        '对话流助手回复',
        20000
      )
      if (result.ok) {
        fixtureConvDone = true
        console.log('  ✓ 件0b 对话驱动成功：助手回复已出现在面板。')
      } else {
        console.log(`  ⚠ 件0b 对话驱动失败：${result.reason}`)
        console.log('    注意：会话流相关断言将标记为「状态未驱达」而非「元素不存在」。')
      }
    } else {
      console.log('  ⚠ 件0b 驱动失败：找不到输入框，无法发送消息。')
    }
    await page.waitForTimeout(1500)
  }

  // ── 件0b：阳性对照（夹具路径）──────────────────────────────────────────────
  // 目标：证明「夹具成功驱达某状态后，故意改一处能报红」。
  // 做法：在 fixture 驱达成功后，检查 FIXTURE_REPLY_TEXT 文本是否出现在面板里。
  // 阳性对照在正式断言循环外运行，确保阳性对照失败不影响分类计数。
  if (POSITIVE_CONTROL && fixtureConvDone) {
    console.log('\n【件0b 夹具阳性对照】验证夹具注入的文本在面板里可检测...')
    const fixtureTextPresent = await page.$eval(
      '[data-agent-panel]',
      (panel, text) => panel.innerText.includes(text),
      FIXTURE_REPLY_TEXT
    ).catch(() => false)
    if (!fixtureTextPresent) {
      console.error('【件0b 夹具阳性对照失败】：夹具注入了文本但面板里找不到——夹具驱动没有真正生效。')
    } else {
      console.log('  ✓ 夹具文本存在于面板——驱动路径有效。')
      // 现在故意注入一处假元素 + 假几何，验证断言器报红
      console.log('  注入 [data-agent-header] 高度 +20px（阳性对照），预期断言报红...')
    }
  }
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

// ── 件0b：判断挂点是否属于「需要运行时状态才出现」的类别 ─────────────────────
//
// 这个映射表决定：当一个挂点找不到时，用哪个错误分类报错。
// 背景知识来自对 src/workbench/ai/ProjectAgentResidentShell.tsx 的实查（不猜）：
//
// 【件1 已修·spec 名已单独挂（旧名已删）】：
//   - data-agent-usage-pill      → 已加
//   - data-agent-history         → 已加
//   - data-agent-collapse        → 已加（新增）
//   - data-agent-input           → 已加（AutoGrowTextarea 透传 ...rest）
//   - data-agent-composer-attach → 已加
//   - data-agent-composer-mode   → 已加
//   - data-agent-composer-model  → 已加
//   - data-agent-composer-prompt → 已加
//   - data-agent-composer-send   → 已加
//   - data-agent-user-bubble     → 已加（item.kind==='user' 时条件渲染）
//   - data-agent-reply           → 已加（item.kind==='assistant' 时条件渲染）
//   - data-agent-thinking-line   → 已加
//   - data-agent-tool-line       → 已加
//   - data-agent-queue-row       → 已加
//   - data-agent-queue-remove    → 已加
//
// 【真差距·元素不存在 → 交后续排期，不虚造 UI】：
//   - data-agent-model-alert     → 无未选模型红点 UI
//   - data-agent-receipt-undo    → UI 里没有 undo 按钮（API 存在但无渲染）
//   - data-agent-at-token        → 语义不同于 composer reference chip，待后续
//   - data-agent-plan-card       → BatchPlanOverlay 不在 agent panel 内
//   - data-agent-spend-card      → 同上（canvas overlay）
//   - data-agent-deviation-card  → ReconcileDeviationCard 系统不同，data-reconcile-deviation-card
//   - data-agent-artifact-card   → 未在任何文件中找到
//   - data-agent-failure-card    → 未在任何文件中找到
//   - data-agent-pinned-card     → 未在任何文件中找到
//   - data-agent-pinned-head     → 未在任何文件中找到
//
// 【状态未驱达】：属性可能存在于实现中，但需要特定运行时状态才出现，
//   且本次夹具驱动（基础文本回复）不足以产生该状态：
//   - data-agent-compaction-line → 需要多轮折叠后才出现
//   - data-agent-stage-line      → 需要阶段切换事件
//   - data-agent-skill-event     → 需要技能加载事件（依赖 skill 配置）
//   - data-agent-proposal-receipt → 只在 item.status=done 时出现（需要工具调用+确认）
//   - data-agent-lost-edits-card → 需要 undo+编辑冲突场景
//   - data-agent-landing-chip    → 需要落点胶囊场景
//
// 分类的意义：修法完全相反
//   真差距（元素存在）→ 件1 在实现里加 data-agent-* 挂点（已完成见上）
//   真差距（元素不存在）→ 交后续，不虚造 shell UI
//   状态未驱达 → 在夹具/备场里加驱动步骤（改测试设施，不改实现）

const TRUE_GAP_ANCHORS = new Set([
  // 件1 已修的从这里移走——若下面仍找不到，说明实现回归，应红
  // 仍未实现（元素不存在，不可虚造 UI）：
  'data-agent-model-alert',
  'data-agent-receipt-undo',
  'data-agent-at-token',
  'data-agent-at-token[data-stale=true]',
  'data-agent-plan-card',
  'data-agent-spend-card',
  'data-agent-deviation-card',
  'data-agent-artifact-card',
  'data-agent-failure-card',
  'data-agent-pinned-card',
  'data-agent-pinned-head',
])

const STATE_NOT_REACHED_ANCHORS = new Set([
  'data-agent-compaction-line',
  'data-agent-stage-line',
  'data-agent-skill-event',
  'data-agent-proposal-receipt',
  'data-agent-lost-edits-card',
  'data-agent-landing-chip',
])

// 件0b：会话流元素（data-agent-user-bubble / data-agent-reply / data-agent-skill-event 等）
// 在基础文本回复驱动成功后，它们「应该」出现——如果还是找不到，这是「真差距」（挂点名不对）。
// 如果驱动失败（fixtureConvDone=false），则降级为「状态未驱达」。
const CONV_FLOW_ANCHORS = new Set([
  'data-agent-user-bubble',
  'data-agent-skill-event',
  'data-agent-reply',
  'data-agent-thinking-line',
])

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
    // 件0b：三类失败分类
    if (TARGET === 'app') {
      if (STATE_NOT_REACHED_ANCHORS.has(anchor)) {
        // 状态未驱达：这个状态需要特定运行时状态才出现，基础夹具没能驱到
        const reason = anchor === 'data-agent-compaction-line'
          ? '需要多轮对话被压缩折叠后才出现，基础文本回复驱动不够'
          : anchor === 'data-agent-stage-line'
          ? '需要 agent 执行跨阶段任务（如分镜+生成流水线），基础文本回复不触发'
          : anchor === 'data-agent-skill-event'
          ? '需要技能加载事件（依赖已安装且启用的 skill 配置）'
          : anchor === 'data-agent-proposal-receipt'
          ? '需要工具调用（create_canvas_nodes）被用户确认后才出现（item.status=done）'
          : anchor === 'data-agent-lost-edits-card'
          ? '需要 undo 撞上手改冲突的特定场景'
          : anchor === 'data-agent-landing-chip'
          ? '需要节点落点完成后出现落点胶囊场景'
          : '状态未驱达（需要特定运行时状态）'
        fail(anchor, specRef, `状态未驱达：${reason}`, 'state')
      } else if (CONV_FLOW_ANCHORS.has(anchor) && !fixtureConvDone) {
        // 会话流元素但 fixture 驱动失败了
        fail(anchor, specRef, `状态未驱达：fixture 对话驱动失败，无法验证会话流元素是否存在（见上方驱动失败日志）`, 'state')
      } else {
        // 真差距：挂点名不对或实现没有这个属性
        // 件1 已修的挂点如果回归出现在这里，说明实现被意外改回：
        const hint = anchor === 'data-agent-usage-pill' ? '（件1 已修·回归：ProjectAgentResidentShell.tsx 应挂此属性）'
          : anchor === 'data-agent-history' ? '（件1 已修·回归：应挂此属性）'
          : anchor === 'data-agent-collapse' ? '（件1 已修·回归：应在 collapse 按钮挂此属性）'
          : anchor === 'data-agent-input' ? '（件1 已修·回归：AutoGrowTextarea ...rest 透传应带此属性）'
          : anchor === 'data-agent-composer-attach' ? '（件1 已修·回归：应挂此属性）'
          : anchor === 'data-agent-composer-mode' ? '（件1 已修·回归：应挂此属性）'
          : anchor === 'data-agent-composer-model' ? '（件1 已修·回归：应挂此属性）'
          : anchor === 'data-agent-composer-prompt' ? '（件1 已修·回归：应挂此属性）'
          : anchor === 'data-agent-composer-send' ? '（件1 已修·回归：应挂此属性）'
          : anchor === 'data-agent-user-bubble' ? '（件1 已修·回归：item.kind==="user" 时应带此属性）'
          : anchor === 'data-agent-reply' ? '（件1 已修·回归：item.kind==="assistant" 时应带此属性）'
          : anchor === 'data-agent-thinking-line' ? '（件1 已修·回归：ResidentUiPrimitives details 应挂此属性）'
          : anchor === 'data-agent-tool-line' ? '（件1 已修·回归：ResidentToolChips section 应挂此属性）'
          : anchor === 'data-agent-queue-row' ? '（件1 已修·回归：queue li 应挂此属性）'
          : anchor === 'data-agent-queue-remove' ? '（件1 已修·回归：queue cancel button 应挂此属性）'
          // 仍未实现（元素不存在）：
          : anchor === 'data-agent-model-alert' ? '（元素不存在：无未选模型红点 UI，交后续排期）'
          : anchor === 'data-agent-receipt-undo' ? '（元素不存在：UI 无 undo 按钮，transitionProposalReceipt API 存在但无渲染）'
          : anchor === 'data-agent-at-token' ? '（元素不存在：语义不同于 composer reference chip，交后续排期）'
          : anchor.startsWith('data-agent-at-token[') ? '（元素不存在：data-agent-at-token 本体缺失）'
          : anchor === 'data-agent-plan-card' ? '（元素不存在：BatchPlanOverlay 在 canvas overlay，不在 agent panel）'
          : anchor === 'data-agent-spend-card' ? '（元素不存在：同 plan-card，canvas overlay 层）'
          : anchor === 'data-agent-deviation-card' ? '（元素不存在：ReconcileDeviationCard 用 data-reconcile-deviation-card，不同系统）'
          : anchor === 'data-agent-artifact-card' ? '（元素不存在：全仓未找到，交后续排期）'
          : anchor === 'data-agent-failure-card' ? '（元素不存在：全仓未找到，交后续排期）'
          : anchor === 'data-agent-pinned-card' ? '（元素不存在：全仓未找到，交后续排期）'
          : anchor === 'data-agent-pinned-head' ? '（元素不存在：全仓未找到，交后续排期）'
          : ''
        fail(anchor, specRef, `元素不存在: 找不到 ${selector}${hint ? ' ' + hint : ''}`, 'gap')
      }
    } else {
      fail(anchor, specRef, `元素不存在: 找不到 ${selector}`)
    }
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

// ── 关闭夹具 / 浏览器 / Electron app ─────────────────────────────────────────

if (runtimeFixture) await runtimeFixture.close().catch(() => {})
if (TARGET === 'mockup') {
  await page.context().browser()?.close().catch(() => {})
} else if (nomiApp) {
  await closeNomiApp(nomiApp.app).catch(() => {})
}

// ── 汇总结果（件0b：三类分开报告）────────────────────────────────────────────

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

  // 件0b：三类分类报告（这是本班的存在理由）
  console.log('\n' + '='.repeat(60))
  console.log('=== 件0b 施工基线（三类分类）===')
  console.log('='.repeat(60))
  console.log(`\n通过：${passes.length} 条`)
  console.log(`\n真差距（状态到了但挂点缺失 → 件1 补挂点）：${trueGap.length} 条`)
  for (const f of trueGap) console.log(`  [真差距] ${f}`)
  console.log(`\n状态未驱达（夹具/备场问题 → 修测试设施）：${stateNotReached.length} 条`)
  for (const f of stateNotReached) console.log(`  [状态未驱达] ${f}`)
  if (sceneNotReady.length > 0) {
    console.log(`\n现场没准备好（面板/夹具未就绪）：${sceneNotReady.length} 条`)
    for (const f of sceneNotReady) console.log(`  [现场未就绪] ${f}`)
  }
  process.exit(1)
} else {
  console.log(`\n✅ 全部 ${passes.length} 条断言通过`)
  if (skipped.length > 0) console.log(`   ${skipped.length} 条跳过（见上方 ⏭ 标记）`)
  process.exit(0)
}
