import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const DEFAULT_ROOTS = ['src', 'electron']
const SOURCE_EXTENSION = /\.(?:ts|tsx|mts|cts)$/
const SKIP_PATH = /(?:^|\/)(?:node_modules|dist|release|\.tmp)(?:\/|$)|\.(?:test|spec)\.[^.]+$/

const LIFECYCLE = new Set([
  'idle',
  'pending',
  'queued',
  'waiting',
  'loading',
  'running',
  'active',
  'streaming',
  'drafting',
  'preparing',
  'recording',
  'converting',
  'generating',
  'testing',
  'repairing',
  'verifying',
  'compiling',
  'done',
  'success',
  'succeeded',
  'complete',
  'completed',
  'finished',
  'finale',
  'ready',
  'verified',
  'working',
  'ok',
  'partial',
  'error',
  'fail',
  'failed',
  'failure',
  'cancelled',
  'cancelling',
  'canceled',
  'stopped',
  'aborted',
  'recoverable',
  'retrying',
  'timeout',
  'skipped',
  'denied',
  'rejected',
  'approved',
])
const SEMANTIC_OWNER_TOKENS = new Set([
  'status',
  'statuses',
  'state',
  'states',
  'phase',
  'phases',
  'stage',
  'stages',
  'step',
  'steps',
  'lifecycle',
  'lifecycles',
  'health',
  'outcome',
  'outcomes',
])
const TYPE_SELECTOR_ARGUMENTS = new Map([
  ['Exclude', new Set([1])],
  ['Extract', new Set([1])],
  ['Omit', new Set([1])],
  ['Pick', new Set([1])],
])

function walk(directory, output = []) {
  if (!fs.existsSync(directory)) return output
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    const normalized = fullPath.split(path.sep).join('/')
    if (SKIP_PATH.test(normalized)) continue
    if (entry.isDirectory()) walk(fullPath, output)
    else if (SOURCE_EXTENSION.test(entry.name)) output.push(fullPath)
  }
  return output
}

