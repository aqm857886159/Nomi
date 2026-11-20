// check:concept-owners 的一块取证：付费放行「问没问过人、签不签收据、这张批准还能不能领」只在一个家判
// （概念 spend.approval-decision，主人 electron/capabilityCore/runOwnedGenerationGateAuthority.ts；2026-11-20）。
//
// 为什么单放一个文件：concept-owners-scan.mjs 已经很长，这一块只管一件事，挂进同一个 check:concept-owners 命令。
//
// 以前这件事散在 6 处：客户端出口的裸同意分支、出口里的「确认成功」缓存、兜底卡自己判自己签、主进程见客户端名字就签、
// 派发器自己签策略收据、生成门本身。收口以后只剩主人。这里拦两种「又长出一个家」的形状，主人与收据权威两个文件之外：
//   ① 签发口：碰到收据权威的签发方法（铸收据、主进程决定、三种签证）——不论直接调、改名、解构、字符串键、Reflect、展开后再调；
//   ② 结论：在付费门那条链上的文件里，自己写出「算批准」（`confirmed` 被设成恒真）——内联、改名常量、别名展开、属性赋值、Object.assign。
// 从人的答复推出来的（`confirmed: res.action === 'accept' && …`、`typed.confirmed === true`、`Boolean(ok)`）不是恒真，不报；
// 不在付费门链上的确认（关窗、拆解的批量令牌）也不报。
import ts from 'typescript'

import { PRODUCTION_ROOTS, isScannableSource, normalizePath, parseSource, rootOf } from './concept-owners-scan.mjs'

/** 这两个文件之外，谁也不许碰签发口、不许自己写出「算批准」。 */
export const APPROVAL_DECISION_HOMES = new Set([
  'electron/capabilityCore/runOwnedGenerationGateAuthority.ts',
  'electron/capabilityCore/approvalReceipt.ts',
])

/** 收据权威上能「签出一张付费放行」的方法：收据本身，以及造签证（谁批的）的三种。 */
export const APPROVAL_ISSUERS = new Set([
  'mintReceipt',
  'issueDecisionReceipt',
  'createClientElicitationAttestation',
  'createMainProcessGestureAttestation',
  'createPolicyDecisionAttestation',
])

/** 付费门这条链上的文件才看「结论」：提到挑战 / 收据令牌或生成门确认的。 */
const GATE_CHAIN_MARKER = /\b(?:challengeToken|receiptToken|receiptId|challengeId)\b|GenerationGate|generation\.gate\.confirm/

function isInsideType(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isTypeNode(current)) return true
    if (ts.isStatement(current) || ts.isSourceFile(current)) return false
  }
  return false
}

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
 * 返回 [{ path, line, kind: 'issuer' | 'verdict', detail }]；空数组 = 只有一个家。
 */
export function findApprovalDecisionBypass({ files, read }) {
  const found = []
  for (const file of files) {
    const rel = normalizePath(file)
    if (!isScannableSource(rel) || !PRODUCTION_ROOTS.includes(rootOf(rel)) || APPROVAL_DECISION_HOMES.has(rel)) continue
    const text = read(rel)
    if (typeof text !== 'string') continue
    const issuerHint = [...APPROVAL_ISSUERS].some((name) => text.includes(name))
    const onGateChain = GATE_CHAIN_MARKER.test(text) && /\bconfirmed\b/.test(text)
    if (!issuerHint && !onGateChain) continue
    const source = parseSource(rel, text)
    const consts = onGateChain ? constInitializers(source) : new Map()
    const report = (node, kind, detail) => found.push({ path: rel, line: lineOf(source, node), kind, detail })

    const visit = (node) => {
      if (issuerHint) {
        // ① 签发口：成员访问、解构、字符串键（含 Reflect.get / 下标 / 描述符）——展开、Object.assign 之后再点出来也落在成员访问上。
        if (ts.isPropertyAccessExpression(node) && APPROVAL_ISSUERS.has(node.name.text) && !isInsideType(node)) {
          report(node, 'issuer', `碰了签发口 ${node.name.text}`)
        } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
          const name = keyText(node.propertyName) || (ts.isIdentifier(node.name) ? node.name.text : '')
          if (APPROVAL_ISSUERS.has(name)) report(node, 'issuer', `解构出签发口 ${name}`)
        } else if (ts.isStringLiteralLike(node) && APPROVAL_ISSUERS.has(node.text) && !isInsideType(node)
          && !ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent)) {
          report(node, 'issuer', `按字符串键拿签发口 ${node.text}`)
        }
      }
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
