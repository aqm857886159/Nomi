// 控件文案契约（check:controls 的规则四~六）—— 设计系统 §1.8 里可机器判定的那三条。
//
// 起因（2026-09-10）：分镜面上并排四颗**文字**按钮（「不要」「全部生成」「换模型」「返回修改」），
// 没有一颗是主动作。根因不是这四颗各自写错了，而是「什么时候该用文字、文字该怎么写」
// 这条规则从来没写下来，于是每个面自己发明一套措辞——同一个「取消」在三个面上分别叫
// 「不要」「算了」「取消」，用户每换一个面就得重新读一遍。
//
// 规则本体在 docs/design/nomi-design-system.md §1.8；动作规范词的 owner 是
// docs/GLOSSARY.md「动作词」表（改规范词只改那张表，本文件从表里读，不抄第二份）。
//
// 三条判据：
//   四 控件**可见文字** > 4 个字（英文 > 2 词）。可见文字 = 控件子树里作为 JSX 子节点渲染的
//     `t('key')`，以及非 icon 按钮的 `label=` / `children=`。`aria-label` / `title` /
//     `WorkbenchIconButton` 的 `label` 是 hover 名字（src/design/actions.tsx:150 把它落到
//     aria-label），按规则 1 本来就允许长，**刻意不量**——量它等于把正确写法判红。
//   五 标签含「请 / 我的 / 使用 / 一下 / 不要 / 不用 / 算了」。前四个是客服话术，
//     后三个是把否定动作写成口语（规则 4 要求否定动作收敛成统一样式）。
//   六 标签**整体**等于 GLOSSARY 某个规范词的替代说法（「确定」之于「确认」）。
//     用整体相等而不是包含：「确认删除这个项目」是一句完整的话，不是第二种说法。
//
// 诚实边界：只看走 i18n 的文案（硬编码中文由 check:i18n 拦，不重做）；
// 「一屏是不是只有一个主动作」「这个动作有没有公认图形」是构图与隐喻判断，任何 AST 都测不了。
//
// 棘轮：scripts/control-copy-baseline.json，只减不增。
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

import { i18nKeyOf, isControlTag, jsxAttrsOf, jsxTagOf } from './lib/jsxControls.mjs'

const require = createRequire(import.meta.url)
const ts = require('typescript')

/* ────────────────────────── 1. 词典：从 GLOSSARY 读规范动作词 ────────────────────────── */

