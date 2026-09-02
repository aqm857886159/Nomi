#!/usr/bin/env node
/**
 * Piece 2: 规格表自动导出 —— 从样张 HTML 扫出视觉元素，导出机器可读规格表。
 *
 * 背景（关键事实）：
 *   样张 `2026-09-01-agent-ui-final-redesign.html` 用 CSS class 表达结构（.asst-head, .usage-pill…），
 *   而 conformance testspec 约定的 data-agent-* 挂点是**实现必须提供**的锚点。
 *   因此本脚本做两件事：
 *   1. 渲染样张，量出每个关键 CSS 类的真实几何（宽/高/位置）和计算色。
 *   2. 将 CSS 类映射到 data-agent-* 挂点（映射表由 §0 testspec 手工维护），
 *      让实现者能用规格表核对「我的实现和样张几何是否对得上」。
 *
 * 输出：docs/design/agent-ui-spec.generated.json
 *   每条记录：{ anchor, cssClass, screen, text, geometry, tokens, specRef, tolerances }
 *
 * 门岗（--check）：比较 json 与样张 hash 是否同步。
 *
 * 按屏过滤：--screen A（只提取屏 A 的元素）
 *
 * 用法：
 *   node scripts/extract-design-spec.mjs             # 生成规格表
 *   node scripts/extract-design-spec.mjs --check     # 门岗模式
 *   node scripts/extract-design-spec.mjs --screen A  # 只提取屏 A
 */
import { chromium } from '/Users/aoqimin/Desktop/Nomi/node_modules/playwright/index.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MOCKUP_PATH = path.join(ROOT, 'docs/design/mockups/2026-09-01-agent-ui-final-redesign.html')
const OUTPUT_PATH = path.join(ROOT, 'docs/design/agent-ui-spec.generated.json')
const HASH_PATH = path.join(ROOT, 'docs/design/agent-ui-spec.generated.hash')

const CHECK_ONLY = process.argv.includes('--check')
const ONLY_SCREEN = (() => {
  const idx = process.argv.indexOf('--screen')
  return idx >= 0 ? process.argv[idx + 1] : null
})()

function hashFile(fp) {
  if (!fs.existsSync(fp)) return null
  return crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex').slice(0, 16)
}

// ── 门岗模式 ──────────────────────────────────────────────────────────────────

if (CHECK_ONLY) {
  const mockupHash = hashFile(MOCKUP_PATH)
  const storedHash = fs.existsSync(HASH_PATH) ? fs.readFileSync(HASH_PATH, 'utf8').trim() : null
  const specExists = fs.existsSync(OUTPUT_PATH)

  if (!specExists || !storedHash) {
    console.error('❌ 规格表不存在，请先运行：node scripts/extract-design-spec.mjs')
    process.exit(1)
  }
  if (mockupHash !== storedHash) {
    console.error(`❌ 规格表与样张不同步`)
    console.error(`   样张 hash: ${mockupHash}`)
    console.error(`   记录 hash: ${storedHash}`)
    console.error(`   请重新运行：node scripts/extract-design-spec.mjs`)
    process.exit(1)
  }
  const spec = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'))
  console.log(`✅ 规格表与样张同步（hash: ${mockupHash}，${spec.elements.length} 条规格，${spec.screens.length} 屏）`)
  process.exit(0)
}

// ── CSS 类 → data-agent-* 挂点映射表 ─────────────────────────────────────────
// 真相源：docs/design/2026-09-02-agent-ui-conformance-testspec.md §0
// 这份映射是本脚本的核心维护物，映射变化时同步修改。
// 格式：{ cssSelector, anchor, specRef (testspec 断言 ID), screen, tolerances }

