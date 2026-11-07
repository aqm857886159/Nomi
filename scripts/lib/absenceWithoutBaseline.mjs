// 「不存在断言没有基线」的判定逻辑（check-walkthroughs.mjs 的 absence-without-baseline 规则）。
//
// 起因（2026-10-30）：中转视频线的 `expect(readCreates(), 'free preparation has not submitted a generation').toBe(0)`
// 比较的是 HTTP POST 次数，却被判成「界面上的不存在断言」——只因为往上 5 行内碰巧有 `locator(`。
// 旧实现是正则加 5 行滑动窗口：看到归零比较，再看附近有没有界面观测词。它判的是「附近有没有界面观测」，
// 不是「被比较的东西是不是界面观测」；反过来，观测离比较远于 5 行时又漏掉。
//
// 现在按被比较的那个表达式判（TypeScript 编译器的语法树，和仓库里别的门岗同一个解析器）：
// 归零比较的左边，沿同一个文件里的来源一路追下去，追到「数一数界面上有几个」才算命中。
//
// 归零比较的形状清单与旧规则一致，不增不减：`x === 0` / `x == 0` / `x !== 0`，以及 `.toBe(0)` / `.toHaveCount(0)`。
//   · `.not.toBe(0)` / `.not.toHaveCount(0)` 断言的是「至少一个」——这正是 proveProbe 的形状（基线本身），不算不存在断言。
//   · `.toHaveCount` 是 Playwright 的 Locator 专属断言（playwright/types/test.d.ts 的 LocatorAssertions），
//     被它比较的东西按 API 定义就是一个 locator，不用再追来源；`.toBe(0)` 什么都能比，要追。
//
// 「界面观测」= 数匹配数或看在不在的那类调用：
//   · 取一批匹配：locator / getByRole / getByText / getByLabel / getByPlaceholder / getByAltText / getByTitle / getByTestId /
//     frameLocator（Playwright 的 locator 工厂），以及 DOM 的 querySelectorAll；
//   · 数一数：`.count()`（零参）、`X.length` / `X.size`（X 是上面那一批匹配）；看在不在：`.isVisible()`。
//   一批匹配经 first / last / nth / and / or / all / map / slice / concat / flat / flatMap / sort / reverse / allInnerTexts /
//   allTextContents / catch / finally、`filter({…})`（Locator.filter，参数是对象）、Array.from、`[...x]`、Promise.all 之后还是那一批匹配。
//   不算：`filter(函数)`——过滤出的是「违规清单」，零取决于谓词而不是选择器本身；getAttribute / textContent / innerText /
//   boundingBox 这类读元素值的方法（要先找到元素，不是数匹配数）；回调的形参（那是元素本身，不是匹配数）。
//
// 追的路径（都在同一个文件里）：变量的初始值与每一次赋值（含解构、默认值、for-of 的来源、对字段的写入）、
// 对象字面量按字段名取（不是整包算）、本地函数的返回表达式、evaluate / evaluateAll / $eval 回调的返回表达式、
// 其余调用看实参。同名变量按词法作用域区分（块级 let / const、函数级 var）。
//
// 追不到来源的（函数形参、import 进来的、全局）不算命中：它们是别处传进来的事实，本文件看不见。
// 这是和旧窗口相比会漏的口子（类别与数量在 docs/engineering/direction-checks/2026-10-30-walk-absence-attribution.md §7）；
// 换成「追不到就算命中」会把进程退出码、下标、传进判据函数的 facts 这一大片全判成界面断言。
//
// 已知限制（语法层，和上面是同一类口子）：页内代码写成字符串的（`win.evaluate('…')`）看不到；`x.then((n) => n === 0)` 的
// 回调形参、`evaluateAll((els) => …)` 的形参不追；经 import 进来的计数函数不追；对数组 push 进去的值不追。
import ts from 'typescript'

