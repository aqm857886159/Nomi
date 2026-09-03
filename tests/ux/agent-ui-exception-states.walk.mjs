// Agent UI P0 异常态样张形态走查（R13/R16）
//
// 对象：docs/design/mockups/2026-09-03-agent-ui-p0-exception-states.html
// 目的：① 验证意图层契约（assertMockupContract）；② 对 4 族策略关键属性截图留证。
//
// 运行方式：
//   node tests/ux/agent-ui-exception-states.walk.mjs
//   ONLY_SCREEN=S2 node tests/ux/agent-ui-exception-states.walk.mjs
//
// 输出截图：tests/ux/shots/agent-ui-exception-states/
//
// 走查深度：样张是静态 HTML，没有 Electron 后端；截图用人眼判断排版，
// 门岗用 assertMockupContract 判断结构正确性。

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from '/Users/aoqimin/Desktop/Nomi/node_modules/playwright/index.mjs'
import { assertMockupContract } from './_assert.mjs'
import intentContract from '../../docs/design/mockups/contracts/2026-09-03-agent-ui-p0-exception-states.intent.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MOCKUP_PATH = path.join(ROOT, 'docs/design/mockups/2026-09-03-agent-ui-p0-exception-states.html')
const OUT_DIR = path.join(ROOT, 'tests/ux/shots/agent-ui-exception-states')

fs.mkdirSync(OUT_DIR, { recursive: true })

// ── CLI 参数 ──────────────────────────────────────────────────────────────────

const ONLY_SCREEN = (() => {
  const idx = process.argv.indexOf('--only-screen')
  if (idx >= 0) return process.argv[idx + 1]
  return process.env.ONLY_SCREEN || null
})()

console.log('\n=== Agent UI P0 异常态 · 形态走查 ===')
console.log(`样张：${MOCKUP_PATH}`)
if (ONLY_SCREEN) console.log(`过滤：仅屏 ${ONLY_SCREEN}`)
console.log()

if (!fs.existsSync(MOCKUP_PATH)) {
  console.error(`❌ 样张不存在：${MOCKUP_PATH}`)
  process.exit(1)
}

// ── 4 族屏定义 ───────────────────────────────────────────────────────────────

const SCREENS = [
  { id: 'S1', label: '折叠族（10 件）' },
  { id: 'S2', label: '错误族（4 件）' },
  { id: 'S3', label: '加载族（2 件）' },
  { id: 'S4', label: '空状态族（1 件）' },
]

const screens = ONLY_SCREEN ? SCREENS.filter(s => s.id === ONLY_SCREEN) : SCREENS

// ── 启动浏览器 ────────────────────────────────────────────────────────────────

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await browser.newPage()

await page.goto(`file://${MOCKUP_PATH}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(300)

// ── 截图：每族截一张亮色 + 一张暗色 ─────────────────────────────────────────

for (const { id, label } of screens) {
  // 切到该屏
  await page.evaluate((s) => {
    document.querySelectorAll('[data-screen]').forEach(el => {
      el.style.display = el.getAttribute('data-screen') === s ? '' : 'none'
    })
    // 也尝试 tabs 切换（样张里的 tab 机制）
    document.querySelectorAll('[data-tab]').forEach(btn => {
      const on = btn.getAttribute('data-tab') === s
      btn.classList.toggle('active', on)
    })
  }, id)
  await page.waitForTimeout(150)

  // 亮色截图
  await page.screenshot({ path: path.join(OUT_DIR, `${id}-light.png`), fullPage: false })

  // 暗色截图
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.waitForTimeout(100)
  await page.screenshot({ path: path.join(OUT_DIR, `${id}-dark.png`), fullPage: false })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))

  console.log(`  📷 ${id} (${label}) → ${id}-light.png / ${id}-dark.png`)
}

// ── 意图层契约断言 ────────────────────────────────────────────────────────────
// 样张里 S1 包含折叠族卡（plan-card、deviation-card、queue-row 等），
// S2 包含错误族卡（proposal-receipt、spend-card、artifact-card），
// S4 包含空状态卡（at-picker）。
// intent 契约里的选择器对全页可见——切到目标屏再跑，让元素可见、才能正确断言。
// 注：structure 里的 before/after 用 compareDocumentPosition，不受 visibility 影响；
// ancestor/descendant 也基于 DOM 存在而非 visibility，但需要屏切到目标才保证「能量到」。

console.log('\n--- 意图层形态契约（assertMockupContract）---')

// 先让 S1-S4 全部可见（全页 DOM 展开），结构断言靠 DOM 位置不靠 visibility
await page.evaluate(() => {
  document.querySelectorAll('[data-screen]').forEach(el => {
    el.style.display = ''
  })
})
await page.waitForTimeout(200)

try {
  const n = await assertMockupContract(page, intentContract)
  console.log(`  ✅ 意图层契约通过（${n} 条规则）`)
} catch (err) {
  console.error(`  ❌ 意图层契约不符：\n${err.message}`)
  await browser.close()
  process.exit(1)
}

await browser.close()

// ── 截图清单（供人眼判断）────────────────────────────────────────────────────

console.log('\n截图清单（人眼判��要点）：')
for (const { id, label } of screens) {
  console.log(`  ${id}-light.png / ${id}-dark.png  →  ${label}`)
  console.log('    · 折叠族：fold-trigger 是否清晰可见；列表滚动区高度是否封顶；+N 盒是否与缩略图同行')
  console.log('    · 错误族：danger 色边框是否清晰；扣钱说明是否在原因文字之后；重试按钮是否存在')
  console.log('    · 加载族：骨架闪光动画是否运行；按钮是否禁用而非隐藏')
  console.log('    · 空状态族：图标 + 两行描述 + 单 CTA 是否居中排列')
}

console.log(`\n走查完成。截图输出：${OUT_DIR}`)
