// 走查里 `[data-xxx]` / `[data-xxx="值"]` 属性锚点的存活判定 —— check-walkthroughs 的 dead-data-attr 规则用它，
// 单独成模块只为**可单测**（check-walkthroughs.mjs 是 import 即执行的门岗脚本，测不了）。
//
// 为什么要这条规则（2026-10-08 外壳重设计）：删掉顶栏 Agent 角标 / 横向收起坞 / 创作资源树开关时，
// `[data-agent-topbar-badge="true"]`、`[data-v4-control="dock-open"]`、`[data-creation-resource-tree-toggle]`
// 这些锚点在十几份走查里悬空，而 dead-selector（只认 BEM 类名 `a__b`）和 dead-aria-label 都看不见属性锚点——
// 本仓走查绝大多数锚点恰恰是 data 属性。悬空的锚点两头撒谎：断言「在」= 假红，`.catch(() => {})` 包着点 = 假绿。

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
  const nameAlive = srcText.includes(attr) || srcText.includes(`dataset.${datasetKey(attr)}`) || withoutSelectors.includes(attr)
  if (!nameAlive) return false
  if (value === null || value === '' || /^(true|false|-?\d+(\.\d+)?)$/.test(value)) return true
  if (!srcText.includes(`${attr}="`)) return true
  return quoted(srcText, value) || srcText.includes(`${attr}="${value}"`) || withoutSelectors.includes(value)
}

export function findDeadDataAttributes(code, srcText) {
  return collectDataAttributeSelectors(code)
    .filter((hit) => !isDataAttributeAlive(hit, { srcText, walkCode: code }))
    .map((hit) => ({ ...hit, text: hit.value === null ? `[${hit.attr}]` : `[${hit.attr}="${hit.value}"]` }))
}