const LOCATOR_FACTORIES = new Set(['locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByAltText', 'getByTitle', 'getByTestId', 'frameLocator'])
const DOM_COLLECTIONS = new Set(['querySelectorAll'])
/** 一批匹配经过这些方法还是同一批（filter 另判：参数是对象才是 Locator.filter）。 */
const SAME_MATCHES = new Set(['first', 'last', 'nth', 'and', 'or', 'all', 'map', 'slice', 'concat', 'flat', 'flatMap', 'sort', 'reverse', 'allInnerTexts', 'allTextContents', 'catch', 'finally'])
/** 在页面里跑回调、把回调的返回值带回来的调用。 */
const RUNS_IN_PAGE = new Set(['evaluate', 'evaluateHandle', 'evaluateAll', '$eval', '$$eval'])
const ZERO_MATCHERS = new Set(['toBe', 'toHaveCount'])
const ZERO_OPERATORS = new Set([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken])
/** 值原样挑一个操作数出来的运算符。 */
const PICKS_AN_OPERAND = new Set([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.CommaToken])
/** 字段路径的长度上限：防止 `a = a.next` 这类自引用把路径越追越长。 */
const MAX_PATH = 8

const isFunctionLike = (node) => ts.isFunctionLike(node) && !ts.isTypeNode(node)

/** 去掉不改变值的包装：括号、await、`!`、as / satisfies / 类型断言。 */
function unwrap(node) {
  let current = node
  while (current && (ts.isParenthesizedExpression(current) || ts.isAwaitExpression(current) || ts.isNonNullExpression(current)
    || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isTypeAssertionExpression(current))) current = current.expression
  return current
}

function calleeName(call) {
  const callee = unwrap(call.expression)
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)) return callee.argumentExpression.text
  return null
}

/** 属性名 / 键名 → 路径分量；算出来的键（`a[k]`）用 '*' 通配。 */
function keyOf(name) {
  if (name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name))) return String(name.text)
  return '*'
}

/** 这个标识符是不是对变量的「引用」（而不是属性名、声明名、标签这些只是长得像标识符的位置）。 */
function isReference(id) {
  const p = id.parent
  if (!p) return true
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false
  if (ts.isPropertyAssignment(p) && p.name === id) return false
  if (ts.isBindingElement(p) && (p.name === id || p.propertyName === id)) return false
  if (ts.isVariableDeclaration(p) && p.name === id) return false
  if (ts.isParameter(p) && p.name === id) return false
  if ((ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p)) && p.name === id) return false
  if ((ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) && p.name === id) return false
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isExportSpecifier(p)) return false
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false
  return true
}

/** 解构模式里每个名字：{ id, select: 从初始值里取哪条字段路径, fallback: 该名字自己的默认值 }。 */
function patternNames(pattern, select = [], out = []) {
  if (ts.isIdentifier(pattern)) {
    out.push({ id: pattern, select, fallback: null })
    return out
  }
  const isObject = ts.isObjectBindingPattern(pattern)
  if (!isObject && !ts.isArrayBindingPattern(pattern)) return out
  for (const element of pattern.elements) {
    if (!ts.isBindingElement(element)) continue
    const key = isObject ? keyOf(element.propertyName ?? element.name) : '*'
    const inner = element.dotDotDotToken ? select : [...select, key]
    const before = out.length
    patternNames(element.name, inner, out)
    if (element.initializer) for (let i = before; i < out.length; i += 1) out[i].fallback = element.initializer
  }
  return out
}

class Scope {
  constructor(parent) {
    this.parent = parent
    this.vars = new Map()
  }
}

/**
 * @param {string} source 走查源码（原文，含注释；注释本来就不会进语法树）
 * @param {string} fileName 只用来给解析器当名字
 * @returns {{ line: number, text: string }[]} 每个命中的行（一行里有几个归零比较只记一次），按行号排序
 */
