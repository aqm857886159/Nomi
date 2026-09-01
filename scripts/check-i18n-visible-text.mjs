import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const ROOT = process.cwd()
const SRC_ROOT = path.join(ROOT, 'src')
const ELECTRON_ROOT = path.join(ROOT, 'electron')
const MODEL_DISPLAY_TEXT_FILE = path.join(SRC_ROOT, 'i18n', 'locales', 'modelDisplayText.ts')
// 主进程可见文案是**收缩基线**（不是硬零）：src/ 那半边已经清干净、走硬零；electron/ 这半边
// 还压着 ~一叠没走 desktopT 的中文 throw / dialog 文案。硬零会一次性红几百行、把这个 PR 撑爆，
// 所以先把当前存量拍成基线快照、棘轮只减不增——新写一句中文 throw 当场报红，存量按 electron/i18n.ts
// 的 desktopT / 错误码路径分批清零，基线随之往下走。与 check:heavy-path 同一套做法。
const ELECTRON_BASELINE_FILE = path.join(ROOT, 'scripts', 'i18n-electron-baseline.json')
const REPORT = process.argv.includes('--report')
const UPDATE_ELECTRON_BASELINE = process.argv.includes('--update-electron-baseline')

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
// 2026-09-01 摘除两条:modelArchetypes/ 与 shared/videoCapabilities/ 的英文标签已由 #241 补齐(108 个),
// 不再需要整目录豁免——它们的档案标签走 collectUntranslatedModelLabels 的 model-display 边界校验,
// 有漏网当场报红(补翻译,别回加排除)。
const EXCLUDED_PREFIXES = [
  'src/i18n/', // translation resources themselves
  'src/devlab/',
  'electron/capabilityCore/', // MCP/RPC schemas and agent-facing protocol text
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
  'electron/harness/tools/generationDescriptors.ts', // agent-facing generation tool schemas/descriptions (LLM protocol text, not UI copy)
  'electron/promptLibrary/promptSources.ts', // external curated source names
])

// 模型档案规格目录:这里的 label/hint/placeholder 等展示属性**全部走 translateModelDisplayText
// 渲染层边界翻译**(nodeModelArchetype.ts:104 `label: translateModelDisplayText(control.label)`),
// 源里留中文是刻意的、稳定的档案键。这些字的漏译由 collectUntranslatedModelLabels 逐个对 modelDisplayText
// 词典校验(缺一个当场红),而不是靠「源里有没有中文字面量」那条泛化规则——后者会把每个已翻译的档案标签
// 都误报成漏译(2026-09-01 摘掉整目录豁免后,泛化 object-prop 规则一次照出 648 个这类误报)。
// 于是:泛化 object-prop 规则**跳过**这些目录,改由 collector 按翻译契约校验(严格更强,不是更弱)。
const MODEL_SPEC_PREFIXES = [
  'src/config/modelArchetypes/',
  'electron/shared/videoCapabilities/',
  'electron/catalog/', // 供应商目录里的档案标签,与 modelArchetypes 同走 model-display 边界
]
function isModelSpecDir(relative) {
  return MODEL_SPEC_PREFIXES.some((prefix) => relative.startsWith(prefix))
}

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

// 主进程侧「用户会读到的字」的形状,与渲染层完全不同——没有 JSX,中文都藏在:
//   ① throw new Error('中文') —— 抛给渲染层、由错误卡/对话框原样显给用户(configVerify、素材校验、导出…)
//   ② reject('中文') / reject(new Error('中文')) —— 同上,Promise 链上的失败原因
//   ③ { message | detail | title: '中文' } —— Electron dialog.showMessageBox / showErrorBox 的字段
// 这些**不是**喂模型的提示词(那些住在被排除的 agent/prompt/catalog-descriptor 目录),而是主进程直接
// 递给人看的。渲染层的 return-literal 规则一条都盖不到它们(electron 里没有 render-adjacent 概念)。
const ELECTRON_ERROR_CTORS = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'EvalError', 'URIError'])
const ELECTRON_VISIBLE_PROPERTIES = new Set(['message', 'detail', 'title'])
// electron/ 里**喂模型/协议**而非给人看的中文,与 src 侧同源:agent 上下文、MCP/RPC schema、
// 判官/技能提示词模板。范围刻意窄——只排真喂模型的,凡是抛给渲染层显给用户的一律不排:
// 比如 promptLibrary/userPromptStore.ts 的「提示词不能为空」是用户存空提示词时的报错,必须拦。
const ELECTRON_EXCLUDED_PREFIXES = [
  'electron/capabilityCore/', // MCP/RPC schema 与 agent-facing 协议文本(已在 EXCLUDED_PREFIXES 内,这里再声明保持自洽)
  'electron/harness/', // agent 上下文/工具协议/判官提示词(实测:零 CJK throw,排除仅为自洽)
]
const ELECTRON_EXCLUDED_FILES = new Set([
  'electron/ai/composeAgentSystemPrompt.ts', // agent system prompt 拼装,喂模型
  'electron/skills/playbookOrchestrator.ts', // playbook 阶段定义校验(阶段 id 重复/循环依赖),开发者写档时命中,非终端用户
])

