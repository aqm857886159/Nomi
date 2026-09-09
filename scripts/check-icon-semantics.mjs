#!/usr/bin/env node
/**
 * check:icon-semantics —— 「一个动作只能有一个图标」门岗（§1.5.2「一功能一个家」的图标实例）。
 *
 * 为什么要有它：用户长期反馈「icon 和用户心智不一致」。设计系统 §6 只管**形制**
 * （唯一库 / size / stroke），语义那一半靠一张 3 行的登记表和自觉——自觉记不住，
 * 于是同一个动作在不同界面长出不同图标，用户每换一个面就得重新学一遍。
 *
 * 判据（**只查能确证的那部分**，不猜）：
 *   把「动作」定义为 **i18n key**（`aria-label={t('assetLibrary.pasteLink.button')}` 里那个 key），
 *   把「图标」定义为该按钮子树里渲染的 `@tabler/icons-react` 组件名。
 *   同一个 i18n key 在全仓被配了 **≥2 个不同图标** = 红。
 *
 * 为什么用 i18n key 当动作身份：它是全仓唯一、已被 check:i18n 强制存在的稳定标识；
 * 用文案字面会被翻译/改写带偏，用组件名会把「同一动作的两处实现」当成两个动作。
 *
 * 三条刻意的排除（都是「长得像漂移、其实不是」，误报会让门岗变噪音）：
 *   · **动作身份只从真实控件上取**（button / a / onClick / *Button 组件）。容器 `<div aria-label>`
 *     不算——否则一个带 aria-label 的列表会把它里面所有图标都算成「同一动作的多个图标」。
 *   · **状态切换不算漂移**：`{busy ? <IconLoader2/> : <IconDownload/>}` 是同一按钮的两个态。
 *     判据 = 两个图标同处一个三元表达式内。
 *   · **装饰/示能图标不算语义**：Chevron / Caret / Selector / Loader 表达的是「可展开」「加载中」
 *     这类结构示能，一个按钮同时有语义图标 + chevron 是正常的。
 *
 * 查不到的（诚实边界，别当它查了）：
 *   · 没有 aria-label/title 的纯图标按钮 —— 无从判定它表示哪个动作；
 *   · 图标隐喻对不对（`IconTrash` 用来表示「归档」这种）—— 那是**盲测**，人工，不可机器化。
 *
 * 棘轮：`scripts/icon-semantics-baseline.json` 记录存量冲突，**只减不增**。
 *   `--update-baseline` 重拍快照（只在真的清掉了冲突之后用）。
 *   `--report` 只列出全部 动作→图标 映射，不判红。
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const SCAN_ROOTS = ['src', 'electron']
const BASELINE_FILE = path.join(ROOT, 'scripts', 'icon-semantics-baseline.json')

const EXCLUDED_PREFIXES = [
  'src/devlab/', // 设计实验室：刻意并列多种画法做对照，不是产品界面
  'src/design/', // 组件库自身的 demo/默认值
]

/** 收集一个目录下所有 .tsx（图标只出现在 JSX 里）。 */
function collectFiles(dir, root, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      collectFiles(full, root, out)
      continue
    }
    if (!entry.name.endsWith('.tsx')) continue
    if (entry.name.endsWith('.test.tsx')) continue
    const rel = path.relative(root, full).split(path.sep).join('/')
    if (EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue
    out.push(full)
  }
  return out
}

/**
 * 装饰/示能图标：表达结构（可展开、加载中、可选择），不表达语义动作。
 * 一个按钮同时挂语义图标 + chevron 是正常写法，不该判成「一个动作两个图标」。
 */
const AFFORDANCE_ICON = /^Icon(Chevron|Caret|Selector|Loader|ArrowsSort|Point)/

/**
 * 这个 JSX 标签是不是一个真实控件（动作身份只能挂在控件上，不能挂在容器上）。
 *
 * ⚠️ 刻意**不**把「有 onClick」当控件：`role="dialog"` 的弹层容器普遍写
 * `onClick={(e) => e.stopPropagation()}`，一旦算它，容器的 aria-label 会被安到里面
 * 所有图标头上（实测 TimelineTransitionPicker 因此假红）。要判就判可访问性角色。
 */