function scriptKind(file) {
  return file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

function propertyNameText(name, sourceFile) {
  if (!name) return null
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  return name.getText(sourceFile).replace(/\s+/g, '')
}

function declarationSegment(node, sourceFile) {
  if (ts.isTypeAliasDeclaration(node)) return `type:${node.name.text}`
  if (ts.isInterfaceDeclaration(node)) return `interface:${node.name.text}`
  if (ts.isClassDeclaration(node) && node.name) return `class:${node.name.text}`
  if (ts.isFunctionDeclaration(node) && node.name) return `function:${node.name.text}`
  if (ts.isMethodDeclaration(node)) return `method:${propertyNameText(node.name, sourceFile)}`
  if (ts.isVariableDeclaration(node)) {
    if (ts.isIdentifier(node.name)) return `variable:${node.name.text}`
    if (ts.isObjectBindingPattern(node.name)) return 'variable:binding'
    const declarations = ts.isVariableDeclarationList(node.parent) ? node.parent.declarations : []
    return `variable:${declarations.indexOf(node)}`
  }
  if (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) {
    return `property:${propertyNameText(node.name, sourceFile)}`
  }
  if (ts.isParameter(node)) {
    if (ts.isIdentifier(node.name)) return `parameter:${node.name.text}`
    const parameters = node.parent.parameters ?? []
    return `parameter:${parameters.indexOf(node)}`
  }
  return null
}

function declarationPath(node, sourceFile) {
  const segments = []
  for (let current = node.parent; current && !ts.isSourceFile(current); current = current.parent) {
    const segment = declarationSegment(current, sourceFile)
    if (segment) segments.push(segment)
  }
  return segments.reverse()
}

function stringLiteralMembers(nodes) {
  if (!nodes) return null
  const members = []
  for (const node of nodes) {
    if (!ts.isStringLiteralLike(node)) return null
    members.push(node.text)
  }
  return members
}

function arrayLiteral(expression) {
  let current = expression
  while (ts.isParenthesizedExpression(current)) current = current.expression
  return ts.isArrayLiteralExpression(current) ? current : null
}

function isConstAssertion(node) {
  return (
    ts.isAsExpression(node) &&
    ts.isTypeReferenceNode(node.type) &&
    ts.isIdentifier(node.type.typeName) &&
    node.type.typeName.text === 'const'
  )
}

function isTypeSelectorArgument(node) {
  let current = node
  while (ts.isParenthesizedTypeNode(current.parent)) current = current.parent
  const parent = current.parent
  const argumentIndex = parent?.typeArguments?.indexOf(current) ?? -1
  return Boolean(
    ts.isTypeReferenceNode(parent) &&
    ts.isIdentifier(parent.typeName) &&
    TYPE_SELECTOR_ARGUMENTS.get(parent.typeName.text)?.has(argumentIndex),
  )
}

function candidateAt(node) {
  if (ts.isUnionTypeNode(node) && !isTypeSelectorArgument(node)) {
    const members = []
    for (const typeNode of node.types) {
      if (ts.isLiteralTypeNode(typeNode) && ts.isStringLiteralLike(typeNode.literal)) {
        members.push(typeNode.literal.text)
      } else if (
        typeNode.kind !== ts.SyntaxKind.UndefinedKeyword &&
        !(ts.isLiteralTypeNode(typeNode) && typeNode.literal.kind === ts.SyntaxKind.NullKeyword)
      ) {
        return { kind: 'type-union', members: null }
      }
    }
    return { kind: 'type-union', members }
  }

  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'z' &&
    node.expression.name.text === 'enum'
  ) {
    const array = arrayLiteral(node.arguments[0])
    return { kind: 'z.enum', members: stringLiteralMembers(array?.elements) }
  }

  if (isConstAssertion(node)) {
    const array = arrayLiteral(node.expression)
    return { kind: 'as-const', members: stringLiteralMembers(array?.elements) }
  }

  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Set') {
    let expression = node.arguments?.[0]
    while (expression && (ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression))) {
      expression = expression.expression
    }
    const array = expression ? arrayLiteral(expression) : null
    return { kind: 'set', members: stringLiteralMembers(array?.elements) }
  }

  return null
}

export function normalizeMembers(members) {
  return [...new Set(members)].sort()
}

function isLifecycleVocabulary(members) {
  return members.filter((member) => LIFECYCLE.has(member.toLowerCase())).length >= 2
}

function isSemanticOwner(owner) {
  const ownerDeclaration = owner.at(-1)
  if (!ownerDeclaration) return false
  const identifier = ownerDeclaration.slice(ownerDeclaration.indexOf(':') + 1)
  const tokens = identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase())
  return tokens.some((token) => SEMANTIC_OWNER_TOKENS.has(token))
}

export function scanRepository(repoRoot, roots = DEFAULT_ROOTS) {
  const vocabularies = []
  for (const root of roots) {
    for (const file of walk(path.join(repoRoot, root))) {
      const relativeFile = path.relative(repoRoot, file).split(path.sep).join('/')
      const sourceFile = ts.createSourceFile(
        relativeFile,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        scriptKind(file),
      )
      const baseSiteCounts = new Map()

      function visit(node) {
        const candidate = candidateAt(node)
        const owner = candidate ? declarationPath(node, sourceFile) : []
        const members = candidate?.members ? normalizeMembers(candidate.members) : []
        if (candidate && members.length >= 2 && (isLifecycleVocabulary(members) || isSemanticOwner(owner))) {
          const baseSite = `${relativeFile}::${[...owner, candidate.kind].join('/')}`
          const occurrence = (baseSiteCounts.get(baseSite) ?? 0) + 1
          baseSiteCounts.set(baseSite, occurrence)
          vocabularies.push({
            site: occurrence === 1 ? baseSite : `${baseSite}#${occurrence}`,
            members,
            kind: candidate.kind,
          })
          return
        }
        ts.forEachChild(node, visit)
      }

      visit(sourceFile)
    }
  }
  return vocabularies.sort((left, right) => left.site.localeCompare(right.site))
}
