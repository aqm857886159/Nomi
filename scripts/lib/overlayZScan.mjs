// 「手写数字层级」扫描器（2026-10-27，开屏「跳过」被顶栏压住的类根因门岗）。
//
// 事故：开屏动画手写 `fixed inset-0 z-[60]`，顶栏所在的 Mantine AppShell 取默认 100，
// 于是整条顶栏画在开屏上面，「跳过」点不到。设计系统 §2.0 早就写了「浮层层级只走
// src/design/overlayLayers.ts 的 NOMI_OVERLAY_Z_INDEX，禁止手写数字」，但没有任何门岗拦。
//
// 规则（一句话，也写在设计系统 §2.0）：
//   · 视口级层（position: fixed）的层级只许走刻度——不管写的是多大的数字；
//   · 任何 ≥ 刻度地板（NOMI_OVERLAY_Z_INDEX.shellChrome，现 100）的手写数字层级也不许——
//     ≥ 地板就是要压过外壳，已经是全局层；
//   · 地板以下、不是 fixed 的数字（`absolute z-[2]` 这类）是组件内局部层叠，随组件走，不受限。
//
// 同一件事有五种写法，全覆盖（P2：入口 / 形状 / 边界全写成测试，见 scripts/overlayZScan.test.mjs）：
//   class      className 里的 `z-[N]` / Tailwind 默认刻度 `z-10 … z-50`（含 md: / hover: 等前缀）
//   style      行内 / 对象 `zIndex: N`（数字或数字字符串），以及 `el.style.zIndex = N`
//   prop       JSX 属性 `zIndex={N}`（Mantine 浮层、AnchoredPopover 等）
//   const      命名常量 `FOO_Z_INDEX = N`（第二份刻度；任何数字都算，名字本身就是在给层编号）
//   css        CSS 规则里的 `z-index: N`
// 合规写法不算：`z-application-modal` 等刻度类、`style={{ zIndex: NOMI_OVERLAY_Z_INDEX.dialog }}`、
// `z-[var(--…)]`、`z-auto`、`zIndex={CANVAS_LAYER.x}`（标识符，不是数字字面量）。
//
// 判 fixed 的单位是「一个 JSX 元素」：它的 className（含 cn(...) 里所有字符串、条件分支）有 `fixed` 前缀族，
// 或它的 style 对象写了 position: 'fixed'。条件里只有一支是 fixed 也算（宁可多报，由基线 reason 解释）。
// 判不到元素的（常量字符串、返回对象字面量）退回到「同一个字符串 / 同一个对象里有没有 fixed」。
// 局限（诚实写出）：静态扫描不知道 Portal，所以 `createPortal` 到 body 的 `absolute z-[50]` 判不出来。
import ts from 'typescript'

