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
 * 规则二（2026-09-10 加）：**图标词典登记**（设计系统 §1.8 规则 5「一个 icon 全 app 一个含义；
 * 新 icon 先证明词典没有现成的再登记」）。判据：全仓用到的 Tabler 图标构成「词典」，
 * 存量进基线的 `dictionary` 数组；**新图标只有先登记进 §6「语义图标登记」表才放行**，
 * 否则红。它守的不是「这个图标好不好看」，而是**加图标这一步必须经过一次「词典里有没有现成的」**——
 * 靠自觉记不住，于是同一个「关闭」长出 IconX / IconSquareX / IconCircleX 三种画法。
 *
 * 规则二刻意**不**做的两件事（不是漏，是边界）：
 *   · 不反过来查「一个图标被用在几个动作上」：`IconX` 天然要关掉弹窗、面板、预览、chip，
 *     那不是漂移；硬做会产生几百条永远修不掉的基线，然后没人再看这道门岗。
 *   · 不查图标隐喻对不对 —— 那是 §6 的盲测，人工。
 *
 * 棘轮：`scripts/icon-semantics-baseline.json` 记录存量冲突（`conflicts`）与存量词典（`dictionary`），**只减不增**。
 *   `--update-baseline` 重拍快照（只在真的清掉了冲突之后用）。
 *   `--report` 只列出全部 动作→图标 映射，不判红。
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

import { pathToFileURL } from 'node:url'

import { i18nKeyOf, isControlTag, jsxAttrsOf, jsxTagOf } from './lib/jsxControls.mjs'

const ROOT = process.cwd()
const SCAN_ROOTS = ['src', 'electron']
const BASELINE_FILE = path.join(ROOT, 'scripts', 'icon-semantics-baseline.json')

const EXCLUDED_PREFIXES = [
  'src/devlab/', // 设计实验室：刻意并列多种画法做对照，不是产品界面
  'src/design/', // 组件库自身的 demo/默认值
]

/** 收集一个目录下所有 .tsx（图标只出现在 JSX 里）。 */
function collectFiles(dir, root, out = [], excluded = EXCLUDED_PREFIXES) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      collectFiles(full, root, out, excluded)
      continue
    }
    if (!entry.name.endsWith('.tsx')) continue
    if (entry.name.endsWith('.test.tsx')) continue
    const rel = path.relative(root, full).split(path.sep).join('/')
    if (excluded.some((p) => rel.startsWith(p))) continue
    out.push(full)
  }
  return out
}

/**
 * 装饰/示能图标：表达结构（可展开、加载中、可选择），不表达语义动作。
 * 一个按钮同时挂语义图标 + chevron 是正常写法，不该判成「一个动作两个图标」。
 */
const AFFORDANCE_ICON = /^Icon(Chevron|Caret|Selector|Loader|ArrowsSort|Point)/

