import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const ROOT = process.cwd()
const SRC_ROOT = path.join(ROOT, 'src')
const ELECTRON_ROOT = path.join(ROOT, 'electron')
const REPORT = process.argv.includes('--report')

const VISIBLE_ATTRIBUTES = new Set([
  'alt',
  'aria-label',
  'ariaLabel',
  'caption',
  'cancelLabel',
  'confirmLabel',
  'description',
  'emptyDescription',
  'emptyTitle',
  'emptyMessage',
  'helperText',
  'hint',
  'label',
  'leadingLabel',
  'message',
  'placeholder',
  'statusLabel',
  'subtitle',
  'title',
  'tooltip',
])
const DIALOG_PROPERTIES = new Set(['title', 'message', 'confirmLabel', 'cancelLabel'])
const TOAST_CALLS = new Set(['toast', 'showInfoToast', 'showUndoToast'])
const VISIBLE_OBJECT_PROPERTIES = new Set([
  ...VISIBLE_ATTRIBUTES,
  'actionLabel',
  'ariaLabel',
  'displayName',
  'emptyText',
  'fallbackLabel',
  'fallbackTitle',
  'reason',
])

// These files intentionally keep stable source values or non-UI prompt/protocol text.
// Their actual display boundaries are localized; keep each exemption narrow and documented.
const EXCLUDED_PREFIXES = [
  'src/config/modelArchetypes/', // translated by translateModelDisplayText at the renderer boundary
  'src/i18n/', // translation resources themselves
  'src/devlab/',
  'electron/capabilityCore/', // MCP/RPC schemas and agent-facing protocol text
]
const EXCLUDED_FILES = new Set([
  'src/config/knownVendors.ts', // getLocalizedKnownVendors translates every displayed field
  'src/config/models.ts', // curated model labels use the model display-text boundary
  'src/ui/onboarding/providerPresets.ts', // legacy endpoint metadata; not rendered
  'src/workbench/creation/creationAiModes.ts', // UI uses creationAi.mode keys; source labels feed AI prompts
  'src/workbench/generationCanvas/agent/applyCanvasToolCall.ts', // agent tool protocol/result prose
  'src/workbench/generationCanvas/agent/generationCanvasTools.ts', // agent tool result prose
  'src/workbench/generationCanvas/agent/runStoryboardPlanner.ts', // agent-only instruction
  'src/workbench/generationCanvas/nodes/controls/parameterControlModel.ts', // translated in nodeModelArchetype/archetypeMeta
  'src/workbench/generationCanvas/nodes/scene3d/scene3dConstants.ts', // translated by scene3dInspector mappings
  'src/workbench/generationCanvas/nodes/scene3d/scene3dPropSpecs.ts', // stable object defaults; toolbar uses scene3d keys
  'src/workbench/library/projectTemplates.ts', // getProjectTemplate selects localized template data
  'src/workbench/library/tryNowExamples.ts', // dormant authored examples, not rendered
  'src/workbench/onboarding/demoProject.ts', // explicitly contains parallel zh-CN/en authored demo data
  'src/workbench/onboarding/handbookContent.ts', // handbookContentForLocale selects parallel localized content
  'src/workbench/timeline/timelineTypes.ts', // persisted stable labels; TimelineTrack displays by type key
  'electron/catalog/comfyuiLocal.ts', // translated by renderer model display-text boundary
  'electron/catalog/newapiTransport.ts', // translated by renderer model display-text boundary
  'electron/ai/canvasTools.ts', // tool schemas and multilingual examples are agent-facing protocol text
  'electron/promptLibrary/promptSources.ts', // external curated source names
])

function isProductSource(fileName) {
  const relative = path.relative(ROOT, fileName).replaceAll('\\', '/')
  return (
    !EXCLUDED_PREFIXES.some((prefix) => relative.startsWith(prefix)) &&
    !EXCLUDED_FILES.has(relative) &&
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

function hasHan(value) {
  return /[\u3400-\u9fff]/u.test(value)
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

function isNonVisibleJsxContainer(node) {
  if (!ts.isJsxElement(node.parent)) return false
  const tagName = node.parent.openingElement.tagName.getText().toLowerCase()
  return tagName === 'style' || tagName === 'script'
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

    if (ts.isPropertyAssignment(node)) {
      const propertyName =
        ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : ''
      if (VISIBLE_OBJECT_PROPERTIES.has(propertyName)) {
        collectExpressionLiterals(node.initializer, (text) => {
          if (hasHan(text)) add(`object-prop:${propertyName}`, text)
        })
      }
    }

    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      !isNonVisibleJsxContainer(node)
    ) {
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

const files = [SRC_ROOT, ELECTRON_ROOT]
  .flatMap((root) => ts.sys.readDirectory(root, ['.ts', '.tsx'], undefined, undefined))
  .filter(isProductSource)
const current = countFindings(files.flatMap(scanFile))

if (REPORT) {
  const counts = new Map()
  for (const entry of current) counts.set(entry.file, (counts.get(entry.file) ?? 0) + entry.count)
  for (const [file, count] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))) {
    console.log(`${String(count).padStart(4)} ${file}`)
  }
  console.log(`Total: ${current.reduce((sum, entry) => sum + entry.count, 0)} occurrences in ${counts.size} files`)
  process.exit(0)
}

if (current.length > 0) {
  console.error(`i18n visible-text gate requires zero literals; found ${current.reduce((sum, entry) => sum + entry.count, 0)}`)
  for (const entry of current.slice(0, 100)) {
    console.error(`- ${entry.file} [${entry.kind}] ${JSON.stringify(entry.text)} (x${entry.count})`)
  }
  process.exit(1)
}
console.log('i18n visible-text gate passed (zero visible literals)')
