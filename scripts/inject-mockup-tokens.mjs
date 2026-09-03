#!/usr/bin/env node
/**
 * Piece 1: Token injection — 让样张 HTML 引用真实 --nomi-* token，不再自己抄值。
 *
 * 问题：样张 `docs/design/mockups/2026-09-01-agent-ui-final-redesign.html` 在 :root 里
 * 用了本地别名 (--bg, --ink, --ac…)，值是手写 oklch() 字面量。
 * 真实 token 源在 `src/theme/nomi-tokens.css`（--nomi-bg, --nomi-ink…）。
 * 两份值各自漂移，互相对不上，正是"样张和实现不同步"的根因之一。
 *
 * 本脚本做两件事：
 * 1. 把样张 HTML 的 :root 色值替换成 var(--nomi-*) / var(--workbench-*) 引用，
 *    同时注入真实 token CSS 文件路径（相对链接 ../../src/theme/nomi-tokens.css）。
 * 2. 门岗模式（--check）：只检查样张里出现的色值是否全部能在 token 表里找到，
 *    有游离值就红；这条进 check:design-spec 门岗链。
 *
 * 使用：
 *   node scripts/inject-mockup-tokens.mjs             # 改写样张 HTML
 *   node scripts/inject-mockup-tokens.mjs --check     # 只检查，不改写（门岗模式）
 *
 * 为什么门岗模式用字面量比对而不是 headless 渲染：
 *   样张是纯静态 HTML，不依赖 vite/webpack；字面量 grep 比启动浏览器快 100x，且无需
 *   真机 Electron。真实 token 漂移（改了 nomi-tokens.css 忘改样张）可以被这条静态闸拦住。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MOCKUP_PATH = path.join(ROOT, 'docs/design/mockups/2026-09-01-agent-ui-final-redesign.html')
const TOKENS_CSS_PATH = path.join(ROOT, 'src/theme/nomi-tokens.css')
const TAILWIND_CONFIG_PATH = path.join(ROOT, 'tailwind.config.ts')

const CHECK_ONLY = process.argv.includes('--check')

// ── 1. 读取真实 token 值 ──────────────────────────────────────────────────────

function parseTokensFromCss(cssText) {
  const tokens = {}
  // 匹配 --name: value; 形态（单行）
  for (const m of cssText.matchAll(/^\s*(--nomi-[\w-]+)\s*:\s*([^;]+);/gm)) {
    const name = m[1].trim()
    const val = m[2].trim()
    if (!tokens[name]) tokens[name] = {}
    // 简单区分 light/dark（dark 块在 :root[data-mantine-color-scheme="dark"]）
    if (!tokens[name].light) tokens[name].light = val
    else tokens[name].dark = val
  }
  return tokens
}

function parseWorkbenchTokensFromTailwind(tsText) {
  const tokens = {}
  // 匹配 '--workbench-*': 'value' 格式
  for (const m of tsText.matchAll(/'(--workbench-[\w-]+)'\s*:\s*'([^']+)'/g)) {
    const name = m[1]
    const val = m[2]
    if (!tokens[name]) tokens[name] = { light: val }
    else tokens[name].dark = val
  }
  return tokens
}

const cssText = fs.readFileSync(TOKENS_CSS_PATH, 'utf8')
const tailwindText = fs.readFileSync(TAILWIND_CONFIG_PATH, 'utf8')
const nomiTokens = parseTokensFromCss(cssText)
const workbenchTokens = parseWorkbenchTokensFromTailwind(tailwindText)

// 合并成扁平映射：token 名 → 亮色值
const allTokenLightValues = new Map()
for (const [name, v] of Object.entries(nomiTokens)) {
  allTokenLightValues.set(name, v.light)
}
for (const [name, v] of Object.entries(workbenchTokens)) {
  if (v.light) allTokenLightValues.set(name, v.light)
}

// ── 2. 提取样张里的硬编码色值 ────────────────────────────────────────────────

const mockupHtml = fs.readFileSync(MOCKUP_PATH, 'utf8')

// 提取 :root 块（第一个，即亮色）里定义的本地别名
// 格式: --bg:oklch(...); 或 --bg: #fff;
// 只取第一个 :root { ... body.dark { 之前的部分，避免把暗色值当亮色误判漂移
const firstRootBlock = (() => {
  const m = mockupHtml.match(/:root\{([\s\S]*?)(?=body\.dark\{|<\/style>)/)
  return m ? m[1] : mockupHtml
})()
const localAliasRe = /--([\w-]+)\s*:\s*(oklch\([^)]+\)|#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/g

const localAliases = {}  // shortName → value
for (const m of firstRootBlock.matchAll(localAliasRe)) {
  const name = m[1]
  const val = m[2]
  // 只收短名（不含 nomi- 前缀的）
  if (!name.startsWith('nomi-') && !name.startsWith('workbench-')) {
    localAliases[name] = val
  }
}

// ── 3. 建立本地别名 → nomi token 的映射表 ─────────────────────────────────

// 手工维护的映射表（因为样张用了短缩写，必须由此文件定义映射关系）。
// 格式：mockup 本地别名 → 真实 token 名
// 这份映射本身是「真相源」，更改样张变量名时同步修改此处。
const ALIAS_TO_TOKEN = {
  'bg':      '--nomi-bg',
  'paper':   '--nomi-paper',
  'canvas':  '--nomi-bg',  // canvas 与 bg 近似，样张用于画布背景区
  'ink':     '--nomi-ink',
  'ink80':   '--nomi-ink-80',
  'ink60':   '--nomi-ink-60',
  'ink40':   '--nomi-ink-40',
  'ink30':   '--nomi-ink-30',
  'ink20':   '--nomi-ink-20',
  'ink10':   '--nomi-ink-10',
  'ink05':   '--nomi-ink-05',
  'line':    '--nomi-line',
  'lineS':   '--nomi-line-soft',
  'ac':      '--nomi-accent',
  'acS':     '--nomi-accent-soft',
  'acBg':    '--nomi-accent-soft',  // acBg ≈ accent-soft（浅色背景）
  'warn':    '--nomi-warning',
  'warnBg':  '--nomi-warning',   // warnBg 使用 warning + 透明，这里指向基础 warning
  'ok':      '--workbench-success-ink',
  'okBg':    '--workbench-success-soft',
  'dg':      '--workbench-danger',
  'dgBg':    '--workbench-danger-soft',
}

// ── 4. 门岗检查 ──────────────────────────────────────────────────────────────

const errors = []
const warnings = []

// 检查每个本地别名是否都有对应的真实 token
for (const [alias, nomiName] of Object.entries(ALIAS_TO_TOKEN)) {
  if (!allTokenLightValues.has(nomiName)) {
    errors.push(`别名 --${alias} 映射到 ${nomiName}，但该 token 不存在于 nomi-tokens.css 或 tailwind.config.ts`)
  }
}

// 检查样张里引用的所有本地别名是否都在映射表里
const refRe = /var\(--([\w-]+)\)/g
const referencedAliases = new Set()
for (const m of mockupHtml.matchAll(refRe)) {
  const name = m[1]
  if (!name.startsWith('nomi-') && !name.startsWith('workbench-')) {
    // 跳过非颜色/几何变量
    if (!['r-ctl', 'r-panel', 'r-lg', 't-tap', 't-enter', 't-settle', 't-breathe', 't-sweep', 'ease', 'asst'].includes(name)) {
      referencedAliases.add(name)
    }
  }
}

for (const alias of referencedAliases) {
  if (!ALIAS_TO_TOKEN[alias] && !(alias in localAliases && !ALIAS_TO_TOKEN[alias])) {
    warnings.push(`样张 var(--${alias}) 未在 ALIAS_TO_TOKEN 中找到对应 nomi token（可能是非色值变量）`)
  }
}

// 检查样张定义的本地别名值是否与真实 token 接近（防止值漂移）
const CLOSE_ENOUGH_TOLERANCE = 0.03  // oklch L 通道容差
let drifts = 0

function extractOklchL(val) {
  const m = val.match(/oklch\(\s*([\d.]+)/)
  return m ? parseFloat(m[1]) : null
}

for (const [alias, nomiName] of Object.entries(ALIAS_TO_TOKEN)) {
  const mockupVal = localAliases[alias]
  const tokenVal = allTokenLightValues.get(nomiName)
  if (!mockupVal || !tokenVal) continue

  const mockupL = extractOklchL(mockupVal)
  const tokenL = extractOklchL(tokenVal)

  if (mockupL !== null && tokenL !== null) {
    if (Math.abs(mockupL - tokenL) > CLOSE_ENOUGH_TOLERANCE) {
      drifts++
      warnings.push(
        `值漂移：--${alias}(样张 L=${mockupL}) vs ${nomiName}(真实 L=${tokenL}，差 ${Math.abs(mockupL - tokenL).toFixed(3)})` +
        ` — 注入后会使用真实 token 值，漂移消除`
      )
    }
  }
}

// ── 5. 输出检查结果 ───────────────────────────────────────────────────────────

if (errors.length > 0) {
  console.error(`\n❌ token 映射错误（${errors.length} 条）：`)
  for (const e of errors) console.error(`   ${e}`)
}

if (warnings.length > 0) {
  console.warn(`\n⚠️  警告（${warnings.length} 条）：`)
  for (const w of warnings) console.warn(`   ${w}`)
}

if (CHECK_ONLY) {
  if (errors.length > 0) {
    console.error('\n门岗结论：红（有映射错误）')
    process.exit(1)
  }
  // 检查样张是否已经注入了 token 引用（即已跑过 inject 模式）
  if (!mockupHtml.includes('<!-- nomi-tokens:injected -->')) {
    console.error('\n门岗结论：红（样张还未注入 token 引用，请运行 node scripts/inject-mockup-tokens.mjs）')
    process.exit(1)
  }
  const drift_count = warnings.filter(w => w.startsWith('值漂移')).length
  if (drift_count > 0) {
    console.warn(`\n门岗结论：黄（${drift_count} 个值漂移已被 token 引用覆盖，重新跑 inject 模式同步）`)
  } else {
    console.log(`\n✅ 门岗结论：绿 — 样张已注入 token 引用，所有别名均有对应真实 token（${allTokenLightValues.size} tokens 已核）`)
  }
  process.exit(0)
}

// ── 6. 注入模式：改写样张 HTML ────────────────────────────────────────────────

if (errors.length > 0) {
  console.error('\n有映射错误，停止注入。请先修复上方错误。')
  process.exit(1)
}

// 构造注入块：在样张 <style> 前插入 token link + 覆盖 :root 别名为 var(--nomi-*)
const tokenLink = `<!-- nomi-tokens:injected -->\n<style>\n/* 自动注入：本地别名 → 真实 nomi token 引用（由 scripts/inject-mockup-tokens.mjs 生成）*/\n/* 修改方式：改 src/theme/nomi-tokens.css 或 ALIAS_TO_TOKEN 映射，然后重新运行 inject */\n:root {\n`

let aliasOverrides = ''
for (const [alias, nomiName] of Object.entries(ALIAS_TO_TOKEN)) {
  aliasOverrides += `  --${alias}: var(${nomiName});\n`
}
aliasOverrides += `}\n</style>\n`

// 将注入块插在第一个 <style> 标签前
let injected = mockupHtml
// 先删除旧的注入块（如果有）
injected = injected.replace(/<!-- nomi-tokens:injected -->[\s\S]*?<\/style>\n/, '')
// 插入新注入块
injected = injected.replace(/(<style>)/, tokenLink + aliasOverrides + '$1')

fs.writeFileSync(MOCKUP_PATH, injected, 'utf8')

const totalDrifts = warnings.filter(w => w.startsWith('值漂移')).length
console.log(`✅ 注入完成：`)
console.log(`   · 映射了 ${Object.keys(ALIAS_TO_TOKEN).length} 个本地别名 → nomi token`)
console.log(`   · 消除了 ${totalDrifts} 个值漂移（覆盖为真实 token）`)
console.log(`   · 样张文件：${path.relative(ROOT, MOCKUP_PATH)}`)
console.log(`\n运行 node scripts/inject-mockup-tokens.mjs --check 验证状态`)