const CLASS_TO_ANCHOR = [
  // 屏 A
  { cssSelector: '.asst-head', anchor: 'data-agent-header', specRef: 'A-01', screen: 'A',
    desc: '头部一行', tolerances: { h: 4, padding: 4 } },
  { cssSelector: '.usage-pill', anchor: 'data-agent-usage-pill', specRef: 'A-02', screen: 'A',
    desc: '用量胶囊', tolerances: { h: 2, w: 8 } },
  { cssSelector: '.ctx-pop', anchor: 'data-agent-usage-popover', specRef: 'A-02', screen: 'A',
    desc: '用量明细浮层（悬停后）', tolerances: { w: 8 } },
  { cssSelector: '.hico[title="历史对话"]', anchor: 'data-agent-history', specRef: 'A-01', screen: 'A',
    desc: '历史对话按钮', tolerances: { w: 2, h: 2 } },
  { cssSelector: '.hico[title="收起"]', anchor: 'data-agent-collapse', specRef: 'A-01', screen: 'A',
    desc: '收起按钮', tolerances: { w: 2, h: 2 } },
  { cssSelector: '.flow', anchor: 'data-agent-flow', specRef: 'A-01', screen: 'A',
    desc: '会话流（role=log）', tolerances: { w: 4 } },
  { cssSelector: '.divider:not(.stage-line)', anchor: 'data-agent-compaction-line', specRef: 'A-03', screen: 'A',
    desc: '压缩分隔线', tolerances: { h: 4 } },
  { cssSelector: '.divider.stage-line', anchor: 'data-agent-stage-line', specRef: 'A-05', screen: 'A',
    desc: '阶段分隔线', tolerances: { h: 4 } },
  { cssSelector: '.userbubble', anchor: 'data-agent-user-bubble', specRef: 'A-06', screen: 'A',
    desc: '用户气泡', tolerances: { x: 4, h: 4 } },
  { cssSelector: '.evt', anchor: 'data-agent-skill-event', specRef: 'A-07', screen: 'A',
    desc: '技能载入事件行', tolerances: { h: 4 } },
  { cssSelector: '.line.settled', anchor: 'data-agent-thinking-line', specRef: 'A-08', screen: 'A',
    desc: '思考条（落定态）', tolerances: { h: 4 } },
  { cssSelector: '.asstext', anchor: 'data-agent-reply', specRef: 'A-10', screen: 'A',
    desc: '正文回复', tolerances: { h: 8 } },
  { cssSelector: '.toolline', anchor: 'data-agent-tool-line', specRef: 'A-11', screen: 'A',
    desc: '工具总览行', tolerances: { h: 4 } },
  { cssSelector: '.toolbody', anchor: 'data-agent-tool-detail', specRef: 'A-11', screen: 'A',
    desc: '工具明细', tolerances: { h: 8 } },
  { cssSelector: '.receipt', anchor: 'data-agent-proposal-receipt', specRef: 'A-13', screen: 'A',
    desc: '写入回执行', tolerances: { h: 4 } },
  { cssSelector: '.rico', anchor: 'data-agent-receipt-undo', specRef: 'A-13', screen: 'A',
    desc: '撤销 icon 钮', tolerances: { w: 4, h: 4 } },
  { cssSelector: '.lost-edits', anchor: 'data-agent-lost-edits-card', specRef: 'A-14', screen: 'A',
    desc: 'lost-edits 确认卡', tolerances: { h: 8 } },
  { cssSelector: '.chip-jump', anchor: 'data-agent-landing-chip', specRef: 'A-15', screen: 'A',
    desc: '落点胶囊', tolerances: { h: 4, w: 8 } },
  { cssSelector: '.qline', anchor: 'data-agent-queue-row', specRef: 'A-16', screen: 'A',
    desc: '排队行', tolerances: { h: 4 } },
  { cssSelector: '.qx', anchor: 'data-agent-queue-remove', specRef: 'A-16', screen: 'A',
    desc: '撤回 × 钮', tolerances: { w: 4, h: 4 } },
  { cssSelector: '.composer', anchor: 'data-agent-composer', specRef: 'A-17', screen: 'A',
    desc: 'composer 区', tolerances: { h: 8 } },
  { cssSelector: '.cprompt', anchor: 'data-agent-input', specRef: 'A-17', screen: 'A',
    desc: '输入框', tolerances: { h: 8 } },
  { cssSelector: '.at:not(.stale)', anchor: 'data-agent-at-token', specRef: 'A-18', screen: 'A',
    desc: '@ 引用 token（正常态）', tolerances: { h: 2 } },
  { cssSelector: '.at.stale', anchor: 'data-agent-at-token[data-stale=true]', specRef: 'A-18', screen: 'A',
    desc: '@ 引用 token（变黄态）', tolerances: { h: 2 } },
  { cssSelector: '.cbtn.ico[data-tip="附件"]', anchor: 'data-agent-composer-attach', specRef: 'A-19', screen: 'A',
    desc: '底排附件钮', tolerances: { w: 2, h: 2 } },
  { cssSelector: '.cbtn.ico[data-tip^="Agent"]', anchor: 'data-agent-composer-mode', specRef: 'A-19', screen: 'A',
    desc: '底排执行方式钮', tolerances: { w: 2, h: 2 } },
  { cssSelector: '.cbtn.ico[data-tip^="去选"]', anchor: 'data-agent-composer-model', specRef: 'A-19', screen: 'A',
    desc: '底排模型钮', tolerances: { w: 2, h: 2 } },
  { cssSelector: '.cbtn.ico[data-tip="提示词模板"]', anchor: 'data-agent-composer-prompt', specRef: 'A-19', screen: 'A',
    desc: '底排提示词钮', tolerances: { w: 2, h: 2 } },
  { cssSelector: '.send', anchor: 'data-agent-composer-send', specRef: 'A-19', screen: 'A',
    desc: '发送钮', tolerances: { w: 2, h: 2 } },
  { cssSelector: '.reddot', anchor: 'data-agent-model-alert', specRef: 'A-20', screen: 'A',
    desc: '模型未选红点', tolerances: { w: 2, h: 2 } },
  // 屏 B
  { cssSelector: '.card.accent .chd', anchor: 'data-agent-plan-card', specRef: 'B-01', screen: 'B',
    desc: '计划卡', tolerances: { h: 8 } },
  { cssSelector: '.card.accent .frozen', anchor: 'data-agent-spend-card', specRef: 'B-02', screen: 'B',
    desc: '付费确认卡', tolerances: { h: 8 } },
  { cssSelector: '.card.warn', anchor: 'data-agent-deviation-card', specRef: 'B-03', screen: 'B',
    desc: '有出入卡', tolerances: { h: 8 } },
  { cssSelector: '.card.artifact', anchor: 'data-agent-artifact-card', specRef: 'B-06', screen: 'B',
    desc: '产物缩略卡', tolerances: { h: 8 } },
  { cssSelector: '.card.danger', anchor: 'data-agent-failure-card', specRef: 'B-07', screen: 'B',
    desc: '失败卡', tolerances: { h: 8 } },
  // 屏 C
  { cssSelector: '.node-badge', anchor: 'data-decon-node-badge', specRef: 'C-02', screen: 'C',
    desc: '节点角标', tolerances: { h: 4 } },
  // 屏 D
  { cssSelector: '.result-card', anchor: 'data-agent-pinned-card', specRef: 'D-02', screen: 'D',
    desc: '固定结果卡', tolerances: { h: 8 } },
  { cssSelector: '.result-card .rc-head', anchor: 'data-agent-pinned-head', specRef: 'D-02', screen: 'D',
    desc: '固定卡头部', tolerances: { h: 4 } },
]

