import ts from 'typescript'

// No path/symbol exemptions: provider facts live in contract data, never executable defaults.
const quotaName = (name) => /concurrency|(?:^|_)(?:workers|workerCount|poolSize|maxActive|parallelism|maxParallel|maxWorkers)(?:$|_)|max_?concurrent(?:_?requests)?|(?:^|_)(?:rpm|tpm)(?:$|_)|requests?_?per_?minute|tokens?_?per_?minute|max_?inflight|(?:provider|vendor|api|request|submission)_?(?:rate_?)?limit|rate_?limit(?:$|_?cap|_?maximum)/i.test(name.replace(/[-\s]/g, ''))
const nameOf = (node) => node ? ts.isStringLiteral(node) ? node.text : node.getText() : ''

export function scanHardcodedProviderLimits(code, file) {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const constants = new Map()
  const hits = new Map()
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) constants.set(node.name.text, node.initializer)
    ts.forEachChild(node, collect)
  }
  collect(source)
  const literal = (node, seen = new Set()) => {
    if (!node) return false
    if (ts.isNumericLiteral(node)) return true
    if (ts.isConditionalExpression(node)) return literal(node.whenTrue, seen) || literal(node.whenFalse, seen)
    if (ts.isIdentifier(node) && constants.has(node.text) && !seen.has(node.text)) {
      return literal(constants.get(node.text), new Set([...seen, node.text]))
    }
    // A mathematical positive denominator is not a capacity limit.
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'Math.max'
        && node.arguments.length === 2 && /^[01]$/.test(node.arguments[0].getText(source))) {
      return literal(node.arguments[1], seen)
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return false
    return ts.forEachChild(node, (child) => literal(child, seen)) === true
  }
  const report = (node) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    hits.set(line, { line, file, text: code.split('\n')[line - 1].trim().slice(0, 120) })
  }
  const quotaContext = (node) => {
    for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
      if (parent.name && quotaName(nameOf(parent.name))) return true
      if (ts.isFunctionLike(parent)) break
    }
    return false
  }
  const isOrdinalTable = (node) => {
    const object = node.parent
    if (!ts.isObjectLiteralExpression(object) || !ts.isVariableDeclaration(object.parent)) return false
    const declaration = object.parent
    if (!/priority|rank|order/i.test(nameOf(declaration.name))
        && !/^Record<[^,]+,\s*number>$/.test(declaration.type?.getText(source) ?? '')) return false
    const values = object.properties.map(property => ts.isPropertyAssignment(property)
      && ts.isNumericLiteral(property.initializer) ? Number(property.initializer.text) : NaN).sort((a, b) => a - b)
    return values.length > 1 && values.every((value, index) => value === index)
  }
  const visit = (node) => {
    // Enum-to-ordinal maps rank outcomes; the values are not request capacities.
    if (ts.isPropertyAssignment(node) && isOrdinalTable(node)) return
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node))
        && node.initializer && quotaName(nameOf(node.name)) && literal(node.initializer)) report(node)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && quotaName(node.left.getText(source)) && literal(node.right)) report(node)
    if (ts.isReturnStatement(node) && quotaContext(node) && literal(node.expression)) report(node)
    // { rateLimit: { limit: 20 } } / providerQuota.maxRequests = 20.
    if (ts.isPropertyAssignment(node) && /^(limit|max|capacity|rpm|inflight)$/i.test(nameOf(node.name))
        && quotaContext(node) && literal(node.initializer)) report(node)
    if (ts.isPropertyAssignment(node) && nameOf(node.name) === 'inflight'
        && ts.isObjectLiteralExpression(node.parent) && ts.isCallExpression(node.parent.parent)
        && /(?:^|\.)acquire$/.test(node.parent.parent.expression.getText(source))
        && literal(node.initializer)) report(node)
    if (ts.isCallExpression(node) && /^(?:pLimit|Semaphore)$/.test(node.expression.getText(source))
        && literal(node.arguments[0])) report(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...hits.values()]
}
