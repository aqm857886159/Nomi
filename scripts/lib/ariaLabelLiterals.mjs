// 走查里 `[aria-label="…"]` 字面量的存活判定 —— check-walkthroughs 的 dead-aria-label 规则用它，
// 单独成模块只为**可单测**（check-walkthroughs.mjs 是 import 即执行的门岗脚本，测不了）。
//
// 为什么要这条规则（2026-09-05）：`[aria-label="生成区 AI 助手"]` 的渲染者随 Agent Host cutover 被删
// （d270d34ec），字面量却还留在两份走查里——一处断言它存在（假红），一处断言它不存在（恒真的假绿）。
// 类名死锚点已有 dead-selector 规则在管，而**文案锚点**没人管：它还多一层脆弱——aria-label 多半来自
// i18n，改文案/换语言就失效。见 docs/lessons/dead-selector-lies-both-ways.md。

/** `aria-label=` / `aria-label*=` / `^=` / `$=` 里的字面量（含转义引号写法）。 */
const ARIA_LABEL_RE = /aria-label(?:[*^$])?=\s*\\?["']([^"'\]\\]+)\\?["']/g

/** 源码里带插值占位的字符串值（i18n 模板 `添加{{kind}}节点`）。用来判「拼出来的 label」是否活着。 */
const INTERPOLATED_VALUE_RE = /['"`]([^'"`\n]*\{\{[a-zA-Z0-9_.]+\}\}[^'"`\n]*)['"`]/g

export function collectAriaLabelLiterals(code) {
  // 走查自己造的数据也会变成 aria-label（种一个 title='雨夜入场' 的节点，再按这个名字找它）。
  // 这类 label 在 src/ 里当然搜不到，却完全活着——把它们报成死锚点纯属噪音。
  // 判据：把全文里的 aria-label 选择器抠掉后，这个串**在本文件别处还出现**（种数据/URL/断言文案）
  // ⇒ 是走查自己造的数据，跳过。只当选择器用过的串才进入存活判定。
  const withoutSelectors = code.replace(ARIA_LABEL_RE, '')
  const out = []
  const seen = new Set()
  let match
  ARIA_LABEL_RE.lastIndex = 0
  while ((match = ARIA_LABEL_RE.exec(code)) !== null) {
    const literal = match[1]
    // 模板拼出来的（`添加${kind}节点`）静态判不了，跳过——这条规则只管纯字面量。
    if (literal.includes('${')) continue
    if (seen.has(literal)) continue
    seen.add(literal)
    if (withoutSelectors.includes(literal)) continue
    out.push({ literal, line: code.slice(0, match.index).split('\n').length })
  }
  return out
}

export function extractInterpolatedValues(srcText) {
  const values = new Set()
  let match
  INTERPOLATED_VALUE_RE.lastIndex = 0
  while ((match = INTERPOLATED_VALUE_RE.exec(srcText)) !== null) values.add(match[1])
  return [...values]
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 模板固定部分的最少字数。**这条是整个规则的成败所在**：词典里有一大票纯占位值
 * （`{{title}}`、`{{model}}`、`+{{count}}`），它们的通配模式是 `^.+$` —— 什么 label 都能"拼出来"，
 * 于是每个字面量都被判活、规则永远报不出东西（首版实测：322 个字面量、0 命中，等于没装）。
 * 要求固定部分 ≥2 字，把这类无锚模板挡在外面；`模型 {{model}}` 这种有锚的照常生效。
 */
const MIN_STATIC_CHARS = 2

/**
 * 模板能不能拼出这个 label：把 `{{x}}` 当通配符整串匹配。
 * 例：模板「添加{{kind}}节点」能拼出「添加视频节点」→ 活。
 * 通配用 `.+`（不是 `.*`）：占位处真有内容才算这个模板拼出来的；空插值的情况按字面量比对就够了。
 */
export function templateCanProduce(template, literal) {
  const parts = template.split(/\{\{[a-zA-Z0-9_.]+\}\}/)
  if (parts.length === 1) return false // 没有占位就不是模板,交给字面量比对
  if (parts.join('').trim().length < MIN_STATIC_CHARS) return false
  return new RegExp(`^${parts.map(escapeRegExp).join('.+')}$`).test(literal)
}

/**
 * label 是否还有渲染者。srcText 是 src/ 全文拼接（含 i18n 词典，故译文值也算命中）。
 * 判活优先：宁可漏报，也不要为了「扫得干净」把还在用的锚点报成死的（误报会让人把好断言删掉）。
 */
export function isAriaLabelAlive(literal, { srcText, templates }) {
  if (srcText.includes(literal)) return true
  return templates.some((template) => templateCanProduce(template, literal))
}
