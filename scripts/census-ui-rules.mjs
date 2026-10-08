#!/usr/bin/env node
// UI 基本规则普查（2026-10-07，只读，不接门岗）。
//
// 规则正本：docs/research/2026-10-07-ui-basic-rules.md（UI-R01…）。这里只负责「静态能数出来的那一半」：
// 扫 src/ 下的生产 tsx/ts + i18n 文案，按规则吐违例清单（文件:行号）。
// DOM 那一半（对比度 / 点击目标 / 焦点环 / 同标签不同样式…）在 tests/ux/ui-rules-census.dom.mjs。
//
// 判据都是**启发式**：宁可多报让人复核，也不静默漏掉；每条规则头注写了它会误报什么、漏什么。
// 它不判罪、不改文件、不进 gates。门岗化是下一阶段（先把误报压下来再说）。
//
// 解析方式与 census-silent-branches / check-control-contract 同源：仓里已有的 typescript 编译器 API。
//
// 用法：
//   node scripts/census-ui-rules.mjs                 汇总表
//   node scripts/census-ui-rules.mjs --list UI-R04   列出某条规则的全部违例 file:line
//   node scripts/census-ui-rules.mjs --json out.json 机读全量
//   node scripts/census-ui-rules.mjs --include-devlab  连设计实验室夹具一起扫（默认不扫）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null }
const LIST = argValue('--list')
const BY_COMPONENT = args.includes('--by-component')
const COMPONENT = argValue('--component')
const JSON_OUT = argValue('--json')
const INCLUDE_DEVLAB = args.includes('--include-devlab')

// ---------------------------------------------------------------------------
// 规则登记（id → 一句话）。编号与研究文档一一对应。
// ---------------------------------------------------------------------------
export const RULES = {
  'UI-R01': '决定栏：主动作在最右，取消在它左边',
  'UI-R02': '「取消」只有一种说法（取消 / Cancel）',
  'UI-R03': '动作条：删除类固定最右（它后面不再跟别的按钮）',
  'UI-R04': '✓ 只表示状态，不当动作按钮',
  'UI-R05': '禁用原生 window.confirm / alert / prompt',
  'UI-R06': '禁用的按钮要说明为什么（title / 就近说明）',
  'UI-R07': '纯图标按钮必须有可读名字（aria-label / title / label）',
  'UI-R08': '能点的东西键盘必须到得了（div/span 不能裸挂 onClick）',
  'UI-R09': '不许摘掉焦点环（outline-none 且没有替代 focus-visible 样式）',
  'UI-R10': '点击目标不小于 24×24 CSS px（候选：className 里写死了更小的尺寸）',
  'UI-R11': '同类控件一个组件（散装 <button> / <select> / checkbox / radio）',
  'UI-R12': 'z-index 只走 NOMI_OVERLAY_Z_INDEX，不写魔法数',
  'UI-R13': '间距只走 4 的倍数 token（arbitrary 值里不是 4 的倍数的）',
  'UI-R14': '字号只走 token（text-[Npx] / leading-[…]）',
  'UI-R15': '颜色只走 token（写死的 #hex / rgb）',
  'UI-R16': '被截断的文字要能看到全文（truncate / line-clamp 没配 title）',
  'UI-R17': '图片要有 alt',
  'UI-R18': '对话框要有名字（role=dialog 配 aria-label / aria-labelledby）',
  'UI-R19': '同一语义一个图标（更多 / 关闭 / 删除 / 添加 / 设置 / 复制 / 编辑 / 刷新）',
  'UI-R20': '文案：省略号用「…」不用「...」；按钮式短句不带句末标点',
  'UI-R21': '文案：中英 / 数字之间的空格要一致',
  'UI-R22': '文案：英文短标签大小写要一致（句首大写，不要 Title Case）',
  'UI-R26': '主动作写具体动词，不写「确认 / 确定 / OK」',
  'UI-R32': '图标在文字左边（同类按钮位置一致；右边只留 chevron / 箭头 / 外链这类结构图标）',
  'UI-R33': '图标尺寸 / 描边走登记档位（不写 17、15 这种；不用 strokeWidth）',
  'UI-R34': '按钮不自己覆写尺寸（h- / px- / rounded- 走 variant + size，不在 className 里另起一套）',
  'UI-R35': '自己画的按钮要有悬停态（hover:）',
}
// 不在本脚本里的规则（DOM 普查或只能人工）：UI-R23 对比度 · UI-R24 小字 · UI-R25 弹层压住触发钮 ·
// UI-R27 一屏一个主动作 · UI-R28 破坏性操作先撤销后确认 · UI-R29 Esc / 回车 / Tab 顺序 · UI-R30 忙态与结果反馈 · UI-R31 空状态有下一步。

const hits = Object.fromEntries(Object.keys(RULES).map((id) => [id, []]))
const stats = {}
function hit(rule, file, line, detail) { hits[rule].push({ file, line, detail }) }

