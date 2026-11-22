// 只防回执误导：付费链自己写出恒真 confirmed；不充当花钱授权边界。
// 签发方法已从生产读面移除，不再扫描签发引用的语法形状。
import ts from 'typescript'

import { PRODUCTION_ROOTS, isScannableSource, normalizePath, parseSource, rootOf } from './concept-owners-scan.mjs'

/** 这两个家之外，不许自己写出会误导调用方的恒真批准回执。 */
export const APPROVAL_DECISION_HOMES = new Set([
  'electron/capabilityCore/runOwnedGenerationGateAuthority.ts',
  'electron/capabilityCore/approvalReceipt.ts',
])

/** 付费门这条链上的文件才看「结论」：提到挑战 / 收据令牌或生成门确认的。 */
const GATE_CHAIN_MARKER = /\b(?:challengeToken|receiptToken|receiptId|challengeId)\b|GenerationGate|generation\.gate\.confirm/

function unwrap(expression) {
  let current = expression
  while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression?.(current)
    || ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current))) current = current.expression
  return current
}

function keyText(name) {
  if (!name) return ''
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isPrivateIdentifier(name)) return name.text
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(unwrap(name.expression))) return unwrap(name.expression).text
  return ''
}

/** 同文件里 `const x = <初值>` 的表，用来认出改名的恒真常量与别名对象。 */
function constInitializers(source) {
  const table = new Map()
  const visit = (node) => {
    if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.Const)) {
      for (const declaration of node.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) table.set(declaration.name.text, declaration.initializer)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return table
}

function isAlwaysTrue(expression, consts, seen = new Set()) {
  const node = unwrap(expression)
  if (!node) return false
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const operand = unwrap(node.operand)
    return operand.kind === ts.SyntaxKind.FalseKeyword || (ts.isNumericLiteral(operand) && Number(operand.text) === 0)
      || (ts.isStringLiteralLike(operand) && operand.text === '')
  }
  if (ts.isIdentifier(node) && consts.has(node.text) && !seen.has(node.text)) {
    seen.add(node.text)
    return isAlwaysTrue(consts.get(node.text), consts, seen)
  }
  return false
}

function lineOf(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
}

/**
 * 主人与收据权威之外，生产代码（src / electron，不含测试）里每一处「又一个家」。
 * 返回 [{ path, line, kind: 'verdict', detail }]；空数组 = 只有一个家。
 */
export function findApprovalDecisionBypass({ files, read }) {
  const found = []
  for (const file of files) {
    const rel = normalizePath(file)
    if (!isScannableSource(rel) || !PRODUCTION_ROOTS.includes(rootOf(rel)) || APPROVAL_DECISION_HOMES.has(rel)) continue
    const text = read(rel)
    if (typeof text !== 'string') continue
    const onGateChain = GATE_CHAIN_MARKER.test(text) && /\bconfirmed\b/.test(text)
    if (!onGateChain) continue
    const source = parseSource(rel, text)
    const consts = constInitializers(source)
    const report = (node, kind, detail) => found.push({ path: rel, line: lineOf(source, node), kind, detail })

    const visit = (node) => {
      if (onGateChain) {
        // ② 结论：`confirmed` 被设成恒真。
        if (ts.isPropertyAssignment(node) && keyText(node.name) === 'confirmed' && isAlwaysTrue(node.initializer, consts)) {
          report(node, 'verdict', '自己写出了「算批准」（confirmed 恒真）')
        } else if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'confirmed' && isAlwaysTrue(node.name, consts)) {
          report(node, 'verdict', '自己写出了「算批准」（confirmed 恒真）')
        } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && isAlwaysTrue(node.right, consts)) {
          const left = unwrap(node.left)
          const key = ts.isPropertyAccessExpression(left) ? left.name.text
            : ts.isElementAccessExpression(left) && left.argumentExpression && ts.isStringLiteralLike(unwrap(left.argumentExpression)) ? unwrap(left.argumentExpression).text : ''
          if (key === 'confirmed') report(node, 'verdict', '把结论改成了「算批准」（confirmed = 恒真）')
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return found.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
}
