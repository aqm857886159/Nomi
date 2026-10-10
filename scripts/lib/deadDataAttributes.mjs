// 走查里 `[data-xxx]` / `[data-xxx="值"]` 属性锚点的存活判定 —— check-walkthroughs 的 dead-data-attr 规则用它，
// 单独成模块只为**可单测**（check-walkthroughs.mjs 是 import 即执行的门岗脚本，测不了）。
//
// 为什么要这条规则（2026-10-08 外壳重设计）：删掉顶栏 Agent 角标 / 横向收起坞 / 创作资源树开关时，
// `[data-agent-topbar-badge="true"]`、`[data-v4-control="dock-open"]`、`[data-creation-resource-tree-toggle]`
// 这些锚点在十几份走查里悬空，而 dead-selector（只认 BEM 类名 `a__b`）和 dead-aria-label 都看不见属性锚点——
// 本仓走查绝大多数锚点恰恰是 data 属性。悬空的锚点两头撒谎：断言「在」= 假红，`.catch(() => {})` 包着点 = 假绿。

import fs from 'node:fs'
import path from 'node:path'

/**
 * 「谁在渲染这个属性」的全文：App 源码（src/）+ 官网静态页（marketing/，官网走查的锚点住在那里）
 * + 走查自带的组件夹具（tests/ux/fixtures/）。只扫 src/ 会把官网与夹具的锚点误报成悬空（首版实测 26 条）。
 */
export function collectRenderText(repoRoot) {
  const chunks = []
  const walk = (dir, pattern) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, pattern)
      else if (pattern.test(entry.name)) chunks.push(fs.readFileSync(full, 'utf8'))
    }
  }
  walk(path.join(repoRoot, 'src'), /\.(tsx?|css)$/)
  walk(path.join(repoRoot, 'marketing'), /\.(html|m?js|css)$/)
  walk(path.join(repoRoot, 'tests', 'ux', 'fixtures'), /\.(tsx?|html|m?js)$/)
  return chunks.join('\n')
}

/** 选择器里的属性锚点：`[data-foo]`、`[data-foo="x"]`、`[data-foo^='x']`。值只收纯字面量（不含 `${`）。 */
const DATA_ATTR_SELECTOR_RE = /\[(data-[a-z0-9]+(?:-[a-z0-9]+)*)\s*(?:([~|^$*]?=)\s*\\?["']([^"'\]\\]*)\\?["']\s*)?\]/g

/** 第三方运行时自己挂的属性（xyflow / Radix / Mantine）——src 里不会有人写，但运行时活着。 */
const THIRD_PARTY_ATTRS = new Set([
  'data-id', 'data-highlighted', 'data-state', 'data-side', 'data-align', 'data-orientation',
  'data-disabled', 'data-placeholder', 'data-active', 'data-checked', 'data-selected', 'data-expanded',
  'data-position', 'data-with-border', 'data-handlepos', 'data-nodeid', 'data-handleid', 'data-testid',
])
const THIRD_PARTY_PREFIXES = ['data-streamdown', 'data-radix-', 'data-mantine-', 'data-rf', 'data-floating-ui-', 'data-sonner-', 'data-tiptap-']

/** `data-foo-bar` → `fooBar`（源码里用 `dataset.fooBar` 写的也算活）。 */
export function datasetKey(attr) {
  return attr.slice('data-'.length).replace(/-([a-z0-9])/g, (_m, c) => c.toUpperCase())
}

export function collectDataAttributeSelectors(code) {
  const out = []
  const seen = new Set()
  let match
  DATA_ATTR_SELECTOR_RE.lastIndex = 0
  while ((match = DATA_ATTR_SELECTOR_RE.exec(code)) !== null) {
    const attr = match[1]
    // 只有「等于」才判值；^= *= 这类前缀/包含匹配的值天然是半截，判不了。
    const value = match[2] === '=' && match[3] !== undefined && !match[3].includes('${') ? match[3] : null
    // 「已删的东西不许回来」的防复发断言：expectAbsent 里的锚点**本来就该**无人渲染（它带 provenBy 证明探针活着），
    // 不算悬空。只认同一行里的 expectAbsent(——其它写法的「不存在」判断照样报，逼它换成带基线的 expectAbsent。
    const lineStart = code.lastIndexOf('\n', match.index) + 1
    const lineEnd = code.indexOf('\n', match.index)
    if (code.slice(lineStart, lineEnd === -1 ? code.length : lineEnd).includes('expectAbsent(')) continue
    const key = `${attr}=${value ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ attr, value, line: code.slice(0, match.index).split('\n').length })
  }
  return out
}

function quoted(text, value) {
  return text.includes(`'${value}'`) || text.includes(`"${value}"`) || text.includes(`\`${value}\``)
}