function isElectronVisibleScope(relative) {
  return (
    relative.startsWith('electron/') &&
    !ELECTRON_EXCLUDED_PREFIXES.some((prefix) => relative.startsWith(prefix)) &&
    !ELECTRON_EXCLUDED_FILES.has(relative)
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
  const electronVisible = isElectronVisibleScope(relative)

  function add(kind, text) {
    const normalized = normalizeText(text)
    if (!hasVisibleWords(normalized)) return
    findings.push({ file: relative, kind, text: normalized, channel: 'src' })
  }

  // 主进程侧的可见文案单独记账(channel:'electron'),走收缩基线而非硬零。只在 electron 可见范围内触发。
  function addElectron(kind, text) {
    const normalized = normalizeText(text)
    if (!hasHan(normalized)) return
    findings.push({ file: relative, kind, text: normalized, channel: 'electron' })
  }

  function visit(node) {
    if (electronVisible) {
      // throw new Error('中文') / new TypeError('中文') …——抛给渲染层原样显给用户。
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        ELECTRON_ERROR_CTORS.has(node.expression.text) &&
        node.arguments &&
        node.arguments[0]
      ) {
        collectExpressionLiterals(node.arguments[0], (text) => addElectron('throw-error', text))
      }
      // reject('中文')——Promise 失败原因,同样会走到用户面前。reject(new Error('中文')) 由上面那条覆盖。
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'reject' &&
        node.arguments[0]
      ) {
        collectExpressionLiterals(node.arguments[0], (text) => addElectron('reject', text))
      }
      // { message | detail | title: '中文' }——Electron 原生对话框字段。
      if (ts.isPropertyAssignment(node)) {
        const propertyName =
          ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : ''
        if (ELECTRON_VISIBLE_PROPERTIES.has(propertyName)) {
          collectExpressionLiterals(node.initializer, (text) => addElectron(`dialog-prop:${propertyName}`, text))
        }
      }
    }

    if (ts.isJsxText(node)) add('jsx-text', node.text)

    if (ts.isJsxAttribute(node) && VISIBLE_ATTRIBUTES.has(node.name.text)) {
      const initializer = node.initializer
      if (initializer && ts.isStringLiteral(initializer)) add(`jsx-attr:${node.name.text}`, initializer.text)
      if (initializer && ts.isJsxExpression(initializer) && initializer.expression) {
        collectExpressionLiterals(initializer.expression, (text) => add(`jsx-attr:${node.name.text}`, text))
      }
    }

    // 泛化 object-prop 规则跳过模型档案规格目录:那里的 label/hint/placeholder 走 model-display 边界,
    // 由 collectUntranslatedModelLabels 按翻译契约校验(见 MODEL_SPEC_PREFIXES 注释)。throw/dialog 那几条
    // 主进程规则不受此影响——档案目录里真正抛给用户的报错照样进 electron 基线。
    if (ts.isPropertyAssignment(node) && !isModelSpecDir(relative)) {
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

const MODEL_DISPLAY_SOURCE_PROPERTIES = ['label', 'hint', 'placeholder', 'description', 'emptyText', 'emptyTitle', 'vendorTerm']

function collectUntranslatedModelLabels() {
  const sourceRoots = [
    path.join(SRC_ROOT, 'config', 'modelArchetypes'),
    path.join(ELECTRON_ROOT, 'catalog'),
    path.join(ELECTRON_ROOT, 'shared', 'videoCapabilities'),
  ]
  const sourceLabels = new Set()
  const propAlt = MODEL_DISPLAY_SOURCE_PROPERTIES.join('|')
  const propRe = new RegExp(
    String.raw`\b(?:` + propAlt + String.raw`)\s*:\s*(?:'([^']*` + '[\\u3400-\\u9fff]' + String.raw`[^']*)'|"([^"]*` + '[\\u3400-\\u9fff]' + String.raw`[^"]*)"|` +
      '`([^`$]*[\\u3400-\\u9fff][^`$]*)`)',
    'g',
  )
  for (const root of sourceRoots) {
    // 与主扫描同一套 isProductSource 过滤:测试夹具里的 `label: "图"` 不是真档案标签,
    // 要求给它一份英文译名毫无意义(2026-08-28:main 新增的 catalogMigrateV11.test.ts 就这么把门岗弄红了)。
    const files = ts.sys.readDirectory(root, ['.ts', '.tsx'], undefined, undefined).filter(isProductSource)
    for (const fileName of files) {
      const sourceText = fs.readFileSync(fileName, 'utf8')
      // label \u4e4b\u5916\u4e5f\u6536 hint/placeholder/description \u7b49\u6863\u6848\u5c55\u793a\u5c5e\u6027;\u8df3\u8fc7\u542b ${\u2026} \u7684\u6a21\u677f\u4e32(\u8fd0\u884c\u671f\u7b97\u51fa,\u975e\u6863\u6848\u952e)\u3002
      for (const match of sourceText.matchAll(propRe)) {
        sourceLabels.add(normalizeText(match[1] || match[2] || match[3]))
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

// 两条渠道分开记账:
//   · src/ 侧 = **硬零**,没有基线、没有豁免名单(2026-08-28 那批 return-literal/`||`兜底串已清零)。
//   · electron/ 侧 = **收缩基线**(scripts/i18n-electron-baseline.json,按文件记 count,棘轮只减不增)。
//     主进程可见文案存量还压着一叠,硬零会撑爆 PR;先拍快照、新增当场红、存量走 desktopT 分批清零。
const srcFindings = allFindings.filter((entry) => entry.channel === 'src')
const electronFindings = allFindings.filter((entry) => entry.channel === 'electron')

// electron 基线按 file → 该文件出现次数 记(count 含重复),点开就是要清的那一处。
function tallyByFile(findings) {
  const byFile = new Map()
  for (const entry of findings) byFile.set(entry.file, (byFile.get(entry.file) ?? 0) + entry.count)
  return byFile
}
const electronByFile = tallyByFile(electronFindings)

if (UPDATE_ELECTRON_BASELINE) {
  const next = Object.fromEntries([...electronByFile.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en')))
  fs.writeFileSync(ELECTRON_BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`)
  const total = [...electronByFile.values()].reduce((sum, n) => sum + n, 0)
  console.log(`✅ 已写入 electron 可见文案基线:${electronByFile.size} 文件 / ${total} 处`)
  process.exit(0)
}

const electronBaseline = fs.existsSync(ELECTRON_BASELINE_FILE)
  ? JSON.parse(fs.readFileSync(ELECTRON_BASELINE_FILE, 'utf8'))
  : {}

if (REPORT) {
  const counts = new Map()
  for (const entry of allFindings) counts.set(entry.file, (counts.get(entry.file) ?? 0) + entry.count)
  for (const [file, count] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))) {
    console.log(`${String(count).padStart(4)} ${file}`)
  }
  if (missingModelLabels.length > 0) {
    console.log(`Missing model-display translations: ${missingModelLabels.length}`)
    for (const label of missingModelLabels) console.log(`- ${label}`)
  }
  const srcTotal = srcFindings.reduce((sum, entry) => sum + entry.count, 0)
  const electronTotal = [...electronByFile.values()].reduce((sum, n) => sum + n, 0)
  console.log(`Src (hard-zero): ${srcTotal} occurrences`)
  console.log(`Electron (baseline): ${electronTotal} occurrences in ${electronByFile.size} files`)
  console.log(`Total: ${allFindings.reduce((sum, entry) => sum + entry.count, 0)} occurrences in ${counts.size} files`)
  process.exit(0)
}

let failed = false

// src/ 侧硬零。
if (srcFindings.length > 0 || missingModelLabels.length > 0) {
  failed = true
  const srcTotal = srcFindings.reduce((sum, entry) => sum + entry.count, 0)
  console.error(`i18n visible-text gate (src) requires zero untranslated literals; found ${srcTotal} visible literals and ${missingModelLabels.length} model labels`)
  for (const entry of srcFindings.slice(0, 100)) {
    console.error(`- ${entry.file} [${entry.kind}] ${JSON.stringify(entry.text)} (x${entry.count})`)
  }
  for (const label of missingModelLabels.slice(0, 100)) {
    console.error(`- missing model-display translation: ${JSON.stringify(label)}`)
  }
}

// electron/ 侧棘轮:任何文件的计数超过基线即红;基线里没有的文件(新引入中文)也红。
const electronRegressions = []
for (const [file, count] of electronByFile) {
  const allowed = Number.isFinite(electronBaseline[file]) ? electronBaseline[file] : 0
  if (count > allowed) electronRegressions.push({ file, count, allowed })
}
if (electronRegressions.length > 0) {
  failed = true
  console.error(`\ni18n visible-text gate (electron) 棘轮未通过——主进程新增了未走 desktopT 的中文文案(只减不增):`)
  for (const { file, count, allowed } of electronRegressions.sort((a, b) => b.count - a.count).slice(0, 40)) {
    console.error(`- ${file}  基线 ${allowed} → 现在 ${count}(新增 ${count - allowed})`)
    for (const entry of electronFindings.filter((e) => e.file === file).slice(0, 6)) {
      console.error(`    [${entry.kind}] ${JSON.stringify(entry.text)}`)
    }
  }
  console.error(`  → 走 electron/i18n.ts 的 desktopT(加一对 zh/en key)或错误码路径;确实是内部不变量断言(用户读不到)才考虑排除,每条写明理由。`)
  console.error(`  基线文件:scripts/i18n-electron-baseline.json;重拍快照:node scripts/check-i18n-visible-text.mjs --update-electron-baseline`)
}

if (failed) process.exit(1)

const electronTotal = [...electronByFile.values()].reduce((sum, n) => sum + n, 0)
console.log(`i18n visible-text gate passed (src hard-zero; electron baseline ${electronTotal} occurrences in ${electronByFile.size} files, shrink-only)`)
