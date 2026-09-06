// 依赖能力清单的抽取判据（R29 上游，2026-09-07）。
//
// 守的不变量：**「这个依赖到底提供了什么」不能靠人记得，要有一份随版本自动重生成的机读清单。**
//
// 起因：R29 的登记表（docs/engineering/framework-boundaries.json）是**人手写**的——它只覆盖
// 已经出过四列表的那几项能力。可 2026-09-06 #546 的教训恰恰是「没人知道框架已经有了」：
// 人手写的表天生只包含「已经知道的东西」，对「还不知道自己不知道」的那部分毫无办法。
// 于是这里换一条腿：从 node_modules 里**机器抽**每个依赖的导出符号与 README 标题，
// 得到一张「能力词表」。词表不做判断，它是给启发式（framework-boundary 的 advisory 一条）
// 和给人（写四列表时先看一眼）用的原料。
//
// 为什么抽的是「导出符号 + README 标题」而不是完整 API 签名：
//   · 完整签名要跑 api-extractor 之类的重工具，产物按版本天天变，没人会去读；
//   · 我们要回答的问题只是「这个词是不是这个依赖已经管的事」——词级别就够，
//     而词级别的产物小到可以进 git、可以 diff、可以在 review 里被看见。
//
// 判据抽成 lib 是为了能被 node-test 喂假包目录：生成器的测试如果只能跑真实 node_modules，
// 它在没装依赖的机器上就没有断言可跑（R17：加规则必须能先验它会红）。
import { createHash } from 'node:crypto'

/** 太通用、进了词表只会制造误报的词。命中启发式的价值 = 特异性，这些词一个都没有。 */
const NOISE = new Set([
  'type', 'types', 'props', 'prop', 'option', 'options', 'config', 'default', 'index', 'main',
  'value', 'values', 'data', 'item', 'items', 'list', 'string', 'number', 'boolean', 'object',
  'array', 'void', 'null', 'undefined', 'export', 'exports', 'import', 'return', 'result',
  'react', 'node', 'component', 'components', 'element', 'children', 'style', 'styles', 'class',
  'name', 'names', 'label', 'title', 'text', 'size', 'color', 'colors', 'theme', 'variant',
  'function', 'interface', 'declare', 'const', 'enum', 'params', 'param', 'args', 'input',
  'output', 'callback', 'handler', 'event', 'events', 'state', 'context', 'provider', 'usage',
  'install', 'license', 'contributing', 'changelog', 'example', 'examples', 'documentation',
  'installation', 'getting', 'started', 'about', 'more', 'this', 'that', 'with', 'from', 'into',
  'true', 'false', 'base', 'core', 'util', 'utils', 'helper', 'helpers', 'common', 'shared',
])

const EXPORT_DECLARATION = /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/g
const EXPORT_LIST = /\bexport\s+(?:type\s+)?\{([^}]*)\}/g
const README_HEADING = /^#{1,4}\s+(.+?)\s*$/gm

/** 一个标识符 → 小写词。驼峰 / 下划线 / 连字符都拆开。 */
export function tokenize(identifier) {
  return String(identifier)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 4 && !/^\d+$/.test(word) && !NOISE.has(word))
}

/** 从 .d.ts 文本里抽导出符号名（声明式 + 导出列表两种写法）。 */
export function extractExportSymbols(source) {
  const symbols = new Set()
  const text = String(source ?? '')
  for (const match of text.matchAll(EXPORT_DECLARATION)) symbols.add(match[1])
  for (const match of text.matchAll(EXPORT_LIST)) {
    for (const member of match[1].split(',')) {
      const parts = member.trim().split(/\s+as\s+/)
      const exported = (parts.length > 1 ? parts.at(-1) : parts[0]).trim().replace(/^type\s+/, '')
      if (/^[A-Za-z_$][\w$]*$/.test(exported) && exported !== 'default') symbols.add(exported)
    }
  }
  return [...symbols].sort()
}

/** README 的标题行（一级到四级）。标题是作者自己给能力起的名字，比正文噪音低得多。 */
export function extractReadmeHeadings(readme) {
  const headings = []
  for (const match of String(readme ?? '').matchAll(README_HEADING)) {
    const heading = match[1].replace(/[`*_[\]()#]/g, '').trim()
    if (heading) headings.push(heading)
  }
  return headings
}

/**
 * 词表 = 导出符号词 ∪ README 标题词，按出现频次取前 limit 个，最终按字母序落盘。
 * 落盘按字母序是为了 diff 可读：频次序会让一个无关的新导出把整张表洗一遍。
 */
export function capabilityWords({ symbols = [], headings = [], limit = 300 }) {
  const counts = new Map()
  const bump = (word) => counts.set(word, (counts.get(word) ?? 0) + 1)
  for (const symbol of symbols) for (const word of tokenize(symbol)) bump(word)
  for (const heading of headings) for (const word of tokenize(heading)) bump(word)
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word)
    .sort()
}

/**
 * 指纹 = 版本 + 词表的 sha256。版本变了、或同版本抽出来的词变了，指纹就变——
 * `--check` 比的就是它。指纹不含文件数/字节数：那些会随打包细节漂，制造无意义的红。
 */
export function fingerprintOf({ version, words }) {
  return createHash('sha256')
    .update(JSON.stringify({ version: String(version ?? ''), words }))
    .digest('hex')
    .slice(0, 16)
}

/** 比对生成结果与落盘清单。返回错误数组（空 = 一致）。缺失的包由调用方决定怎么处置。 */
export function comparePackages({ generated, stored }) {
  const errors = []
  const storedByName = new Map((stored ?? []).map((entry) => [entry.name, entry]))
  for (const entry of generated) {
    const previous = storedByName.get(entry.name)
    if (!previous) {
      errors.push(`${entry.name}: 清单里没有这个包 —— 跑 pnpm run gen:dependency-capabilities`)
      continue
    }
    if (previous.version !== entry.version) {
      errors.push(`${entry.name}: 版本从 ${previous.version} 变成 ${entry.version}，能力词表必须重新生成`)
      continue
    }
    if (previous.fingerprint !== entry.fingerprint) {
      errors.push(`${entry.name}@${entry.version}: 词表指纹从 ${previous.fingerprint} 变成 ${entry.fingerprint}`)
    }
  }
  return errors
}