function isControlTag(tagName, attrs) {
  if (tagName === 'button' || tagName === 'a') return true
  if (/(Button|IconBtn|Btn|MenuItem|Tab)$/.test(tagName)) return true
  if (!attrs) return false
  return attrs.properties.some((attr) => {
    if (!ts.isJsxAttribute(attr) || attr.name.getText() !== 'role' || !attr.initializer) return false
    return ts.isStringLiteral(attr.initializer) && attr.initializer.text === 'button'
  })
}

/** `t('a.b.c')` / `t('a.b', {..})` → 'a.b.c'；不是这个形状就返回 null。 */
function i18nKeyOf(node) {
  let expr = node
  if (ts.isJsxExpression(expr)) expr = expr.expression
  if (!expr) return null
  // 三元里取不到唯一 key（`cond ? t(a) : t(b)`）——那是状态切换，跳过。
  if (!ts.isCallExpression(expr)) return null
  const callee = expr.expression
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
  if (name !== 't' && name !== 'desktopT') return null
  const first = expr.arguments[0]
  if (!first || !ts.isStringLiteral(first)) return null
  return first.text
}

/** 这个 JSX 元素上的动作身份（aria-label 优先，其次 title）。 */
function actionKeyOf(element) {
  const attrs = ts.isJsxSelfClosingElement(element) ? element.attributes : element.openingElement?.attributes
  if (!attrs) return null
  const tag = ts.isJsxSelfClosingElement(element) ? element.tagName.getText() : element.openingElement.tagName.getText()
  if (!isControlTag(tag, attrs)) return null
  let fallback = null
  for (const attr of attrs.properties) {
    if (!ts.isJsxAttribute(attr) || !attr.initializer) continue
    const attrName = attr.name.getText()
    if (attrName === 'aria-label' || attrName === 'ariaLabel') {
      const key = i18nKeyOf(attr.initializer)
      if (key) return key
    } else if (attrName === 'title') {
      const key = i18nKeyOf(attr.initializer)
      if (key) fallback = key
    }
  }
  return fallback
}

/**
 * 扫出全仓的「动作 → 图标」映射。
 * @returns Map<actionKey, Map<iconName, {sites:Set<string>, ternaries:Set<string>}>>
 */
export function scanIconSemantics(root = ROOT, scanRoots = SCAN_ROOTS) {
  const pairs = new Map()
  for (const scanRoot of scanRoots) {
  for (const file of collectFiles(path.join(root, scanRoot), root)) {
    const text = fs.readFileSync(file, 'utf8')
    if (!text.includes('@tabler/icons-react')) continue
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

    // 本文件从 @tabler/icons-react 引进来的图标名。
    const tablerIcons = new Set()
    source.forEachChild((node) => {
      if (!ts.isImportDeclaration(node)) return
      if (!ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== '@tabler/icons-react') return
      const named = node.importClause?.namedBindings
      if (named && ts.isNamedImports(named)) for (const el of named.elements) tablerIcons.add(el.name.text)
    })
    if (tablerIcons.size === 0) continue

    const rel = path.relative(root, file).split(path.sep).join('/')

    // 自顶向下走，维护「当前最近的带动作身份的祖先」。
    const visit = (node, currentAction) => {
      let action = currentAction
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const own = actionKeyOf(node)
        if (own) action = own
        const tag = ts.isJsxSelfClosingElement(node) ? node.tagName.getText() : node.openingElement.tagName.getText()
        if (tablerIcons.has(tag) && action && !AFFORDANCE_ICON.test(tag)) {
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
          // 同一个三元表达式里的两个图标 = 同一按钮的两个态，折叠成一条（用三元节点位置当组 id）。
          let ternary = null
          for (let p = node.parent; p; p = p.parent) {
            if (ts.isConditionalExpression(p)) { ternary = `${rel}#${p.getStart()}`; break }
            if (ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p)) {
              const ptag = ts.isJsxSelfClosingElement(p) ? p.tagName.getText() : p.openingElement.tagName.getText()
              if (isControlTag(ptag, ts.isJsxSelfClosingElement(p) ? p.attributes : p.openingElement.attributes)) break
            }
          }
          if (!pairs.has(action)) pairs.set(action, new Map())
          const byIcon = pairs.get(action)
          if (!byIcon.has(tag)) byIcon.set(tag, { sites: new Set(), ternaries: new Set() })
          byIcon.get(tag).sites.add(`${rel}:${line}`)
          if (ternary) byIcon.get(tag).ternaries.add(ternary)
        }
      }
      node.forEachChild((child) => visit(child, action))
    }
    visit(source, null)
  }
  }
  return pairs
}

