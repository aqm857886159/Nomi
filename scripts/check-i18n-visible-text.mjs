import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const ROOT = process.cwd()
const SRC_ROOT = path.join(ROOT, 'src')
const BASELINE_PATH = path.join(ROOT, 'scripts', 'i18n-visible-text-baseline.json')
const WRITE_BASELINE = process.argv.includes('--write-baseline')

const VISIBLE_ATTRIBUTES = new Set([
  'alt',
  'aria-label',
  'caption',
  'description',
  'emptyMessage',
  'helperText',
  'label',
  'placeholder',
  'title',
  'tooltip',
])
const DIALOG_PROPERTIES = new Set(['title', 'message', 'confirmLabel', 'cancelLabel'])
const TOAST_CALLS = new Set(['toast', 'showInfoToast', 'showUndoToast'])

function isProductSource(fileName) {
  const relative = path.relative(SRC_ROOT, fileName).replaceAll('\\', '/')
  return (
    !relative.startsWith('i18n/') &&
    !relative.startsWith('devlab/') &&
    !relative.includes('/__tests__/') &&
    !/\.(?:test|spec|stories)\.[cm]?[jt]sx?$/.test(relative)
  )
}

function normalizeText(value) {
  return value.replace(/\s+/g, ' ').trim()
}

function hasVisibleWords(value) {
  return /\p{L}/u.test(value) && !value.startsWith('i18n:')
}

function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return normalizeText(node.text)
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text
    for (const span of node.templateSpans) value += '${…}' + span.literal.text
    return normalizeText(value)
  }
  return null
}

function collectExpressionLiterals(node, emit) {
  const direct = literalText(node)
  if (direct !== null) {
    emit(direct)
    return
  }
  if (ts.isConditionalExpression(node)) {
    collectExpressionLiterals(node.whenTrue, emit)
    collectExpressionLiterals(node.whenFalse, emit)
    return
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    collectExpressionLiterals(node.left, emit)
    collectExpressionLiterals(node.right, emit)
  }
}

function callName(expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return ''
}

function scanFile(fileName) {
  const sourceText = fs.readFileSync(fileName, 'utf8')
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const relative = path.relative(ROOT, fileName).replaceAll('\\', '/')
  const findings = []

  function add(kind, text) {
    const normalized = normalizeText(text)
    if (!hasVisibleWords(normalized)) return
    findings.push({ file: relative, kind, text: normalized })
  }

  function visit(node) {
    if (ts.isJsxText(node)) add('jsx-text', node.text)

    if (ts.isJsxAttribute(node) && VISIBLE_ATTRIBUTES.has(node.name.text)) {
      const initializer = node.initializer
      if (initializer && ts.isStringLiteral(initializer)) add(`jsx-attr:${node.name.text}`, initializer.text)
      if (initializer && ts.isJsxExpression(initializer) && initializer.expression) {
        collectExpressionLiterals(initializer.expression, (text) => add(`jsx-attr:${node.name.text}`, text))
      }
    }

    if (ts.isJsxExpression(node) && node.expression && ts.isJsxElement(node.parent)) {
      collectExpressionLiterals(node.expression, (text) => add('jsx-expression', text))
    }

    if (ts.isCallExpression(node)) {
      const name = callName(node.expression)
      if (TOAST_CALLS.has(name) && node.arguments[0]) {
        collectExpressionLiterals(node.arguments[0], (text) => add(`call:${name}`, text))
      }
      if ((name === 'confirmDialog' || name === 'openConfirmModal' || name === 'show') && node.arguments[0]) {
        const options = node.arguments[0]
        if (ts.isObjectLiteralExpression(options)) {
          for (const property of options.properties) {
            if (!ts.isPropertyAssignment(property)) continue
            const propertyName = property.name && ts.isIdentifier(property.name) ? property.name.text : ''
            if (!DIALOG_PROPERTIES.has(propertyName)) continue
            collectExpressionLiterals(property.initializer, (text) => add(`call:${name}.${propertyName}`, text))
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings
}

function fingerprint(finding) {
  return `${finding.file}\u0000${finding.kind}\u0000${finding.text}`
}

function countFindings(findings) {
  const counts = new Map()
  for (const finding of findings) {
    const key = fingerprint(finding)
    const current = counts.get(key)
    if (current) current.count += 1
    else counts.set(key, { ...finding, count: 1 })
  }
  return [...counts.values()].sort((a, b) => fingerprint(a).localeCompare(fingerprint(b), 'en'))
}

const files = ts.sys.readDirectory(SRC_ROOT, ['.ts', '.tsx'], undefined, undefined).filter(isProductSource)
const current = countFindings(files.flatMap(scanFile))

if (WRITE_BASELINE) {
  const payload = { version: 1, generatedAt: new Date().toISOString(), entries: current }
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`i18n visible-text baseline written: ${current.length} fingerprints`)
  process.exit(0)
}

if (!fs.existsSync(BASELINE_PATH)) {
  console.error('Missing scripts/i18n-visible-text-baseline.json; run pnpm run check:i18n:baseline')
  process.exit(1)
}

const baselinePayload = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
if (baselinePayload.version !== 1 || !Array.isArray(baselinePayload.entries)) {
  console.error('Unsupported i18n visible-text baseline format')
  process.exit(1)
}

const baseline = new Map(baselinePayload.entries.map((entry) => [fingerprint(entry), entry.count]))
const violations = current.filter((entry) => entry.count > (baseline.get(fingerprint(entry)) ?? 0))

if (violations.length > 0) {
  console.error('New user-visible literals must use src/i18n resources:')
  for (const entry of violations) {
    const previous = baseline.get(fingerprint(entry)) ?? 0
    console.error(`- ${entry.file} [${entry.kind}] ${JSON.stringify(entry.text)} (${previous} -> ${entry.count})`)
  }
  console.error('Use t(...) / i18n.t(...). Update the baseline only when intentionally accepting existing legacy debt.')
  process.exit(1)
}

const legacyCount = current.reduce((sum, entry) => sum + entry.count, 0)
console.log(`i18n visible-text gate passed (${legacyCount} legacy occurrences; no new literals)`)