/** 扫描器认得的 `fixed`：`fixed`、`md:fixed`、`group-hover:fixed`。 */
const FIXED_TOKEN = /(?:^|:)fixed$/
/** `z-[60]` / `-z-[60]` / `md:z-[60]` / Tailwind 默认刻度 `z-50`；`z-[var(--x)]` / `z-auto` / `z-dialog` 都不匹配。 */
const Z_TOKEN = /(?:^|:)-?z-(?:\[(-?\d+)\]|(\d+))$/
const Z_CONST_NAME = /^[A-Za-z0-9_]*Z_?INDEX$/i
const FIXED_POSITION_TEXT = /position\s*[:=]\s*['"]fixed['"]/

/** 从刻度源文件读地板（NOMI_OVERLAY_Z_INDEX.shellChrome）——数字只有一份，读不到就红，不退回硬编码。 */
export function readScaleFloor(overlayLayersSource) {
  const match = /shellChrome\s*:\s*(\d+)/.exec(overlayLayersSource)
  if (!match) throw new Error('overlayLayers.ts 里读不到 shellChrome 档：刻度地板是手写数字门岗的判据，必须登记在 NOMI_OVERLAY_Z_INDEX 里')
  return Number(match[1])
}

/** 哪些文件归这条门岗：生产 src 的 ts/tsx/css；不含测试、设计实验室、刻度本身。 */
export function isOverlayZScanned(rel) {
  if (!rel.startsWith('src/')) return false
  if (!/\.(tsx?|css)$/.test(rel)) return false
  if (/\.(test|spec)\.tsx?$/.test(rel) || /\.d\.ts$/.test(rel)) return false
  if (rel.startsWith('src/devlab/')) return false
  if (rel === 'src/design/overlayLayers.ts') return false
  return true
}

const QUICK_FILTER = /z-\[|\bz-\d|zIndex|z-index|Z_?INDEX/i

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function stringParts(node, out = []) {
  const visit = (child) => {
    if (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) out.push({ node: child, text: child.text })
    else if (ts.isTemplateExpression(child)) {
      out.push({ node: child.head, text: child.head.text })
      for (const span of child.templateSpans) {
        out.push({ node: span.literal, text: span.literal.text })
        ts.forEachChild(span.expression, visit)
      }
    } else ts.forEachChild(child, visit)
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push({ node, text: node.text })
  else visit(node)
  return out
}

function intOf(expression) {
  if (!expression) return null
  if (ts.isNumericLiteral(expression)) return Number(expression.text)
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(expression.operand)) return -Number(expression.operand.text)
  if ((ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) && /^-?\d+$/.test(expression.text.trim())) return Number(expression.text.trim())
  return null
}

/** 表达式里所有数字字面量（`cond ? 5 : 4` 两支都收）。 */
function intsIn(expression) {
  const direct = intOf(expression)
  if (direct !== null) return [direct]
  if (expression && ts.isConditionalExpression(expression)) return [...intsIn(expression.whenTrue), ...intsIn(expression.whenFalse)]
  if (expression && ts.isParenthesizedExpression(expression)) return intsIn(expression.expression)
  return []
}

function zTokensOf(text) {
  const out = []
  for (const token of text.split(/\s+/)) {
    const match = Z_TOKEN.exec(token)
    if (match) out.push({ token, value: Number(match[1] ?? match[2]) })
  }
  return out
}

function hasFixedToken(text) {
  return text.split(/\s+/).some((token) => FIXED_TOKEN.test(token))
}

function objectHasFixedPosition(object) {
  return object.properties.some((property) => ts.isPropertyAssignment(property)
    && property.name.getText() === 'position'
    && ts.isStringLiteralLike(property.initializer)
    && property.initializer.text === 'fixed')
}

function attributeOf(element, name) {
  return element.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText() === name) ?? null
}

function objectLiteralsIn(node) {
  const out = []
  const visit = (child) => {
    if (ts.isObjectLiteralExpression(child)) out.push(child)
    ts.forEachChild(child, visit)
  }
  visit(node)
  return out
}

export function scanOverlayZTs(file, text, floor) {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const findings = []
  const judged = new Set()
  const add = (node, shape, value, viewport, detail) => findings.push({ line: lineOf(sourceFile, node), shape, value, viewport, detail })
  const flagged = (value, viewport) => viewport || value >= floor

  const judgeElement = (element) => {
    const classAttr = attributeOf(element, 'className')
    const styleAttr = attributeOf(element, 'style')
    const classStrings = classAttr?.initializer ? stringParts(classAttr.initializer) : []
    const styleObjects = styleAttr?.initializer ? objectLiteralsIn(styleAttr.initializer) : []
    for (const part of classStrings) judged.add(part.node)
    for (const object of styleObjects) judged.add(object)
    const viewport = classStrings.some((part) => hasFixedToken(part.text)) || styleObjects.some(objectHasFixedPosition)
    for (const part of classStrings) {
      for (const { token, value } of zTokensOf(part.text)) {
        if (flagged(value, viewport)) add(part.node, 'class', value, viewport, token)
      }
    }
    for (const object of styleObjects) {
      for (const property of object.properties) {
        if (!ts.isPropertyAssignment(property) || property.name.getText() !== 'zIndex') continue
        for (const value of intsIn(property.initializer)) {
          if (flagged(value, viewport)) add(property, 'style', value, viewport, `zIndex: ${value}`)
        }
      }
    }
    const zProp = attributeOf(element, 'zIndex')
    if (zProp?.initializer && ts.isJsxExpression(zProp.initializer)) {
      for (const value of intsIn(zProp.initializer.expression)) {
        if (flagged(value, viewport)) add(zProp, 'prop', value, viewport, `zIndex={${value}}`)
      }
    }
  }

  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) judgeElement(node)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  // 第二遍：没落在 JSX 元素里的写法。
  const second = (node) => {
    // 常量字符串 / cn() 参数里的类名（不在 JSX className 里）：同一个字符串里要有 fixed 才算视口级。
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!judged.has(node) && node.text.length < 2000) {
        const viewport = hasFixedToken(node.text)
        for (const { token, value } of zTokensOf(node.text)) {
          if (flagged(value, viewport)) add(node, 'class', value, viewport, token)
        }
      }
    } else if (ts.isTemplateExpression(node)) {
      for (const part of stringParts(node)) {
        if (judged.has(part.node)) continue
        const viewport = hasFixedToken(part.text)
        for (const { token, value } of zTokensOf(part.text)) {
          if (flagged(value, viewport)) add(part.node, 'class', value, viewport, token)
        }
      }
    }
    // 返回 / 赋值的对象字面量：同一个对象里有 position: 'fixed' 才算视口级。
    if (ts.isObjectLiteralExpression(node) && !judged.has(node)) {
      const viewport = objectHasFixedPosition(node)
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || property.name.getText() !== 'zIndex') continue
        for (const value of intsIn(property.initializer)) {
          if (flagged(value, viewport)) add(property, 'style', value, viewport, `zIndex: ${value}`)
        }
      }
    }
    // 命令式：el.style.zIndex = N
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'zIndex'
      && ts.isPropertyAccessExpression(node.left.expression) && node.left.expression.name.text === 'style') {
      let block = node.parent
      while (block && !ts.isBlock(block) && !ts.isSourceFile(block)) block = block.parent
      const viewport = FIXED_POSITION_TEXT.test(block?.getText(sourceFile) ?? '')
      for (const value of intsIn(node.right)) {
        if (flagged(value, viewport)) add(node, 'style', value, viewport, `style.zIndex = ${value}`)
      }
    }
    // 命名常量：FOO_Z_INDEX = N（第二份刻度，任何数字都算）。
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && Z_CONST_NAME.test(node.name.text)) {
      const value = intOf(node.initializer)
      if (value !== null) add(node, 'const', value, false, `${node.name.text} = ${value}`)
    }
    ts.forEachChild(node, second)
  }
  second(sourceFile)

  return findings
}