// ── 提取模式 ──────────────────────────────────────────────────────────────────

console.log('启动 Playwright Chromium 渲染样张...')

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
})
const page = await context.newPage()

await page.goto(`file://${MOCKUP_PATH}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)

// 提取屏列表
const screens = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-screen]')).map(s => s.getAttribute('data-screen')).filter(Boolean)
)
console.log(`发现屏：${screens.join(', ')}`)

const allElements = []

for (const screen of screens) {
  if (ONLY_SCREEN && screen !== ONLY_SCREEN) continue

  // 激活该屏
  await page.evaluate((s) => {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('on'))
    const target = document.querySelector(`[data-screen="${s}"]`)
    if (target) target.classList.add('on')
    // 同步激活 tab
    document.querySelectorAll('.tab').forEach(tab => {
      const active = tab.textContent?.includes(`屏 ${s}`)
      tab.classList.toggle('on', active)
    })
  }, screen)
  await page.waitForTimeout(200)

  // 对该屏的映射条目逐一提取几何和计算色
  const screenMappings = CLASS_TO_ANCHOR.filter(m => m.screen === screen)

  for (const mapping of screenMappings) {
    const result = await page.evaluate(({ cssSelector, anchor, specRef, screen: scr, desc, tolerances }) => {
      // 限定在当前激活屏内查找
      const screenEl = document.querySelector('.screen.on')
      if (!screenEl) return null

      const el = screenEl.querySelector(cssSelector)
      if (!el) return { anchor, cssSelector, specRef, screen: scr, desc, notFound: true }

      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        return { anchor, cssSelector, specRef, screen: scr, desc, notFound: true, reason: 'zero-size' }
      }

      const cs = getComputedStyle(el)
      return {
        anchor,
        selector: `[${anchor}]`,
        cssSelector,
        screen: scr,
        specRef,
        desc,
        tolerances,
        text: (el.innerText || '').trim().slice(0, 200),
        tagName: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        geometry: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
        },
        tokens: {
          backgroundColor: cs.backgroundColor,
          color: cs.color,
          borderColor: cs.borderColor,
          borderWidth: cs.borderWidth,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          lineHeight: cs.lineHeight,
          paddingTop: cs.paddingTop,
          paddingRight: cs.paddingRight,
          paddingBottom: cs.paddingBottom,
          paddingLeft: cs.paddingLeft,
        },
      }
    }, { cssSelector: mapping.cssSelector, anchor: mapping.anchor, specRef: mapping.specRef, screen, desc: mapping.desc, tolerances: mapping.tolerances })

    if (result) {
      if (result.notFound) {
        console.warn(`  ⚠ 屏 ${screen} 未找到：${mapping.cssSelector} (${mapping.desc})`)
      } else {
        allElements.push(result)
      }
    }
  }

  console.log(`屏 ${screen}：提取到 ${allElements.filter(e => e.screen === screen).length} / ${screenMappings.length} 个元素`)
}

await browser.close()

// ── 同时从 HTML 源码提取所有声明的 data-agent-* ───────────────────────────────

const mockupSource = fs.readFileSync(MOCKUP_PATH, 'utf8')
const declaredAnchors = Array.from(new Set(
  [...mockupSource.matchAll(/\bdata-agent-[\w-]+/g)].map(m => m[0]),
)).sort()

// conformance testspec 声明的挂点（来自 §0）
const specAnchors = [
  'data-agent-panel', 'data-agent-header', 'data-agent-usage-pill', 'data-agent-usage-popover',
  'data-agent-history', 'data-agent-collapse', 'data-agent-flow', 'data-agent-compaction-line',
  'data-agent-compaction-expand', 'data-agent-stage-line', 'data-agent-user-bubble',
  'data-agent-skill-event', 'data-agent-thinking-line', 'data-agent-reply', 'data-agent-stream-cursor',
  'data-agent-tool-line', 'data-agent-tool-detail', 'data-agent-proposal-receipt',
  'data-agent-receipt-undo', 'data-agent-lost-edits-card', 'data-agent-landing-chip',
  'data-agent-queue-row', 'data-agent-queue-remove', 'data-agent-composer', 'data-agent-input',
  'data-agent-at-picker', 'data-agent-at-token', 'data-agent-composer-attach',
  'data-agent-composer-mode', 'data-agent-composer-model', 'data-agent-composer-prompt',
  'data-agent-composer-send', 'data-agent-model-alert', 'data-agent-plan-card',
  'data-agent-spend-card', 'data-agent-deviation-card', 'data-agent-question-card',
  'data-agent-candidates-card', 'data-agent-artifact-card', 'data-agent-failure-card',
  'data-agent-pinned-card', 'data-agent-pinned-head', 'data-agent-pinned-summary',
  'data-agent-pinned-body', 'data-agent-topbar-badge', 'data-agent-badge-dot',
  'data-decon-node-stub', 'data-decon-node-badge', 'data-agent-tip',
]

// ── 构造输出 JSON ──────────────────────────────────────────────────────────────

const mockupHash = hashFile(MOCKUP_PATH)
const spec = {
  version: '1.0',
  generatedAt: new Date().toISOString(),
  description: '从样张 HTML 渲染提取的设计规格表——每条对应一个 conformance testspec 断言挂点，' +
    '包含真实几何（px）和计算色值，供实现者核对实现与样张是否对齐。',
  mockupPath: path.relative(ROOT, MOCKUP_PATH),
  mockupHash,
  screens,
  specAnchors,       // conformance testspec §0 声明的全量挂点（实现必须提供）
  declaredAnchors,   // 样张 HTML 里实际出现的 data-agent-* 属性（目前为 0，因为样张用 CSS class）
  elements: allElements,
  summary: {
    totalElements: allElements.length,
    byScreen: Object.fromEntries(
      screens.map(s => [s, allElements.filter(e => e.screen === s).length])
    ),
    coveredAnchors: allElements.map(e => e.anchor),
    uncoveredSpecAnchors: specAnchors.filter(a => !allElements.some(e => e.anchor === a || e.anchor === a.replace('data-', ''))),
  },
  note: [
    '样张当前不含 data-agent-* 属性（用 CSS class 表达结构）。',
    '本规格表通过 CLASS_TO_ANCHOR 映射将 CSS 类与 testspec 挂点关联。',
    '实现者应在生产代码中添加 data-agent-* 属性，断言器 (agent-ui-conformance.walk.mjs) 将对真实应用运行这些断言。',
    '样张几何是断言容差的设计真相源：±2px（坐标/尺寸）除非此表另标。',
  ],
}

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(spec, null, 2), 'utf8')
fs.writeFileSync(HASH_PATH, mockupHash, 'utf8')

const notFound = CLASS_TO_ANCHOR.filter(m => !allElements.some(e => e.cssSelector === m.cssSelector && e.screen === m.screen))

console.log(`\n✅ 规格表已生成：${path.relative(ROOT, OUTPUT_PATH)}`)
console.log(`   · ${allElements.length} 条规格，${screens.length} 屏`)
console.log(`   · ${specAnchors.length} 个 testspec 声明挂点（实现必须提供）`)
console.log(`   · ${notFound.length} 个映射未找到对应元素（见警告）`)
console.log(`   · hash: ${mockupHash}`)
console.log(`\n按屏分布：${JSON.stringify(spec.summary.byScreen)}`)