/**
 * 判活口径**故意宽**（宁可漏报不误报）：
 * - 属性名：整串出现在 src/ 全文（JSX `data-foo=`、对象键、模板前缀都算），或 `dataset.fooBar`；
 * - 值（只判 `="字面量"`，跳过 true/false/数字；且只判 src 里**写死过字面量值**的属性——`data-v4-control="history"`
 *   这类枚举控件名；`data-clip-id={clip.id}` 这类数据驱动的值静态判不了，跳过）：src/ 里以引号字面量出现过；
 * - 走查自己造的（evaluate 里 setAttribute、拼 HTML 夹具）：去掉选择器后本文件别处还出现。
 */
export function isDataAttributeAlive({ attr, value }, { srcText, walkCode }) {
  if (THIRD_PARTY_ATTRS.has(attr) || THIRD_PARTY_PREFIXES.some((prefix) => attr.startsWith(prefix))) return true
  const withoutSelectors = walkCode.replace(DATA_ATTR_SELECTOR_RE, '')
  const key = datasetKey(attr)
  const nameAlive = srcText.includes(attr) || srcText.includes(`dataset.${key}`)
    || withoutSelectors.includes(attr) || withoutSelectors.includes(`dataset.${key}`)
  if (!nameAlive) return false
  if (value === null || value === '' || /^(true|false|-?\d+(\.\d+)?)$/.test(value)) return true
  // 值只在「这个属性从来都是写死字面量」时才判：只要有一处 `attr={表达式}`，值就是数据驱动的，静态判不了。
  if (!srcText.includes(`${attr}="`) || isDynamicallyAssigned(attr, srcText)) return true
  return quoted(srcText, value) || srcText.includes(`${attr}="${value}"`) || withoutSelectors.includes(value)
}

/** 这个属性在渲染源里有没有一处是表达式赋值（JSX `attr={…}`，或对象键 `'attr': 变量`）——有就说明值是数据驱动的。 */
function isDynamicallyAssigned(attr, srcText) {
  if (srcText.includes(`${attr}={`)) return true
  // 属性名只含小写字母、数字和连字符（见 DATA_ATTR_SELECTOR_RE），拼进正则不用转义。
  return new RegExp(`['"]${attr}['"]\\s*:\\s*[^'"\\s]`).test(srcText)
}

export function findDeadDataAttributes(code, srcText) {
  return collectDataAttributeSelectors(code)
    .filter((hit) => !isDataAttributeAlive(hit, { srcText, walkCode: code }))
    .map((hit) => ({ ...hit, text: hit.value === null ? `[${hit.attr}]` : `[${hit.attr}="${hit.value}"]` }))
}

/**
 * 在某个提交（通常是 merge-base）那棵树上，用同一条规则量悬空 data 属性锚点总数——新规则首发基线只认这个数。
 * 扫的范围与门岗一致：tests/ux 顶层与 tests/ux/g1 的走查脚本；渲染源与 collectRenderText 一致。
 */
export async function countDeadDataAttributesAtRevision(repoRoot, rev) {
  const { readTreeTexts } = await import('./walkthroughBaselineGuard.mjs')
  const render = [
    ...readTreeTexts(repoRoot, rev, ['src'], /\.(tsx?|css)$/),
    ...readTreeTexts(repoRoot, rev, ['marketing'], /\.(html|m?js|css)$/),
    ...readTreeTexts(repoRoot, rev, ['tests/ux/fixtures'], /\.(tsx?|html|m?js)$/),
  ].map((entry) => entry.text).join('\n')
  const walks = readTreeTexts(repoRoot, rev, ['tests/ux'], /^tests\/ux\/(g1\/[^/]+\.mjs|[^/]+\.(mjs|cjs))$/)
  const strip = (source) => source.replace(/\r\n?/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  return walks.reduce((sum, walk) => sum + findDeadDataAttributes(strip(walk.text), render).length, 0)
}