export function scanOverlayZCss(text, floor) {
  const findings = []
  const block = /([^{}]+)\{([^{}]*)\}/g
  let match
  while ((match = block.exec(text)) !== null) {
    const body = match[2]
    const zIndex = /(?:^|[;\s])z-index\s*:\s*(-?\d+)\s*(?:!important)?\s*(?:;|$)/.exec(body)
    if (!zIndex) continue
    const value = Number(zIndex[1])
    const viewport = /(?:^|[;\s])position\s*:\s*fixed\b/.test(body)
    if (viewport || value >= floor) {
      const bodyStart = match.index + match[1].length + 1
      const line = text.slice(0, bodyStart + zIndex.index).split('\n').length
      findings.push({ line, shape: 'css', value, viewport, detail: `${match[1].trim().slice(0, 40)} { z-index: ${value} }` })
    }
  }
  return findings
}

/** 一个文件里所有「手写数字层级」命中（按行号排序）。 */
export function scanOverlayZFile(rel, text, floor) {
  if (rel.endsWith('.css')) return scanOverlayZCss(text, floor).sort((a, b) => a.line - b.line)
  if (!QUICK_FILTER.test(text)) return []
  return scanOverlayZTs(rel, text, floor).sort((a, b) => a.line - b.line)
}

export const OVERLAY_Z_FIX_HINT =
  '视口级层（fixed）和任何 ≥ 刻度地板的数字层级，只许走刻度：style={{ zIndex: NOMI_OVERLAY_Z_INDEX.<档> }} 或 className `z-<档>`' +
  '（z-floating-panel / z-application-modal / z-dialog / z-popover / z-confirmation / z-feedback，判档口径见设计系统 §2.0）；' +
  '组件内局部层叠请用地板以下的数字且不要 fixed'