/** 这个 JSX 元素上的动作身份（aria-label 优先，其次 title）。 */
function actionKeyOf(element) {
  const attrs = jsxAttrsOf(element)
  if (!attrs) return null
  if (!isControlTag(jsxTagOf(element), attrs)) return null
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
        const tag = jsxTagOf(node)
        if (tablerIcons.has(tag) && action && !AFFORDANCE_ICON.test(tag)) {
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
          // 同一个三元表达式里的两个图标 = 同一按钮的两个态，折叠成一条（用三元节点位置当组 id）。
          let ternary = null
          for (let p = node.parent; p; p = p.parent) {
            if (ts.isConditionalExpression(p)) { ternary = `${rel}#${p.getStart()}`; break }
            if (ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p)) {
              if (isControlTag(jsxTagOf(p), jsxAttrsOf(p))) break
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

/* ───────────────────────── 规则二：图标词典登记 ───────────────────────── */

/**
 * 词典扫描范围比语义扫描宽一点：`src/design/` 组件库里的图标一样会出现在产品界面上，
 * 属于词典的一部分；只有设计实验室（刻意并列多种画法做对照）不算。
 */
const DICTIONARY_EXCLUDED_PREFIXES = ['src/devlab/']

/** 全仓从 `@tabler/icons-react` 引进来的图标名 → 出现位置。 */
export function scanIconDictionary(root = ROOT, scanRoots = SCAN_ROOTS) {
  const dictionary = new Map()
  for (const scanRoot of scanRoots) {
    for (const file of collectFiles(path.join(root, scanRoot), root, [], DICTIONARY_EXCLUDED_PREFIXES)) {
      const text = fs.readFileSync(file, 'utf8')
      if (!text.includes('@tabler/icons-react')) continue
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const rel = path.relative(root, file).split(path.sep).join('/')
      source.forEachChild((node) => {
        if (!ts.isImportDeclaration(node)) return
        if (!ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== '@tabler/icons-react') return
        // `import type { Icon }` 引的是类型（图标组件的 props 签名），不是词典里的一个词。
        if (node.importClause?.isTypeOnly) return
        const named = node.importClause?.namedBindings
        if (!named || !ts.isNamedImports(named)) return
        for (const el of named.elements) {
          if (el.isTypeOnly) continue
          if (el.name.text === 'Icon') continue // 同上：`Icon` 是类型名，不是图标
          const line = source.getLineAndCharacterOfPosition(el.getStart()).line + 1
          if (!dictionary.has(el.name.text)) dictionary.set(el.name.text, new Set())
          dictionary.get(el.name.text).add(`${rel}:${line}`)
        }
      })
    }
  }
  return dictionary
}

/**
 * 设计系统 §6「语义图标登记」表里登记过的图标 —— 这是**新图标唯一的入口**。
 * 让文档当 owner 而不是让基线当 owner：往基线里加一行是无声的，往 §6 表里加一行要写清
 * 「这个语义是什么、用在哪」，那一步才是规则真正要的那次思考。
 */
export function loadRegisteredIcons(root = ROOT) {
  const file = path.join(root, 'docs', 'design', 'nomi-design-system.md')
  if (!fs.existsSync(file)) return new Set()
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  const start = lines.findIndex((line) => /^#{2,4}\s.*语义图标登记/u.test(line))
  if (start < 0) return new Set()
  const registered = new Set()
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,3}\s/u.test(lines[i])) break
    for (const match of lines[i].matchAll(/`(Icon[A-Za-z0-9]+)`/g)) registered.add(match[1])
  }
  return registered
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
const dictionary = scanIconDictionary()
const registered = loadRegisteredIcons()
const icons = [...dictionary.keys()].sort()

if (REPORT) {
  console.log(`扫到 ${pairs.size} 个「动作 → 图标」映射；冲突 ${conflicts.length} 个。`)
  for (const c of conflicts) {
    console.log(`\n  ✗ ${c.action} → ${c.icons.join(' / ')}`)
    for (const s of c.sites) console.log(`      ${s}`)
  }
  console.log(`\n词典：${icons.length} 个图标在用，§6 登记 ${registered.size} 个。`)
  process.exit(0)
}

const conflictIds = conflicts.map(conflictId).sort()

const savedRaw = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : {}

if (UPDATE_BASELINE) {
  fs.writeFileSync(
    BASELINE_FILE,
    `${JSON.stringify({
      note: '同一动作配了多个图标的存量冲突；棘轮只减不增。清掉后跑 --update-baseline 重拍。',
      dictionaryNote:
        'dictionary = 立项时全仓在用的 Tabler 图标词典（设计系统 §1.8 规则 5）。新图标不许往这里加，'
        + '要先登记进 docs/design/nomi-design-system.md §6「语义图标登记」表；不再用的图标从这里删。',
      conflicts: conflictIds,
      dictionary: icons,
    }, null, 2)}\n`,
  )
  console.log(`✅ 基线已重拍：${conflictIds.length} 个存量冲突，词典 ${icons.length} 个图标。`)
  process.exit(0)
}

const baseline = savedRaw.conflicts ?? []
const baselineSet = new Set(baseline)
const dictionaryBaseline = savedRaw.dictionary ?? []
const knownIcons = new Set([...dictionaryBaseline, ...registered])
const unregistered = icons.filter((icon) => !knownIcons.has(icon))
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

if (unregistered.length > 0) {
  console.error(`❌ check:icon-semantics —— ${unregistered.length} 个图标不在词典里：\n`)
  for (const icon of unregistered) {
    console.error(`  ✗ ${icon}`)
    for (const site of [...dictionary.get(icon)].sort()) console.error(`      ${site}`)
  }
  console.error(`
设计系统 §1.8 规则 5：一个 icon 全 app 一个含义；**新 icon 先证明词典里没有现成的再登记**。
修法二选一：
  ① 词典里已有能表达这个语义的图标 → 改用它（词典 ${dictionaryBaseline.length} 个，跑 --report 看全表）；
  ② 确实是新语义 → 在 docs/design/nomi-design-system.md §6「语义图标登记」表里加一行
     （语义 / 图标 / 用在哪），门岗读那张表放行。**别往基线的 dictionary 数组里加**——
     那一步是无声的，而 §6 那一行才是规则真正要的那次「词典里有没有现成的」思考。`)
  process.exit(1)
}

const retired = dictionaryBaseline.filter((icon) => !dictionary.has(icon))
if (removed.length > 0) {
  console.log(`✅ check:icon-semantics 通过；顺带清掉了 ${removed.length} 个存量冲突 —— 跑 --update-baseline 把基线降下来。`)
} else {
  console.log(
    `✅ check:icon-semantics 通过（${pairs.size} 个动作→图标映射，存量冲突 ${conflictIds.length}；`
    + `词典 ${icons.length} 个图标，§6 登记 ${registered.size} 个${retired.length > 0 ? `，${retired.length} 个已停用可从基线删` : ''}）。`,
  )
}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