/** 解析 docs/GLOSSARY.md 的「动作词」表：| 规范名 | 替代说法 | 英文 | 用在哪 |。 */
export function loadActionVocabulary(root) {
  const file = path.join(root, 'docs', 'GLOSSARY.md')
  if (!fs.existsSync(file)) return new Map()
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  const start = lines.findIndex((line) => /^#{2,3}\s.*动作词/u.test(line))
  if (start < 0) return new Map()
  const vocab = new Map()
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^#{1,3}\s/u.test(line)) break
    if (!line.trim().startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
    if (cells.length < 2) continue
    const canonical = cells[0].replace(/\*\*/g, '').trim()
    if (!canonical || /^-+$/.test(canonical) || canonical.includes('规范名')) continue
    vocab.set(canonical, cells[1]
      .split(/[·、,，/]/u)
      .map((word) => word.replace(/[`*]/g, '').trim())
      .filter((word) => word && word !== '—' && word !== '-'))
  }
  return vocab
}

/* ────────────────────────── 2. 词典：从 i18n 词条读标签真值 ────────────────────────── */

/**
 * 不执行、纯 AST 把 `src/i18n` 摊平成 key → {zh, en}。
 *
 * 为什么不 `import` 真词典：本门岗跑在 node 里（`check:controls` 是 `node scripts/…mjs`），
 * 真 import 需要 tsx，会把一条门岗拆成两个运行时。词条文件全是纯对象字面量，AST 读得准。
 */
function moduleOf(file, cache) {
  if (cache.has(file)) return cache.get(file)
  const result = { objects: new Map(), imports: new Map() }
  cache.set(file, result)
  if (!fs.existsSync(file)) return result
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  source.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const named = node.importClause?.namedBindings
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) result.imports.set(el.name.text, node.moduleSpecifier.text)
      }
      return
    }
    if (!ts.isVariableStatement(node)) return
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer) result.objects.set(decl.name.text, unwrap(decl.initializer))
    }
  })
  return result
}

/** 剥掉 `as const` / `satisfies X` / 括号，拿到真正的初始化表达式。 */
function unwrap(node) {
  let expr = node
  while (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isParenthesizedExpression(expr)) {
    expr = expr.expression
  }
  return expr
}

/** 把标识符解析成它指向的对象字面量（可能跨文件）。 */
function resolveIdentifier(name, file, cache) {
  const mod = moduleOf(file, cache)
  const local = mod.objects.get(name)
  if (local) return { node: local, file }
  const spec = mod.imports.get(name)
  if (!spec || !spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(file), spec)
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    const target = fs.existsSync(candidate) ? moduleOf(candidate, cache).objects.get(name) : null
    if (target) return { node: target, file: candidate }
  }
  return null
}

/** 深度优先摊平一个对象字面量。 */
function flatten(node, file, cache, prefix, out) {
  const expr = unwrap(node)
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    if (prefix) out.set(prefix, expr.text)
    return
  }
  if (ts.isIdentifier(expr)) {
    const resolved = resolveIdentifier(expr.text, file, cache)
    if (resolved) flatten(resolved.node, resolved.file, cache, prefix, out)
    return
  }
  if (!ts.isObjectLiteralExpression(expr)) return
  for (const prop of expr.properties) {
    if (ts.isSpreadAssignment(prop)) {
      flatten(prop.expression, file, cache, prefix, out)
      continue
    }
    if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue
    const nameNode = prop.name
    const key = ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) ? nameNode.text : null
    if (!key) continue
    const next = prefix ? `${prefix}.${key}` : key
    if (ts.isShorthandPropertyAssignment(prop)) {
      const resolved = resolveIdentifier(key, file, cache)
      if (resolved) flatten(resolved.node, resolved.file, cache, next, out)
      continue
    }
    flatten(prop.initializer, file, cache, next, out)
  }
}

/** key → { zh, en }。取不到的键不出现（动态 key、非字符串值）。 */
export function loadLocaleStrings(root) {
  const resources = path.join(root, 'src', 'i18n', 'resources.ts')
  const cache = new Map()
  const zh = new Map()
  const en = new Map()
  const mod = moduleOf(resources, cache)
  if (mod.objects.get('zhCN')) flatten(mod.objects.get('zhCN'), resources, cache, '', zh)
  if (mod.objects.get('en')) flatten(mod.objects.get('en'), resources, cache, '', en)
  const merged = new Map()
  for (const [key, value] of zh) merged.set(key, { zh: value, en: en.get(key) ?? null })
  return merged
}

/* ────────────────────────── 3. 扫描：控件上的可见文字与 hover 名字 ────────────────────────── */

/** 一棵表达式子树里所有 t('…') 的 key（三元的两个分支都算标签）。 */
function i18nKeysIn(node) {
  const keys = []
  const walk = (n) => {
    const key = i18nKeyOf(n)
    if (key) keys.push(key)
    n.forEachChild(walk)
  }
  if (node) walk(node)
  return keys
}

/**
 * 扫出 [{ key, where, kind }]。
 *   kind='label' —— 控件里**看得见**的文字；kind='name' —— hover 名字（aria-label / title）。
 */
export function scanControlCopy(root, files) {
  const found = []
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    if (!text.includes('t(') && !text.includes('desktopT(')) continue
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const rel = path.relative(root, file).split(path.sep).join('/')
    const at = (node) => `${rel}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`

    /** 控件的 JSX 子节点里的文字，不跨进嵌套控件（那颗有它自己的标签）。 */
    const collectChildLabels = (node) => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (isControlTag(jsxTagOf(node), jsxAttrsOf(node))) return
        if (ts.isJsxElement(node)) node.children.forEach(collectChildLabels)
        return
      }
      if (!ts.isJsxExpression(node) || !node.expression) return
      for (const key of i18nKeysIn(node.expression)) found.push({ key, where: at(node), kind: 'label' })
    }

    const visit = (node) => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = jsxTagOf(node)
        const attrs = jsxAttrsOf(node)
        if (isControlTag(tag, attrs)) {
          // `WorkbenchIconButton` 的 `label` 落到 aria-label/title——它是 hover 名字，
          // 不是可见文字；按可见文字量它会把「撤销时间轴编辑」这种**正确**写法判红。
          const iconOnly = /Icon(Button|Btn)$/i.test(tag)
          for (const attr of attrs.properties) {
            if (!ts.isJsxAttribute(attr) || !attr.initializer) continue
            const name = attr.name.getText()
            const expr = ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : null
            if (!expr) continue
            let kind = null
            if (name === 'aria-label' || name === 'ariaLabel' || name === 'title') kind = 'name'
            else if (name === 'label') kind = iconOnly ? 'name' : 'label'
            else if (name === 'children' || name === 'primaryLabel') kind = 'label'
            if (!kind) continue
            for (const key of i18nKeysIn(expr)) found.push({ key, where: at(attr), kind })
          }
          if (ts.isJsxElement(node)) node.children.forEach(collectChildLabels)
        }
      }
      node.forEachChild(visit)
    }
    visit(source)
  }
  return found
}

/* ────────────────────────── 4. 判据 ────────────────────────── */

/** 插值、省略号、首尾空白都不算「字」——它们不是用户要读的动作词。 */
const normalizeLabel = (value) =>
  String(value ?? '').replace(/\{\{[^}]*\}\}/g, '').replace(/[…·]/g, '').trim()

const CJK = /[㐀-鿿豈-﫿]/u

/** 中文按「字」数（一个汉字 1 字，一串连续的拉丁/数字算 1 字）；纯英文按词数。 */
export function labelWeight(value) {
  const label = normalizeLabel(value)
  if (!label) return 0
  if (!CJK.test(label)) return label.split(/\s+/).filter(Boolean).length
  let weight = 0
  let inLatin = false
  for (const ch of label) {
    if (CJK.test(ch)) { weight += 1; inLatin = false; continue }
    if (/[A-Za-z0-9]/.test(ch)) { if (!inLatin) { weight += 1; inLatin = true } continue }
    inLatin = false
  }
  return weight
}

export const MAX_LABEL_WEIGHT = 4
export const MAX_EN_LABEL_WORDS = 2

/** 客服话术词（前四）+ 口语否定词（后三，规则 4 要求否定动作收敛成统一样式）。 */
export const BANNED_WORDS = ['请', '我的', '使用', '一下', '不要', '不用', '算了']

/**
 * 不是「按钮标签」的那些文案，按**键名末段**排除：一颗按钮的子树里除了标签还常挂着
 * 说明、计数、状态、占位符，它们本来就该长，拿标签的尺子去量只会产出永远修不掉的基线。
 * 判据用键名而不是猜内容：`…Description` 是本仓词条已成型的命名约定
 * （src/i18n/locales/assetLibrary.ts:40），`check:i18n` 在属性名那侧用的是同一套词。
 */
const NON_LABEL_KEY_SUFFIX =
  /(hint|description|desc|summary|detail|details|message|placeholder|subtitle|caption|note|notes|help|status|tip|tips|error|empty|aria|title|name|untitled\w*)$/i

/** 一整句话不是按钮标签。**这不是逃生口**：一颗真按钮写不出逗号来。 */
const SENTENCE = /[，。；：、！？\n]|\.\s/u

/** 门岗只管**规范词已经进 GLOSSARY** 的那几组动作；没进表的动作不判。 */
export function copyOffenders({ root, files, vocabulary, strings }) {
  const vocab = vocabulary ?? loadActionVocabulary(root)
  const locale = strings ?? loadLocaleStrings(root)
  const alternates = new Map()
  for (const [canonical, words] of vocab) for (const word of words) alternates.set(word, canonical)

  const offenders = []
  const seen = new Set()
  for (const hit of scanControlCopy(root, files)) {
    const entry = locale.get(hit.key)
    if (!entry) continue
    const zh = normalizeLabel(entry.zh)
    if (!zh) continue
    if (NON_LABEL_KEY_SUFFIX.test(hit.key.split('.').pop() ?? '')) continue
    if (SENTENCE.test(zh)) continue

    const push = (rule, detail) => {
      const id = `${rule} | ${hit.key} | ${detail}`
      if (seen.has(id)) return
      seen.add(id)
      offenders.push({ rule, key: hit.key, kind: hit.kind, where: hit.where, zh, detail, id })
    }

    if (hit.kind === 'label') {
      const weight = labelWeight(entry.zh)
      if (weight > MAX_LABEL_WEIGHT) push('long', `「${zh}」${weight} 字 > ${MAX_LABEL_WEIGHT}`)
      const en = normalizeLabel(entry.en)
      const words = en ? en.split(/\s+/).filter(Boolean).length : 0
      if (words > MAX_EN_LABEL_WORDS) push('long-en', `"${en}" ${words} 词 > ${MAX_EN_LABEL_WORDS}`)
    }

    const banned = BANNED_WORDS.filter((word) => zh.includes(word))
    if (banned.length > 0) push('banned', `「${zh}」含禁用词 ${banned.join('、')}`)

    const canonical = alternates.get(zh)
    if (canonical) push('synonym', `「${zh}」是「${canonical}」的第二种说法`)
  }
  return offenders.sort((a, b) => a.id.localeCompare(b.id))
}