export function findAbsenceWithoutBaseline(source, fileName = 'walk.mjs') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)

  // ── 词法作用域：函数 / 块 / for / catch / switch 各一层；var 归函数层，let / const / class / function 归所在块。
  const scopes = new Map()
  const root = new Scope(null)
  scopes.set(sourceFile, root)

  /** binding.sources 里每一项：{ value, select } = 值是 value 里取 select 路径；{ write, at, select } = 往字段 at 写了 write。 */
  const declare = (scope, id, entry) => {
    let binding = scope.vars.get(id.text)
    if (!binding) {
      binding = { sources: [] }
      scope.vars.set(id.text, binding)
    }
    if (entry) binding.sources.push(entry)
  }

  const buildScopes = (node, scope, functionScope) => {
    let inner = scope
    let innerFunction = functionScope
    if (isFunctionLike(node)) {
      inner = new Scope(scope)
      innerFunction = inner
      scopes.set(node, inner)
      for (const parameter of node.parameters ?? []) {
        for (const { id, select, fallback } of patternNames(parameter.name)) {
          declare(inner, id, null)
          if (parameter.initializer) declare(inner, id, { value: parameter.initializer, select })
          if (fallback) declare(inner, id, { value: fallback, select: [] })
        }
      }
    } else if (ts.isBlock(node) && !(node.parent && isFunctionLike(node.parent))) {
      inner = new Scope(scope)
      scopes.set(node, inner)
    } else if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isCatchClause(node) || ts.isCaseBlock(node)) {
      inner = new Scope(scope)
      scopes.set(node, inner)
      if (ts.isCatchClause(node) && node.variableDeclaration) for (const { id } of patternNames(node.variableDeclaration.name)) declare(inner, id, null)
    }

    if (ts.isVariableDeclaration(node)) {
      const list = node.parent
      const isVar = ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.BlockScoped) === 0
      const target = isVar ? innerFunction : inner
      const loop = ts.isVariableDeclarationList(list) ? list.parent : null
      for (const { id, select, fallback } of patternNames(node.name)) {
        declare(target, id, null)
        if (loop && (ts.isForOfStatement(loop) || ts.isForInStatement(loop))) declare(target, id, { value: loop.expression, select: ['*', ...select] })
        else if (node.initializer) declare(target, id, { value: node.initializer, select })
        if (fallback) declare(target, id, { value: fallback, select: [] })
      }
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      declare(scope, node.name, { value: node, select: [] })
    } else if (ts.isClassDeclaration(node) && node.name) {
      declare(scope, node.name, null)
    } else if (ts.isImportDeclaration(node) && node.importClause) {
      const { name, namedBindings } = node.importClause
      if (name) declare(scope, name, null)
      if (namedBindings && ts.isNamespaceImport(namedBindings)) declare(scope, namedBindings.name, null)
      else if (namedBindings) for (const element of namedBindings.elements) declare(scope, element.name, null)
    }
    ts.forEachChild(node, (child) => buildScopes(child, inner, innerFunction))
  }
  buildScopes(sourceFile, root, root)

  const resolve = (id) => {
    let start = id
    while (start && !scopes.has(start)) start = start.parent
    for (let scope = start ? scopes.get(start) : root; scope; scope = scope.parent) {
      const binding = scope.vars.get(id.text)
      if (binding) return binding
    }
    return null
  }

  // ── 赋值：`x = e`（整体）、`x.p.q = e`（往 x 的字段 p.q 写）、`[a, b] = e`、`({ a } = e)`。右边都是被写变量的来源。
  const assignTargets = (target, select, out) => {
    const t = unwrap(target)
    if (ts.isIdentifier(t)) {
      out.push({ id: t, at: [], select })
    } else if (ts.isPropertyAccessExpression(t) || ts.isElementAccessExpression(t)) {
      const at = []
      let base = t
      while (ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base)) {
        at.unshift(ts.isPropertyAccessExpression(base) ? base.name.text : keyOf(base.argumentExpression))
        base = unwrap(base.expression)
      }
      if (ts.isIdentifier(base)) out.push({ id: base, at, select })
    } else if (ts.isArrayLiteralExpression(t)) {
      for (const element of t.elements) assignTargets(ts.isSpreadElement(element) ? element.expression : element, [...select, '*'], out)
    } else if (ts.isObjectLiteralExpression(t)) {
      for (const property of t.properties) {
        if (ts.isShorthandPropertyAssignment(property)) out.push({ id: property.name, at: [], select: [...select, property.name.text] })
        else if (ts.isPropertyAssignment(property)) assignTargets(property.initializer, [...select, keyOf(property.name)], out)
        else if (ts.isSpreadAssignment(property)) assignTargets(property.expression, select, out)
      }
    }
  }
  const collectAssignments = (node) => {
    if (ts.isBinaryExpression(node) && ts.isAssignmentOperator(node.operatorToken.kind)) {
      const targets = []
      assignTargets(node.left, [], targets)
      for (const { id, at, select } of targets) {
        const binding = resolve(id)
        if (!binding) continue
        binding.sources.push(at.length === 0 ? { value: node.right, select } : { write: node.right, at, select })
      }
    }
    ts.forEachChild(node, collectAssignments)
  }
  collectAssignments(sourceFile)

  /** 函数「返回什么」：箭头函数的表达式体，或函数体里直属的 return 表达式（不进嵌套函数）。 */
  const returnsOf = (fn) => {
    if (fn.body && !ts.isBlock(fn.body)) return [fn.body]
    const out = []
    const visit = (n) => {
      if (isFunctionLike(n) && n !== fn) return
      if (ts.isReturnStatement(n) && n.expression) out.push(n.expression)
      ts.forEachChild(n, visit)
    }
    if (fn.body) visit(fn.body)
    return out
  }
  /** 这个表达式指向的本地函数：函数 / 箭头本身，或者初值是函数的变量。 */
  const functionsOf = (expression) => {
    const target = unwrap(expression)
    if (!target) return []
    if (isFunctionLike(target)) return [target]
    if (!ts.isIdentifier(target)) return []
    const binding = resolve(target)
    return (binding?.sources ?? []).map((entry) => (entry.value ? unwrap(entry.value) : null)).filter((value) => value && isFunctionLike(value))
  }

  const nodeIds = new WeakMap()
  let nextNodeId = 0
  const idOf = (node) => {
    if (!nodeIds.has(node)) nodeIds.set(node, nextNodeId++)
    return nodeIds.get(node)
  }

  /**
   * 「expression 取 path 这条字段路径之后的值，是不是一次界面观测的结果（一批匹配，或匹配数 / 在不在）」。
   * 每个被比较的表达式新建一个：seen 记走过的（节点, 路径），既防环，也让同一来源只查一次。
   */
  const newObserver = () => {
    const seen = new Set()
    const observes = (input, path) => {
      const node = unwrap(input)
      if (!node || path.length > MAX_PATH) return false
      const key = `${idOf(node)}|${path.join('.')}`
      if (seen.has(key)) return false
      seen.add(key)

      if (ts.isIdentifier(node)) {
        const binding = isReference(node) ? resolve(node) : null
        for (const entry of binding?.sources ?? []) {
          if (entry.value) {
            if (observes(entry.value, [...entry.select, ...path])) return true
          } else if (path.length >= entry.at.length && entry.at.every((k, i) => k === '*' || path[i] === '*' || k === path[i])) {
            if (observes(entry.write, [...entry.select, ...path.slice(entry.at.length)])) return true
          }
        }
        return false
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const name = ts.isPropertyAccessExpression(node) ? node.name.text : keyOf(node.argumentExpression)
        // `X.length` / `X.size`：X 是一批匹配，这个数就是匹配数。
        if (path.length === 0 && (name === 'length' || name === 'size') && observes(node.expression, [])) return true
        return observes(node.expression, [name, ...path])
      }
      if (ts.isObjectLiteralExpression(node)) {
        if (path.length === 0) return false
        const [head, ...rest] = path
        for (const property of node.properties) {
          if (ts.isSpreadAssignment(property)) {
            if (observes(property.expression, path)) return true
            continue
          }
          const key = ts.isShorthandPropertyAssignment(property) ? property.name.text : keyOf(property.name)
          if (!(head === '*' || key === '*' || key === head)) continue
          if (ts.isPropertyAssignment(property) && observes(property.initializer, rest)) return true
          if (ts.isShorthandPropertyAssignment(property) && observes(property.name, rest)) return true
        }
        return false
      }
      if (ts.isArrayLiteralExpression(node)) {
        // `[...x]` 是 x 的拷贝，还是那一批；别的数组字面量是一包值，只在取下标 / 解构时按元素看。
        if (path.length === 0) return node.elements.length === 1 && ts.isSpreadElement(node.elements[0]) && observes(node.elements[0].expression, [])
        const rest = path.slice(1)
        return node.elements.some((element) => (ts.isSpreadElement(element) ? observes(element.expression, path) : observes(element, rest)))
      }
      if (ts.isCallExpression(node)) {
        const callee = unwrap(node.expression)
        const name = calleeName(node)
        if (name && (LOCATOR_FACTORIES.has(name) || DOM_COLLECTIONS.has(name))) return path.length === 0
        if (name === 'count' && node.arguments.length === 0) return path.length === 0
        if (name === 'isVisible') return path.length === 0
        const isMethod = ts.isPropertyAccessExpression(callee)
        if (isMethod && RUNS_IN_PAGE.has(name)) {
          const callbacks = node.arguments.flatMap(functionsOf)
          if (callbacks.length > 0) return callbacks.some((callback) => returnsOf(callback).some((returned) => observes(returned, path)))
        }
        // Array.from(x) / Promise.all(x)：还是 x 里的东西（排在 SAME_MATCHES 前面，免得 `Promise.all` 被当成 locator.all()）。
        if (isMethod && ts.isIdentifier(callee.expression)
          && ((callee.expression.text === 'Array' && name === 'from') || (callee.expression.text === 'Promise' && ['all', 'allSettled', 'resolve'].includes(name)))) {
          return Boolean(node.arguments[0]) && observes(node.arguments[0], path)
        }
        if (isMethod && SAME_MATCHES.has(name)) return observes(callee.expression, path)
        // Locator.filter({ hasText })（参数是对象）仍是选择器；Array.filter(函数) 过滤出「违规清单」，零取决于谓词。
        if (isMethod && name === 'filter') {
          const options = node.arguments[0] && unwrap(node.arguments[0])
          return Boolean(options) && ts.isObjectLiteralExpression(options) && observes(callee.expression, path)
        }
        const local = ts.isIdentifier(callee) ? functionsOf(callee) : isFunctionLike(callee) ? [callee] : []
        if (local.some((fn) => returnsOf(fn).some((returned) => observes(returned, path)))) return true
        // 其余调用：结果可能由实参算出来（Number(x)、Math.max(0, x)、本文件追不到的函数）。接收者不算——读元素值的方法都在这一类。
        return node.arguments.some((argument) => observes(argument, []))
      }
      if (ts.isNewExpression(node)) return (node.arguments ?? []).some((argument) => observes(argument, []))
      if (ts.isBinaryExpression(node)) {
        const kind = node.operatorToken.kind
        if (ts.isAssignmentOperator(kind)) return observes(node.right, path)
        if (PICKS_AN_OPERAND.has(kind)) return observes(node.left, path) || observes(node.right, path)
        // 匹配数相加仍是匹配数；相减 / 取模 / 比较得到的是差值、余数、布尔，不是「有几个」。
        if (kind === ts.SyntaxKind.PlusToken && path.length === 0) return observes(node.left, []) || observes(node.right, [])
        return false
      }
      if (ts.isConditionalExpression(node)) return observes(node.whenTrue, path) || observes(node.whenFalse, path)
      if (ts.isPrefixUnaryExpression(node)) return path.length === 0 && (node.operator === ts.SyntaxKind.PlusToken || node.operator === ts.SyntaxKind.MinusToken) && observes(node.operand, [])
      return false
    }
    return observes
  }

  /** `expect(S, msg).not.toBe(0)` 的 S；`.not` 返回 null（那是「至少一个」，不是不存在断言）。接不上 expect(...) 的写法返回 undefined。 */
  const matcherSubject = (matcherCall) => {
    let receiver = matcherCall.expression.expression
    for (let depth = 0; depth < 10; depth += 1) {
      receiver = unwrap(receiver)
      if (!ts.isPropertyAccessExpression(receiver) || !['not', 'resolves', 'rejects'].includes(receiver.name.text)) break
      if (receiver.name.text === 'not') return null
      receiver = receiver.expression
    }
    return ts.isCallExpression(receiver) ? receiver.arguments[0] : undefined
  }

  const lines = source.split(/\r?\n/)
  const hitLines = new Set()
  const consider = (position, isHit) => {
    if (isHit()) hitLines.add(sourceFile.getLineAndCharacterOfPosition(position.getStart(sourceFile)).line + 1)
  }
  const visit = (node) => {
    if (ts.isBinaryExpression(node) && ZERO_OPERATORS.has(node.operatorToken.kind) && ts.isNumericLiteral(node.right) && Number(node.right.text) === 0) {
      consider(node.operatorToken, () => newObserver()(node.left, []))
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ZERO_MATCHERS.has(node.expression.name.text)
      && node.arguments.length === 1 && ts.isNumericLiteral(node.arguments[0]) && Number(node.arguments[0].text) === 0) {
      const subject = matcherSubject(node)
      consider(node.expression.name, () => {
        if (subject === null) return false
        if (node.expression.name.text === 'toHaveCount') return true
        if (!subject) return false
        const target = unwrap(subject)
        const observes = newObserver()
        // expect.poll(() => loc.count()) 比较的是回调的返回值。
        return isFunctionLike(target) ? returnsOf(target).some((returned) => observes(returned, [])) : observes(target, [])
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return [...hitLines].sort((a, b) => a - b).map((line) => ({ line, text: (lines[line - 1] ?? '').trim().slice(0, 120) }))
}