/** 冲突 = 同一动作被配了 ≥2 个不同图标（已折叠状态切换）。 */
export function findConflicts(pairs) {
  const conflicts = []
  for (const [action, byIcon] of [...pairs].sort(([a], [b]) => a.localeCompare(b))) {
    if (byIcon.size < 2) continue
    // 若所有图标都落在同一个三元表达式里 = 同一按钮的多个状态，不是漂移。
    const allTernaries = new Set()
    let everyIconInTernary = true
    for (const info of byIcon.values()) {
      if (info.ternaries.size === 0) { everyIconInTernary = false; break }
      for (const t of info.ternaries) allTernaries.add(t)
    }
    if (everyIconInTernary && allTernaries.size === 1) continue
    const icons = [...byIcon.keys()].sort()
    conflicts.push({
      action,
      icons,
      sites: icons.map((i) => `${i} @ ${[...byIcon.get(i).sites].sort().join(', ')}`),
    })
  }
  return conflicts
}

/** 冲突的稳定身份（进基线的那一行）。 */
export const conflictId = (c) => `${c.action} → ${c.icons.join('/')}`

function main() {
const REPORT = process.argv.includes('--report')
const UPDATE_BASELINE = process.argv.includes('--update-baseline')
const pairs = scanIconSemantics()
const conflicts = findConflicts(pairs)

if (REPORT) {
  console.log(`扫到 ${pairs.size} 个「动作 → 图标」映射；冲突 ${conflicts.length} 个。`)
  for (const c of conflicts) {
    console.log(`\n  ✗ ${c.action} → ${c.icons.join(' / ')}`)
    for (const s of c.sites) console.log(`      ${s}`)
  }
  process.exit(0)
}

const conflictIds = conflicts.map(conflictId).sort()

if (UPDATE_BASELINE) {
  fs.writeFileSync(
    BASELINE_FILE,
    `${JSON.stringify({ note: '同一动作配了多个图标的存量冲突；棘轮只减不增。清掉后跑 --update-baseline 重拍。', conflicts: conflictIds }, null, 2)}\n`,
  )
  console.log(`✅ 基线已重拍：${conflictIds.length} 个存量冲突。`)
  process.exit(0)
}

const baseline = fs.existsSync(BASELINE_FILE)
  ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')).conflicts ?? []
  : []
const baselineSet = new Set(baseline)
const added = conflictIds.filter((id) => !baselineSet.has(id))
const removed = baseline.filter((id) => !conflictIds.includes(id))

if (added.length > 0) {
  console.error(`❌ check:icon-semantics —— 新增 ${added.length} 个「一个动作两个图标」冲突：\n`)
  for (const id of added) {
    const c = conflicts.find((x) => conflictId(x) === id)
    console.error(`  ✗ ${id}`)
    for (const s of c.sites) console.error(`      ${s}`)
  }
  console.error(`
同一个动作在全仓只能有一个图标（设计系统 §1.5.2「一功能一个家」的图标实例）。
修法：挑定一个图标，其余改成它；并登记进 docs/design/nomi-design-system.md §6「语义图标登记」。
（存量 ${baseline.length} 个已在基线里，棘轮只减不增；真清掉了跑 --update-baseline。）`)
  process.exit(1)
}

if (removed.length > 0) {
  console.log(`✅ check:icon-semantics 通过；顺带清掉了 ${removed.length} 个存量冲突 —— 跑 --update-baseline 把基线降下来。`)
} else {
  console.log(`✅ check:icon-semantics 通过（${pairs.size} 个动作→图标映射，存量冲突 ${conflictIds.length}）。`)
}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