// ---------------------------------------------------------------------------
// 文件收集
// ---------------------------------------------------------------------------
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const rel = path.relative(ROOT, full).split(path.sep).join('/')
    if (entry.isDirectory()) {
      if (/(^|\/)(node_modules|__fixtures__|__mocks__|vendor)$/.test(rel)) continue
      if (!INCLUDE_DEVLAB && rel === 'src/devlab') continue
      walk(full, out)
    } else if (/\.(tsx|ts)$/.test(entry.name) && !/\.(test|spec|node-test|walk|d)\.(tsx|ts)$/.test(entry.name)) {
      out.push(rel)
    }
  }
  return out
}
const files = walk(path.join(ROOT, 'src'))
const tsxFiles = files.filter((f) => f.endsWith('.tsx'))

// ---------------------------------------------------------------------------
// AST 小工具
// ---------------------------------------------------------------------------
const BUTTON_TAGS = new Set(['button', 'WorkbenchButton', 'DesignButton', 'Button', 'ActionIcon', 'IconActionButton', 'WorkbenchIconButton'])
const ICON_ONLY_TAGS = new Set(['IconActionButton', 'WorkbenchIconButton', 'ActionIcon'])
const CHECK_ICONS = new Set(['IconCheck', 'IconCircleCheck', 'IconCircleCheckFilled', 'IconSquareCheck', 'IconSquareCheckFilled', 'IconSquareRoundedCheck', 'IconSquareRoundedCheckFilled', 'IconChecks'])

const tagOf = (node) => {
  const opening = ts.isJsxElement(node) ? node.openingElement : node
  return opening.tagName.getText()
}
const openingOf = (node) => (ts.isJsxElement(node) ? node.openingElement : node)
const isJsx = (node) => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)
function attrOf(node, name) {
  for (const attr of openingOf(node).attributes.properties) {
    if (ts.isJsxAttribute(attr) && attr.name.getText() === name) return attr
  }
  return null
}
function attrStringValue(node, name) {
  const attr = attrOf(node, name)
  if (!attr) return null
  const init = attr.initializer
  if (!init) return ''
  if (ts.isStringLiteral(init)) return init.text
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text
    return `{${e.getText().slice(0, 60)}}`
  }
  return null
}
const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1

/** 一个控件「说了什么」：可见文字 + i18n key + aria-label/title + 点击处理函数名。 */
function describe(node) {
  const texts = []
  const keys = []
  const visit = (n) => {
    if (ts.isJsxText(n)) { const s = n.text.trim(); if (s) texts.push(s) }
    if (ts.isCallExpression(n) && /^(t|i18n\.t)$/.test(n.expression.getText()) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) keys.push(n.arguments[0].text)
    if (ts.isJsxAttribute(n) && ['aria-label', 'title', 'label'].includes(n.name.getText()) && n.initializer && ts.isStringLiteral(n.initializer)) texts.push(n.initializer.text)
    ts.forEachChild(n, visit)
  }
  visit(node)
  const onClick = attrOf(node, 'onClick')
  const handler = onClick?.initializer && ts.isJsxExpression(onClick.initializer) && onClick.initializer.expression
    ? onClick.initializer.expression.getText().slice(0, 80) : ''
  return { texts, keys, handler, blob: [...texts, ...keys, handler].join(' ') }
}

const RE_CANCEL = /cancel|dismiss|decline|取消|不要|算了|放弃|notnow|not now|不用/i
const RE_PRIMARY = /confirm|submit|save|apply|accept|\bok\b|done|create|generate|continue|确认|确定|保存|应用|完成|创建|生成|继续/i
const RE_DELETE = /delete|remove|discard|trash|删除|移除/i

/** 把一个元素的 children 展开成「按钮序列」（穿过 {cond && <X/>} / {a ? <X/> : <Y/>}）。 */
function buttonChildren(node) {
  const out = []
  const push = (n) => {
    if (!n) return
    if (isJsx(n) && BUTTON_TAGS.has(tagOf(n))) out.push(n)
    else if (ts.isJsxExpression(n) && n.expression) push(n.expression)
    else if (ts.isParenthesizedExpression(n)) push(n.expression)
    else if (ts.isConditionalExpression(n)) { push(n.whenTrue); push(n.whenFalse) }
    else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) push(n.right)
  }
  if (ts.isJsxElement(node)) node.children.forEach(push)
  return out
}

function isConditionalAncestor(node, stopAt) {
  for (let p = node.parent; p && p !== stopAt; p = p.parent) {
    if (ts.isConditionalExpression(p)) return true
    if (ts.isBinaryExpression(p) && (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || p.operatorToken.kind === ts.SyntaxKind.BarBarToken)) return true
  }
  return false
}

const classStrings = (sf) => {
  // 所有字符串字面量里长得像 className 的（含 cn(...) 参数 / 模板字符串）
  const out = []
  const visit = (n) => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text.length > 2) out.push({ text: n.text, node: n })
    else if (ts.isTemplateExpression(n)) { out.push({ text: n.head.text + n.templateSpans.map((s) => s.literal.text).join(' '), node: n }) }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

function classNameOf(node) {
  const attr = attrOf(node, 'className')
  if (!attr?.initializer) return ''
  return attr.initializer.getText()
}

// ---------------------------------------------------------------------------
// 逐文件扫 tsx
// ---------------------------------------------------------------------------
const isDesignFile = (rel) => rel.startsWith('src/design/')
const orderStats = { correct: 0, wrong: 0, pairs: 0 }
const rawControl = { button: {}, select: {}, checkbox: {}, radio: {}, range: {} }
const iconUse = {}
const r26Pending = []
const iconSizeUse = {}
const iconStrokeUse = {}

