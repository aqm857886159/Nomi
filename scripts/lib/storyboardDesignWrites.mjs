// 找出一段源码里「直接写 storyboardDesignsByDocumentId」的地方（check:storyboard-owner 第四段用）。
// 用语法树而不是正则：读（`.storyboardDesignsByDocumentId`、`...state.storyboardDesignsByDocumentId`、
// 解构 `const { storyboardDesignsByDocumentId } = …`）不算；下面四种写法都算：
//   property   对象字面量里的属性           { storyboardDesignsByDocumentId: next }
//   shorthand  对象字面量里的简写属性       { storyboardDesignsByDocumentId }
//   computed   计算键 / 字符串键            { ['storyboardDesignsByDocumentId']: next } / { 'storyboardDesignsByDocumentId': next }
//   mutation   取出来原地改                 getState().storyboardDesignsByDocumentId[id] = d / delete … / Object.assign(….storyboardDesignsByDocumentId, …) / ….plan.shots.push(…)
// 拦不住的：先存进本地变量再改（`const m = getState().storyboardDesignsByDocumentId; m[id] = d`）——
// 那需要跟踪别名（数据流），语法层看不到；键名拼出来的（`['storyboard' + 'Designs…']`）也看不到。
import ts from 'typescript'

export const STORYBOARD_DESIGN_MAP_KEY = 'storyboardDesignsByDocumentId'
const KEY = STORYBOARD_DESIGN_MAP_KEY
const MUTATING_METHODS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'set', 'delete', 'clear'])
const ASSIGNMENT_OPERATORS = new Set([
  ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
])

const isKeyName = (name) => {
  if (!name) return false
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text === KEY
  if (ts.isComputedPropertyName(name)) {
    const inner = name.expression
    return (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) && inner.text === KEY
  }
  return false
}

const unwrap = (node) => {
  let current = node
  while (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression?.(current) || ts.isTypeAssertionExpression(current)) {
    current = current.expression
  }
  return current
}

/** 这个表达式的访问链（a.b[c].d…）上有没有经过这个键。 */
const chainTouchesKey = (node) => {
  let current = unwrap(node)
  while (current) {
    if (ts.isPropertyAccessExpression(current)) {
      if (current.name.text === KEY) return true
      current = unwrap(current.expression)
    } else if (ts.isElementAccessExpression(current)) {
      const arg = current.argumentExpression
      if ((ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) && arg.text === KEY) return true
      current = unwrap(current.expression)
    } else return false // 调用的返回值（`.slice()`、`getState()` 之下）是另一份值；键要在调用之上才算改到 store 里那份
  }
  return false
}

/** @returns {{ line: number, form: 'property'|'shorthand'|'computed'|'mutation' }[]} */
export function findStoryboardDesignMapWrites(source, fileName = 'file.tsx') {
  if (!source.includes('storyboardDesignsByDocumentId')) return []
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found = []
  const hit = (node, form) => found.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, form })
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && ts.isObjectLiteralExpression(node.parent) && isKeyName(node.name)) {
      hit(node, ts.isIdentifier(node.name) ? 'property' : 'computed')
    } else if (ts.isShorthandPropertyAssignment(node) && node.name.text === KEY) {
      hit(node, 'shorthand')
    } else if (ts.isBinaryExpression(node) && ASSIGNMENT_OPERATORS.has(node.operatorToken.kind) && chainTouchesKey(node.left)) {
      hit(node, 'mutation')
    } else if (ts.isDeleteExpression(node) && chainTouchesKey(node.expression)) {
      hit(node, 'mutation')
    } else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
      && chainTouchesKey(node.operand)) {
      hit(node, 'mutation')
    } else if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression)
      if (ts.isPropertyAccessExpression(callee)) {
        const isObjectAssign = callee.name.text === 'assign' && ts.isIdentifier(callee.expression) && callee.expression.text === 'Object'
        if (isObjectAssign && node.arguments[0] && chainTouchesKey(node.arguments[0])) hit(node, 'mutation')
        else if (MUTATING_METHODS.has(callee.name.text) && chainTouchesKey(callee.expression)) hit(node, 'mutation')
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}
