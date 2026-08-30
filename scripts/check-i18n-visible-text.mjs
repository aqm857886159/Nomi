import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const ROOT = process.cwd()
const SRC_ROOT = path.join(ROOT, 'src')
const ELECTRON_ROOT = path.join(ROOT, 'electron')
const MODEL_DISPLAY_TEXT_FILE = path.join(SRC_ROOT, 'i18n', 'locales', 'modelDisplayText.ts')
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
  'electron/shared/videoCapabilities/', // source-backed model facts; rendered by GUI/MCP capability boundaries
]
const EXCLUDED_FILES = new Set([
  'src/config/knownVendors.ts', // getLocalizedKnownVendors translates every displayed field
  'src/config/models.ts', // curated model labels use the model display-text boundary
  'src/ui/onboarding/providerPresets.ts', // legacy endpoint metadata; not rendered
  'src/ui/onboarding/customCallTestFixture.ts', // connectivity-test prompts sent to the model, not UI copy
  'src/workbench/creation/creationAiModes.ts', // UI uses creationAi.mode keys; source labels feed AI prompts
  'src/workbench/generationCanvas/agent/shotVerify.ts', // stable source strings; ReconcileDeviationCard translates them at the display boundary
  'src/workbench/generationCanvas/agent/applyCanvasToolCall.ts', // agent tool protocol/result prose
  'src/workbench/generationCanvas/agent/generationCanvasTools.ts', // agent tool result prose
  'src/workbench/generationCanvas/agent/runStoryboardPlanner.ts', // agent-only instruction
  'src/workbench/generationCanvas/nodes/controls/parameterControlModel.ts', // translated in nodeModelArchetype/archetypeMeta
  'src/workbench/generationCanvas/nodes/scene3d/attachCameraMoveToTarget.ts', // camera-move directive appended to the model prompt (and matched back by includes('镜头运动：')), not UI copy
  'src/workbench/generationCanvas/nodes/scene3d/poseMetrics.ts', // posecode report feeds the VLM prompt and loop logs, not UI
  'src/workbench/generationCanvas/nodes/scene3d/scene3dConstants.ts', // translated by scene3dInspector mappings
  'src/workbench/generationCanvas/nodes/scene3d/scene3dPropSpecs.ts', // stable object defaults; toolbar uses scene3d keys
  'src/workbench/library/projectTemplates.ts', // getProjectTemplate selects localized template data
  'src/workbench/library/tryNowExamples.ts', // dormant authored examples, not rendered
  'src/workbench/onboarding/demoProject.ts', // explicitly contains parallel zh-CN/en authored demo data
  'src/workbench/onboarding/handbookContent.ts', // handbookContentForLocale selects parallel localized content
  'src/workbench/timeline/timelineTypes.ts', // persisted stable labels; TimelineTrack displays by type key
  'electron/catalog/comfyuiLocal.ts', // translated by renderer model display-text boundary
  'electron/catalog/newapiTransport.ts', // translated by renderer model display-text boundary
  'electron/harness/tools/canvasDescriptors.ts', // tool schemas and multilingual examples are agent-facing protocol text
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
  // `a || '中文'` / `a ?? '中文'` 的兜底串也是要显示的文案——只descend `+` 的话,
  // 「取不到就显这句中文」这个最常见的漏译写法从门岗底下整个漏过去(shotVerify 的兜底理由就是这么漏的)。
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.PlusToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    collectExpressionLiterals(node.left, emit)
    collectExpressionLiterals(node.right, emit)
  }
}

function callName(expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return ''
}

// 「渲染邻接层」= 组件与它们直接依赖的展示辅助模块。这些目录里的返回串基本等同于屏幕上的字;
// agent/prompt 那些目录不在内(那里的中文是喂模型的提示词,不是给人看的)。
const RENDER_ADJACENT_PREFIXES = [
  'src/ui/',
  'src/workbench/',
  'src/design/',
]
const RENDER_ADJACENT_EXCEPT = [
  'src/workbench/generationCanvas/agent/', // 提示词与 agent 协议文本
  'src/workbench/generationCanvas/fixation/', // 定妆提示词模板
  'src/workbench/creation/creationAiModes.ts', // 源标签喂 AI 提示词,显示走 creationAi.mode 键
]