const ICON_FAMILIES = {
  more: ['IconDots', 'IconDotsVertical', 'IconDotsCircleHorizontal', 'IconMenu2'],
  close: ['IconX', 'IconXboxX', 'IconCircleX', 'IconSquareX', 'IconSquareRoundedX'],
  delete: ['IconTrash', 'IconTrashX', 'IconTrashFilled', 'IconEraser'],
  add: ['IconPlus', 'IconCirclePlus', 'IconSquarePlus', 'IconSquareRoundedPlus'],
  settings: ['IconSettings', 'IconSettings2', 'IconSettingsFilled'], // 滑杆类（IconAdjustments*）是「参数调节」另一个语义，不并入
  copy: ['IconCopy', 'IconClipboard', 'IconClipboardCopy', 'IconCopyCheck'],
  edit: ['IconPencil', 'IconEdit', 'IconPencilMinus', 'IconWriting'],
  refresh: ['IconRefresh', 'IconReload', 'IconRepeat'], // IconRotate* 是「旋转」不是刷新
  download: ['IconDownload', 'IconFileDownload', 'IconCloudDownload'],
  favorite: ['IconStar', 'IconHeart', 'IconBookmark', 'IconPin'], // *Filled 是同一图标的「已选中」态，按同一个算
}
const ICON_TO_FAMILY = new Map(Object.entries(ICON_FAMILIES).flatMap(([fam, list]) => list.map((i) => [i, fam])))
const ICON_CANON = (name) => name.replace(/Filled$/, '')