function isRenderAdjacent(relative) {
  return (
    RENDER_ADJACENT_PREFIXES.some((prefix) => relative.startsWith(prefix)) &&
    !RENDER_ADJACENT_EXCEPT.some((prefix) => relative.startsWith(prefix))
  )
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

    // 渲染层里 `return '中文'`:这类模块的导出**直接**被 .tsx 拿去显示(时间线步骤标题就是这么来的),
    // 返回值即用户所见。属性名/JSX 属性那几条规则一条都盖不到它——toolCallSummary 整份中文、
    // check:i18n 却是绿的,漏的就是这个形状。
    if (ts.isReturnStatement(node) && node.expression && isRenderAdjacent(relative)) {
      collectExpressionLiterals(node.expression, (text) => {
        if (hasHan(text)) add('return-literal', text)
      })
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

function collectUntranslatedModelLabels() {
  const sourceRoots = [
    path.join(SRC_ROOT, 'config', 'modelArchetypes'),
    path.join(ELECTRON_ROOT, 'catalog'),
  ]
  const sourceLabels = new Set()
  for (const root of sourceRoots) {
    // 与主扫描同一套 isProductSource 过滤:测试夹具里的 `label: "图"` 不是真档案标签,
    // 要求给它一份英文译名毫无意义(2026-08-28:main 新增的 catalogMigrateV11.test.ts 就这么把门岗弄红了)。
    const files = ts.sys.readDirectory(root, ['.ts', '.tsx'], undefined, undefined).filter(isProductSource)
    for (const fileName of files) {
      const sourceText = fs.readFileSync(fileName, 'utf8')
      for (const match of sourceText.matchAll(/\blabel\s*:\s*["'`]([^"'`]*[\u3400-\u9fff][^"'`]*)["'`]/g)) {
        sourceLabels.add(normalizeText(match[1]))
      }
    }
  }
  const translationSource = fs.readFileSync(MODEL_DISPLAY_TEXT_FILE, 'utf8')
  const translatedLabels = new Set()
  for (const match of translationSource.matchAll(/^\s*(?:'([^']+)'|"([^"]+)"|([\u3400-\u9fff][^:]*))\s*:/gm)) {
    translatedLabels.add(normalizeText(match[1] || match[2] || match[3]))
  }
  return [...sourceLabels].filter((label) => !translatedLabels.has(label)).sort((a, b) => a.localeCompare(b, 'en'))
}

const files = [SRC_ROOT, ELECTRON_ROOT]
  .flatMap((root) => ts.sys.readDirectory(root, ['.ts', '.tsx'], undefined, undefined))
  .filter(isProductSource)
const allFindings = countFindings(files.flatMap(scanFile))
const missingModelLabels = collectUntranslatedModelLabels()

// **硬零**,没有基线、没有豁免名单。
// 2026-08-28 新加的两条规则(return-literal、`||`/`??` 兜底串)第一次开灯照出 ~50 处存量,期间挂过一份
// shrink-only 基线记账;同批清零后基线连同 `--update-baseline` 一并删除——留着一份空基线等于留一个
// 逃生口,下次漏译会被顺手记进去而不是修掉(P1)。真需要长期豁免的走 EXCLUDED_FILES,每条写明理由。
const current = allFindings

if (REPORT) {
  const counts = new Map()
  for (const entry of current) counts.set(entry.file, (counts.get(entry.file) ?? 0) + entry.count)
  for (const [file, count] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))) {
    console.log(`${String(count).padStart(4)} ${file}`)
  }
  if (missingModelLabels.length > 0) {
    console.log(`Missing model-display translations: ${missingModelLabels.length}`)
    for (const label of missingModelLabels) console.log(`- ${label}`)
  }
  console.log(`Total: ${current.reduce((sum, entry) => sum + entry.count, 0)} occurrences in ${counts.size} files`)
  process.exit(0)
}

if (current.length > 0 || missingModelLabels.length > 0) {
  console.error(`i18n visible-text gate requires zero untranslated literals; found ${current.reduce((sum, entry) => sum + entry.count, 0)} visible literals and ${missingModelLabels.length} model labels`)
  for (const entry of current.slice(0, 100)) {
    console.error(`- ${entry.file} [${entry.kind}] ${JSON.stringify(entry.text)} (x${entry.count})`)
  }
  for (const label of missingModelLabels.slice(0, 100)) {
    console.error(`- missing model-display translation: ${JSON.stringify(label)}`)
  }
  process.exit(1)
}
console.log('i18n visible-text gate passed (zero visible literals)')