for (const rel of tsxFiles) {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  const visit = (node) => {
    // ---- UI-R05 原生对话框
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText()
      if (/^(window\.)?(confirm|alert|prompt)$/.test(callee) && !isDesignFile(rel)) {
        hit('UI-R05', rel, lineOf(sf, node), callee + '(…)')
      }
    }

    if (isJsx(node)) {
      const tag = tagOf(node)

      // ---- UI-R01 / R03 决定栏顺序、删除位置：看一个容器里按钮的先后
      if (ts.isJsxElement(node)) {
        const btns = buttonChildren(node)
        if (btns.length >= 2) {
          const info = btns.map((b) => {
            const d = describe(b)
            const variant = attrStringValue(b, 'variant')
            const isCancel = RE_CANCEL.test(d.blob) && !RE_DELETE.test(d.keys.join(' ')) && !/production\.control/.test(d.blob)
            const isPrimary = !isCancel && (variant === 'primary' || RE_PRIMARY.test(d.blob))
            const isDelete = !isCancel && RE_DELETE.test(d.blob + ' ' + b.getText().match(/IconTrash\w*/)?.[0])
            return { node: b, isCancel, isPrimary, isDelete, blob: d.blob.slice(0, 50) }
          })
          info.forEach((a, i) => info.forEach((b, j) => {
            if (a.isPrimary && b.isCancel && i !== j) {
              orderStats.pairs += 1
              if (j > i) { orderStats.wrong += 1; hit('UI-R01', rel, lineOf(sf, b.node), `取消(${b.blob}) 在主动作(${a.blob}) 右边`) }
              else orderStats.correct += 1
            }
          }))
          // 按「弹性间隔」切段：删除住在自己那一段的最左（决定栏 leading）或最右（动作条）都行，夹在中间才算
          const segOf = new Map()
          let seg = 0
          const flat = []
          const walkKids = (n) => {
            if (isJsx(n) && BUTTON_TAGS.has(tagOf(n))) { segOf.set(n, seg); flat.push(n) }
            else if (isJsx(n) && /flex-1|\bgrow\b|ml-auto|mr-auto|justify-between/.test(classNameOf(n)) && !(ts.isJsxElement(n) && n.children.some((c) => isJsx(c) && BUTTON_TAGS.has(tagOf(c))))) seg += 1
            else if (ts.isJsxExpression(n) && n.expression) walkKids(n.expression)
            else if (ts.isParenthesizedExpression(n)) walkKids(n.expression)
            else if (ts.isConditionalExpression(n)) { walkKids(n.whenTrue); walkKids(n.whenFalse) }
            else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) walkKids(n.right)
          }
          node.children.forEach(walkKids)
          info.forEach((a) => {
            if (!a.isDelete) return
            const same = info.filter((x) => segOf.get(x.node) === segOf.get(a.node) && x !== a)
            const idx = info.indexOf(a)
            const before = same.some((x) => info.indexOf(x) < idx)
            const after = same.some((x) => info.indexOf(x) > idx && !x.isDelete)
            if (before && after) hit('UI-R03', rel, lineOf(sf, a.node), `删除类(${a.blob}) 夹在别的按钮中间`)
          })
        }
      }

      // ---- UI-R04 ✓ 当动作
      if (CHECK_ICONS.has(tag)) {
        let clickable = null
        for (let p = node.parent; p; p = p.parent) {
          if (ts.isFunctionLike(p) && !ts.isJsxExpression(p.parent ?? p)) { /* 穿过函数继续往上（render prop） */ }
          if (isJsx(p) && p !== node) {
            const t2 = tagOf(p)
            if (BUTTON_TAGS.has(t2) || attrOf(p, 'onClick')) { clickable = p; break }
            if (['li', 'ul', 'div', 'section', 'main', 'form'].includes(t2) && !attrOf(p, 'onClick')) break
          }
        }
        if (clickable) {
          const role = attrStringValue(clickable, 'role')
          const stateful = attrOf(clickable, 'aria-pressed') || attrOf(clickable, 'aria-checked') || attrOf(clickable, 'aria-selected')
            || ['checkbox', 'switch', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'tab'].includes(role)
          if (!stateful && !isConditionalAncestor(node, clickable)) {
            const d = describe(clickable)
            hit('UI-R04', rel, lineOf(sf, node), `${tag} 在可点击的 <${tagOf(clickable)}> 里，无条件显示（${d.blob.slice(0, 40) || '无文字'}）`)
          }
        }
      }

      // ---- UI-R32 图标位置
      if (BUTTON_TAGS.has(tag) && !ICON_ONLY_TAGS.has(tag)) {
        const STRUCT = /^Icon(Chevron|Arrow|Caret|Selector|ExternalLink|Dots|Maximize|Minimize)/
        const left = attrOf(node, 'leftSection'); const right = attrOf(node, 'rightSection')
        let rightIcon = null
        if (right) { const m = right.getText().match(/Icon[A-Z]\w*/); if (m && !STRUCT.test(m[0])) rightIcon = m[0] }
        if (ts.isJsxElement(node)) {
          let seenText = false
          for (const child of node.children) {
            if (ts.isJsxText(child) && child.text.trim()) seenText = true
            else if (ts.isJsxExpression(child) && child.expression && !/Icon[A-Z]|<svg|loading/.test(child.expression.getText())) seenText = true
            else if (seenText && isJsx(child) && /^Icon[A-Z]/.test(tagOf(child)) && !STRUCT.test(tagOf(child))) rightIcon = tagOf(child)
          }
        }
        if (rightIcon && !left) hit('UI-R32', rel, lineOf(sf, node), `<${tag}> 图标 ${rightIcon} 在文字右边`)
      }

      // ---- UI-R34 / R35 按钮覆写与悬停态
      if (BUTTON_TAGS.has(tag) && !isDesignFile(rel)) {
        const cls = classNameOf(node)
        const over = cls.match(/(?<![\w:-])(?:h|px|py|rounded|min-h)-(?:\[[^\]]+\]|[\w.]+)/g) || []
        if (['WorkbenchButton', 'DesignButton', 'Button'].includes(tag) && over.length) hit('UI-R34', rel, lineOf(sf, node), `<${tag}> className 自己覆写了 ${over.slice(0, 4).join(' ')}`)
        if (tag === 'button' && cls && !/hover:|active:|group-hover/.test(cls) && !attrOf(node, 'disabled')) hit('UI-R35', rel, lineOf(sf, node), '<button> 的 className 里没有 hover: / active:')
      }

      // ---- UI-R26 主动作写「确认」
      if (BUTTON_TAGS.has(tag)) {
        const d26 = describe(node)
        for (const k of d26.keys) if (/(^|\.)(confirm|ok)$/i.test(k)) r26Pending.push({ rel, line: lineOf(sf, node), key: k })
        if (d26.texts.some((x) => /^(确认|确定|OK|Ok|Confirm)$/.test(x))) hit('UI-R26', rel, lineOf(sf, node), `按钮文案是泛词：${d26.texts.join(' ').slice(0, 50)}`)
      }

      // ---- UI-R33 图标尺寸 / 描边
      if (/^Icon[A-Z]/.test(tag) && !isDesignFile(rel)) {
        const size = attrStringValue(node, 'size'); const stroke = attrStringValue(node, 'stroke')
        const sizeN = size && /^\{?\d+(\.\d+)?\}?$/.test(size) ? Number(size.replace(/[{}]/g, '')) : null
        const raw = openingOf(node).getText()
        iconSizeUse[sizeN ?? 'default'] = (iconSizeUse[sizeN ?? 'default'] ?? 0) + 1
        if (sizeN !== null && ![12, 13, 14, 16, 18, 20, 24, 28, 32].includes(sizeN)) hit('UI-R33', rel, lineOf(sf, node), `${tag} size=${sizeN}（登记档位：13/14/16/18/24-32）`)
        if (/strokeWidth/.test(raw)) hit('UI-R33', rel, lineOf(sf, node), `${tag} 用了 strokeWidth（Tabler 用 stroke）`)
        const strokeN = stroke && /^\{?\d+(\.\d+)?\}?$/.test(stroke) ? Number(stroke.replace(/[{}]/g, '')) : null
        if (strokeN !== null) { iconStrokeUse[strokeN] = (iconStrokeUse[strokeN] ?? 0) + 1; if (![1.5, 1.6, 1.8, 1.9, 2].includes(strokeN)) hit('UI-R33', rel, lineOf(sf, node), `${tag} stroke=${strokeN}（常用档：1.5/1.6/1.8/2）`) }
      }

      // ---- UI-R19 图标家族
      const fam = ICON_TO_FAMILY.get(ICON_CANON(tag)) ?? ICON_TO_FAMILY.get(tag)
      if (fam) {
        iconUse[fam] ??= {}
        iconUse[fam][ICON_CANON(tag)] ??= []
        iconUse[fam][ICON_CANON(tag)].push(`${rel}:${lineOf(sf, node)}`)
      }

      // ---- UI-R06 禁用没说明
      if (BUTTON_TAGS.has(tag) && attrOf(node, 'disabled')) {
        const expr = attrOf(node, 'disabled').initializer?.getText() ?? 'true'
        const obvious = /loading|busy|pending|submitting|running|saving|generating|readOnly|inFlight|sending|isRunning/i.test(expr)
        const hasWhy = attrOf(node, 'title') || attrOf(node, 'aria-describedby') || attrOf(node, 'data-disabled-reason')
        const parentTitle = (() => { const p = node.parent; return p && ts.isJsxElement(p) && attrOf(p, 'title') })()
        if (!obvious && !hasWhy && !parentTitle) hit('UI-R06', rel, lineOf(sf, node), `<${tag} disabled=${expr.slice(0, 40)}> 没有 title / 说明`)
      }

      // ---- UI-R07 纯图标按钮没名字
      if (BUTTON_TAGS.has(tag) && !['WorkbenchIconButton'].includes(tag)) {
        const opening = openingOf(node)
        const hasName = attrOf(node, 'aria-label') || attrOf(node, 'title') || attrOf(node, 'aria-labelledby') || attrOf(node, 'label')
        let hasText = false
        let hasIcon = ICON_ONLY_TAGS.has(tag) && !!attrOf(node, 'icon')
        if (ts.isJsxElement(node)) {
          for (const child of node.children) {
            if (ts.isJsxText(child) && child.text.trim()) hasText = true
            else if (ts.isJsxExpression(child) && child.expression) {
              const e = child.expression
              const src = e.getText()
              if (/^<|^\(?\s*</.test(src) || (ts.isBinaryExpression(e) && isJsx(e.right)) || ts.isConditionalExpression(e)) {
                if (/Icon[A-Z]|<svg/.test(src) && !/>\s*[^<{\s][^<]*</.test(src)) hasIcon = true
                else hasText = true
              } else hasText = true
            } else if (isJsx(child)) {
              const ct = tagOf(child)
              if (/^Icon[A-Z]/.test(ct) || ct === 'svg' || ct === 'img') hasIcon = true
              else hasText = true
            }
          }
        } else if (!ICON_ONLY_TAGS.has(tag)) { /* self-closing 普通按钮：不判 */ }
        if (hasIcon && !hasText && !hasName && !opening.attributes.properties.some(ts.isJsxSpreadAttribute)) {
          hit('UI-R07', rel, lineOf(sf, node), `<${tag}> 只有图标、没有 aria-label / title`)
        }
      }

      // ---- UI-R08 键盘到不了
      if (['div', 'span', 'li', 'p', 'section', 'img', 'svg', 'td', 'tr', 'article', 'header', 'label'].includes(tag) && attrOf(node, 'onClick')) {
        const role = attrStringValue(node, 'role')
        const cls = classNameOf(node)
        const handler = describe(node).handler
        const wrapperOnly = /stopPropagation|preventDefault/.test(handler) && handler.length < 70
        const backdrop = /\binset-0\b|\bfixed\b/.test(cls) && !role
        const hasKeys = attrOf(node, 'onKeyDown') || attrOf(node, 'onKeyUp')
        if (!wrapperOnly && !backdrop && !(role && attrOf(node, 'tabIndex')) && !(tag === 'label')) {
          hit('UI-R08', rel, lineOf(sf, node), `<${tag}${role ? ` role=${role}` : ''}> 有 onClick，${attrOf(node, 'tabIndex') ? '有 tabIndex' : '没有 tabIndex'}${hasKeys ? '，有 onKeyDown' : '，没有 onKeyDown'}`)
        }
      }

      // ---- UI-R11 散装控件
      if (!isDesignFile(rel)) {
        if (tag === 'button') { rawControl.button[rel] = (rawControl.button[rel] ?? 0) + 1; hit('UI-R11', rel, lineOf(sf, node), '<button>') }
        if (tag === 'select') { rawControl.select[rel] = (rawControl.select[rel] ?? 0) + 1; hit('UI-R11', rel, lineOf(sf, node), '<select>') }
        if (tag === 'input') {
          const type = attrStringValue(node, 'type')
          if (type === 'checkbox' || type === 'radio' || type === 'range') hit('UI-R11', rel, lineOf(sf, node), `<input type=${type}>`)
        }
      }

      // ---- UI-R16 截断没 tooltip
      {
        const cls = classNameOf(node)
        if (/\btruncate\b|line-clamp-|text-ellipsis/.test(cls)) {
          let covered = !!attrOf(node, 'title')
          let hops = 0
          for (let p = node.parent; p && hops < 8 && !covered; p = p.parent) {
            if (isJsx(p)) {
              hops += 1
              if (attrOf(p, 'title') || attrOf(p, 'aria-label') && /Tooltip|Trigger/.test(tagOf(p)) || /Tooltip/.test(tagOf(p))) covered = true
            }
          }
          if (!covered) hit('UI-R16', rel, lineOf(sf, node), `<${tag}> 截断但自己和 8 层内祖先都没有 title / Tooltip`)
        }
      }

      // ---- UI-R17 alt
      if (tag === 'img' && !attrOf(node, 'alt') && !attrOf(node, '{...')) {
        const spread = openingOf(node).attributes.properties.some(ts.isJsxSpreadAttribute)
        if (!spread) hit('UI-R17', rel, lineOf(sf, node), '<img> 没有 alt')
      }

      // ---- UI-R18 对话框名字
      {
        const role = attrStringValue(node, 'role')
        if ((role === 'dialog' || role === 'alertdialog') && !attrOf(node, 'aria-label') && !attrOf(node, 'aria-labelledby')) {
          hit('UI-R18', rel, lineOf(sf, node), `<${tag} role=${role}> 没有名字`)
        }
      }

      // ---- UI-R10 写死的小尺寸（候选）
      if ((BUTTON_TAGS.has(tag) || attrOf(node, 'onClick')) && !isDesignFile(rel)) {
        const cls = classNameOf(node)
        const re = /(?<![\w-])(?:size|h|w)-(?:\[(\d+(?:\.\d+)?)px\]|(0\.5|1|1\.5|2|2\.5|3|3\.5|4|5))(?![\w.\]-])/g
        const px = []
        for (const m of cls.matchAll(re)) px.push(m[1] ? Number(m[1]) : Number(m[2]) * 4)
        const hasPad = /(?<![\w-])p[xy]?-[1-9]/.test(cls) && !/(?<![\w-])p[xy]?-0/.test(cls)
        const sizeAxis = /(?<![\w-])size-/.test(cls)
        if (px.length && Math.min(...px) < 24 && !hasPad && (sizeAxis || (/(?<![\w-])h-/.test(cls) && /(?<![\w-])w-/.test(cls)))) {
          hit('UI-R10', rel, lineOf(sf, node), `<${tag}> 写死 ${Math.min(...px)}px，无 padding 撑大`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  // ---- 逐行 / 逐字符串类规则（className 字符串）
  for (const { text: cls, node } of classStrings(sf)) {
    const line = lineOf(sf, node)
    if (!/[a-z]-/.test(cls) && !/\[/.test(cls)) continue
    // UI-R09 焦点环
    if (!isDesignFile(rel)) {
      for (const m of cls.matchAll(/(?<![\w-])((?:focus(?:-visible|-within)?:)?)outline-none(?![\w-])/g)) {
        const hasReplacement = /focus-visible:(?:ring|outline|shadow|border)|focus:(?:ring-|border-|shadow)|focus-within:(?:ring|border)/.test(cls)
        if (!hasReplacement) hit('UI-R09', rel, line, `${m[0]}（同一串里没有 focus-visible 替代样式）`)
      }
      if (/(?<![\w-])focus(?:-visible)?:ring-0(?![\w-])/.test(cls) && !/focus-visible:(?:ring-[1-9]|outline|shadow|border)/.test(cls)) hit('UI-R09', rel, line, 'focus:ring-0 且无替代')
    }
    // UI-R12 z-index
    if (!/overlayLayers|tailwind\.config/.test(rel)) {
      for (const m of cls.matchAll(/(?<![\w-])-?z-\[(-?\d+)\]/g)) hit('UI-R12', rel, line, m[0])
    }
    // UI-R13 间距
    for (const m of cls.matchAll(/(?<![\w-])(-?(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y))-\[(-?\d+(?:\.\d+)?)px\]/g)) {
      const n = Math.abs(Number(m[2]))
      if (n % 4 !== 0) hit('UI-R13', rel, line, m[0])
    }
    // UI-R14 字号 / 行高
    for (const m of cls.matchAll(/(?<![\w-])(text|leading)-\[(\d+(?:\.\d+)?)(px|rem)\]/g)) hit('UI-R14', rel, line, m[0])
    // UI-R15 颜色
    for (const m of cls.matchAll(/(?<![\w-])(?:bg|text|border|fill|stroke|ring|shadow|from|to|via|outline|divide)-\[(#[0-9a-fA-F]{3,8}|rgba?\([^\]]+\))\]/g)) hit('UI-R15', rel, line, m[0])
  }
  // UI-R15 style 里写死的 hex（排除 token / 主题 / 品牌图形文件）
  if (!/(^src\/design\/(tokens|theme|identity)|NomiIdentityIcon|vendorLogo|Brand|logo|icons?\/)/i.test(rel)) {
    const visitStyle = (n) => {
      if (ts.isStringLiteral(n) && /^#[0-9a-fA-F]{3,8}$/.test(n.text) && ts.isPropertyAssignment(n.parent) && /color|background|border|fill|stroke|shadow/i.test(n.parent.name.getText())) {
        hit('UI-R15', rel, lineOf(sf, n), `style ${n.parent.name.getText()}: '${n.text}'`)
      }
      ts.forEachChild(n, visitStyle)
    }
    visitStyle(sf)
  }
}

// UI-R19：同一语义用了多个图标 → 少数派用法全列
const iconFamilyReport = {}
for (const [fam, uses] of Object.entries(iconUse)) {
  const ranked = Object.entries(uses).map(([icon, sites]) => ({ icon, count: sites.length, sites })).sort((a, b) => b.count - a.count)
  iconFamilyReport[fam] = ranked.map(({ icon, count }) => ({ icon, count }))
  // 「删除」这一族里 IconEraser 是「擦除」不是删，不并入少数派
  if (ranked.length >= 2) {
    const major = ranked[0].icon
    for (const r of ranked.slice(1)) {
      if (['IconEraser', 'IconClipboard', 'IconMenu2', 'IconSlideshow', 'IconRepeat', 'IconPin', 'IconPinned', 'IconHeart', 'IconHeartFilled', 'IconBookmark'].includes(r.icon)) continue
      for (const site of r.sites) { const [f, l] = site.split(':'); hit('UI-R19', f, Number(l), `「${fam}」主流是 ${major}（${ranked[0].count} 处），这里用 ${r.icon}`) }
    }
  }
}

// ---------------------------------------------------------------------------
// 文案规则（i18n）：把 locales/*.ts 与 resources.ts 里的对象字面量拍平
// ---------------------------------------------------------------------------
const copyEntries = [] // {lang, key, value, file, line}
function flattenObject(sf, rel, objNode, lang, prefix) {
  for (const prop of objNode.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const name = prop.name.getText().replace(/^['"`]|['"`]$/g, '')
    const key = prefix ? `${prefix}.${name}` : name
    let init = prop.initializer
    while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression
    if (ts.isObjectLiteralExpression(init)) flattenObject(sf, rel, init, lang, key)
    else if (ts.isStringLiteralLike(init)) copyEntries.push({ lang, key, value: init.text, file: rel, line: lineOf(sf, prop) })
  }
}
const i18nFiles = fs.readdirSync(path.join(ROOT, 'src/i18n/locales')).map((f) => `src/i18n/locales/${f}`).concat(['src/i18n/resources.ts'])
for (const rel of i18nFiles) {
  const sf = ts.createSourceFile(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8'), ts.ScriptTarget.Latest, true)
  sf.forEachChild((stmt) => {
    if (!ts.isVariableStatement(stmt)) return
    for (const decl of stmt.declarationList.declarations) {
      const n = decl.name.getText()
      const lang = /^zh/i.test(n) ? 'zh' : /^en/i.test(n) ? 'en' : null
      let init = decl.initializer
      while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression?.(init) || ts.isParenthesizedExpression(init))) init = init.expression
      if (lang && init && ts.isObjectLiteralExpression(init)) flattenObject(sf, rel, init, lang, '')
    }
  })
}
stats.copyEntries = copyEntries.length

const lastSeg = (key) => key.split('.').pop()
{
  const GENERIC_ZH = new Set(['确认', '确定', '好', '好的', '是', 'OK'])
  for (const c of r26Pending) {
    const tail = c.key.split('.').slice(1).join('.')
    const hitEntry = copyEntries.find((e) => e.lang === 'zh' && (e.key === c.key || e.key === tail))
    if (hitEntry && GENERIC_ZH.has(hitEntry.value.trim())) hit('UI-R26', c.rel, c.line, `按钮文案是泛词「${hitEntry.value}」（${c.key}）`)
  }
}
const isLabelKey = (e) => /(^|\.)(cancel|confirm|close|delete|save|retry|back|next|done|apply|ok|later|dismiss|undo|redo|add|remove|rename|duplicate|copy|download|upload|export|import|generate|regenerate|reset|clear|edit|create|open|skip|continue|stop|pause|play|search)\w*$/i.test(e.key)
const cancelWordings = { zh: {}, en: {} }
for (const e of copyEntries) {
  // UI-R02 取消词
  if (/^(cancel|dismiss|decline|skip|notNow|later|negative|reject|no)$/i.test(lastSeg(e.key)) || /(Cancel|Dismiss|Decline|NotNow)$/.test(lastSeg(e.key))) {
    const v = e.value.trim()
    cancelWordings[e.lang][v] = (cancelWordings[e.lang][v] ?? 0) + 1
    const standard = e.lang === 'zh' ? v.startsWith('取消') : v.startsWith('Cancel')
    if (!standard && /^(不要|不用|算了|否|No|Not now|Nope)$/.test(v)) hit('UI-R02', e.file, e.line, `${e.key} = 「${v}」（标准词：${e.lang === 'zh' ? '取消' : 'Cancel'}）`)
  }
  const short = e.value.length <= 24 && !e.value.includes('{{')
  // UI-R20 省略号 / 句末标点
  if (/\.\.\./.test(e.value) && e.value.length <= 60) hit('UI-R20', e.file, e.line, `${e.lang}:${e.key} 用 "..." → 应为「…」：${e.value}`)
  if (short && isLabelKey(e) && /[。.]$/.test(e.value.trim()) && !/\.\.\.$/.test(e.value)) hit('UI-R20', e.file, e.line, `${e.lang}:${e.key} 短标签带句末标点：${e.value}`)
  // UI-R21 中英混排空格
  if (e.lang === 'zh') {
    const glued = /[一-鿿][A-Za-z0-9]|[A-Za-z0-9][一-鿿]/.test(e.value.replace(/\{\{[^}]+\}\}/g, 'X'))
    const spaced = /[一-鿿] [A-Za-z0-9]|[A-Za-z0-9] [一-鿿]/.test(e.value.replace(/\{\{[^}]+\}\}/g, 'X'))
    e.mixed = glued ? 'glued' : spaced ? 'spaced' : null
  }
  // UI-R22 英文 Title Case
  if (e.lang === 'en' && short && isLabelKey(e)) {
    const words = e.value.trim().split(/\s+/).filter((w) => /^[A-Za-z]/.test(w))
    if (words.length >= 2 && words.every((w) => /^[A-Z]/.test(w)) && !/^[A-Z0-9 ]+$/.test(e.value)) hit('UI-R22', e.file, e.line, `${e.key}: "${e.value}"（Title Case；Nomi 英文多数为句首大写）`)
  }
}
const mixCount = { glued: 0, spaced: 0 }
for (const e of copyEntries) if (e.mixed) mixCount[e.mixed] += 1
stats.zhMixed = mixCount
// UI-R21：只在「两种写法都大量存在」时才算问题——把少数派写法当违例
{
  const minority = mixCount.glued < mixCount.spaced ? 'glued' : 'spaced'
  for (const e of copyEntries) if (e.mixed === minority) hit('UI-R21', e.file, e.line, `zh:${e.key} 中英${minority === 'glued' ? '紧贴无空格' : '之间有空格'}（多数派是${minority === 'glued' ? '有空格' : '紧贴'}）：${e.value.slice(0, 40)}`)
}
stats.cancelWordings = cancelWordings
stats.orderStats = orderStats
stats.iconSizeUse = iconSizeUse
stats.iconStrokeUse = iconStrokeUse
stats.iconFamilies = iconFamilyReport
stats.rawControl = Object.fromEntries(Object.entries(rawControl).map(([k, v]) => [k, Object.values(v).reduce((a, b) => a + b, 0)]))
stats.scanned = { tsxFiles: tsxFiles.length, files: files.length, devlabIncluded: INCLUDE_DEVLAB }

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ rules: RULES, counts: Object.fromEntries(Object.entries(hits).map(([k, v]) => [k, v.length])), stats, hits }, null, 2))
  console.log(`已写 ${JSON_OUT}`)
}
// 按组件（文件）归拢：同一个组件里各条规则各几处，直接指向「改哪个组件」
const byComponent = {}
for (const [rule, rows] of Object.entries(hits)) for (const r of rows) { ((byComponent[r.file] ??= {})[rule] ??= []).push(r.line) }
if (JSON_OUT) { const j = JSON.parse(fs.readFileSync(JSON_OUT, 'utf8')); j.byComponent = byComponent; fs.writeFileSync(JSON_OUT, JSON.stringify(j, null, 2)) }
if (BY_COMPONENT) {
  const rank = Object.entries(byComponent).map(([file, rules]) => ({ file, total: Object.values(rules).reduce((a, b) => a + b.length, 0), rules })).filter((x) => !/^src\/i18n\//.test(x.file) && !(Object.keys(x.rules).length === 1 && (x.rules['UI-R11'] || x.rules['UI-R35']))).sort((a, b) => b.total - a.total)
  console.log('组件（文件）按命中数排序（不含 i18n 文案、仅有「散装 button / 无悬停」一类的文件；完整见 --json 的 byComponent）：')
  for (const x of rank.slice(0, 60)) console.log(`${String(x.total).padStart(4)}  ${x.file}  ${Object.entries(x.rules).map(([r, l]) => `${r}×${l.length}`).join(' ')}`)
} else if (COMPONENT) {
  for (const [file, rules] of Object.entries(byComponent)) if (file.includes(COMPONENT)) for (const [rule, lines] of Object.entries(rules)) for (const l of lines) { const row = hits[rule].find((r) => r.file === file && r.line === l); console.log(`${rule} ${file}:${l}  ${row?.detail ?? ''}`) }
} else if (LIST) {
  const rows = hits[LIST]
  if (!rows) { console.error(`没有这条规则：${LIST}`); process.exit(2) }
  console.log(`${LIST} ${RULES[LIST]}  共 ${rows.length}`)
  for (const r of rows) console.log(`${r.file}:${r.line}  ${r.detail}`)
} else {
  console.log(`扫描 ${stats.scanned.files} 个 ts/tsx（含 ${stats.scanned.tsxFiles} 个 tsx）；设计实验室夹具${INCLUDE_DEVLAB ? '已含' : '未含'}；i18n 叶子 ${stats.copyEntries} 条\n`)
  let total = 0
  for (const [id, desc] of Object.entries(RULES)) {
    const rows = hits[id]
    total += rows.length
    const fileCount = new Set(rows.map((r) => r.file)).size
    console.log(`${id}  ${String(rows.length).padStart(5)} 处 / ${String(fileCount).padStart(3)} 文件   ${desc}`)
  }
  console.log(`\n合计 ${total} 处（启发式，含误报；排序与复核见研究文档）`)
  console.log(`\n决定栏顺序统计：成对 ${orderStats.pairs}，取消在左 ${orderStats.correct}，取消在右 ${orderStats.wrong}`)
  console.log('取消词分布 zh:', JSON.stringify(cancelWordings.zh), ' en:', JSON.stringify(cancelWordings.en))
  console.log('中英混排：', JSON.stringify(mixCount))
  console.log('散装控件：', JSON.stringify(stats.rawControl))
  console.log('图标家族：')
  for (const [fam, rows] of Object.entries(iconFamilyReport)) console.log(`  ${fam}: ${rows.map((r) => `${r.icon}×${r.count}`).join('  ')}`)
}
