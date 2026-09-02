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
  'electron/shared/audioCapabilities/', // 音频侧的 wire 事实表(档案 params 由它构建),同走 model-display 边界
  'electron/catalog/', // 供应商目录里的档案标签,与 modelArchetypes 同走 model-display 边界
]
function isModelSpecDir(relative) {
  return MODEL_SPEC_PREFIXES.some((prefix) => relative.startsWith(prefix))
}

/** 测试/夹具文件:两条扫描都不该管它们(夹具里的 `label: "图"` 不是真档案标签)。 */
function isTestLike(relative) {
  return relative.includes('/__tests__/') || /\.(?:test|spec|stories)\.[cm]?[jt]sx?$/.test(relative)
}

function isProductSource(fileName) {
  const relative = path.relative(ROOT, fileName).replaceAll('\\', '/')
  return (
    !EXCLUDED_PREFIXES.some((prefix) => relative.startsWith(prefix)) &&
    !EXCLUDED_FILES.has(relative) &&
    !isTestLike(relative)
  )
}

// 模型档案的**翻译契约**扫描范围:只摘测试夹具,**不**套 EXCLUDED_FILES。
// 那份名单是给「源里有中文字面量就算漏译」那条泛化规则用的豁免,豁免理由恰恰是
// 「这些标签走 model-display 边界翻译」——而边界有没有真翻,正是本扫描要验的事。
// 两处共用一个 filter 时,豁免会把两道网**一起**关掉:comfyuiLocal.ts 的
// `labelZh: "本地 · 文生图"` 就这么两头落空,en 界面上一直是中文(2026-09-02 走查抓到)。
function isModelSpecSource(fileName) {
  return !isTestLike(path.relative(ROOT, fileName).replaceAll('\\', '/'))
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

// labelZh = 模型档案的展示名(设置→模型 的模型 chip、设置→AI 的模型下拉都显示它)。名字里的 "Zh"
// 只说明**源值**是中文,不代表它不该被翻译:它和 label 一样过 translateModelDisplayText 边界。
// 2026-09-02 之前它不在这张表里,于是「可灵 3.0」这类展示名漏译对 CI 完全隐形。
const MODEL_DISPLAY_SOURCE_PROPERTIES = ['label', 'hint', 'placeholder', 'description', 'emptyText', 'emptyTitle', 'vendorTerm', 'labelZh']

function readTranslatedLabels() {
  const translationSource = fs.readFileSync(MODEL_DISPLAY_TEXT_FILE, 'utf8')
  const translatedLabels = new Set()
  for (const match of translationSource.matchAll(/^\s*(?:'([^']+)'|"([^"]+)"|([㐀-鿿][^:]*))\s*:/gm)) {
    translatedLabels.add(normalizeText(match[1] || match[2] || match[3]))
  }
  return translatedLabels
}

function collectUntranslatedModelLabels() {
  const sourceRoots = [
    path.join(SRC_ROOT, 'config', 'modelArchetypes'),
    path.join(ELECTRON_ROOT, 'catalog'),
    path.join(ELECTRON_ROOT, 'shared', 'videoCapabilities'),
    path.join(ELECTRON_ROOT, 'shared', 'audioCapabilities'),
  ]
  const sourceLabels = new Set()
  const propAlt = MODEL_DISPLAY_SOURCE_PROPERTIES.join('|')
  const propRe = new RegExp(
    String.raw`\b(?:` + propAlt + String.raw`)\s*:\s*(?:'([^']*` + '[\\u3400-\\u9fff]' + String.raw`[^']*)'|"([^"]*` + '[\\u3400-\\u9fff]' + String.raw`[^"]*)"|` +
      '`([^`$]*[\\u3400-\\u9fff][^`$]*)`)',
    'g',
  )
  for (const root of sourceRoots) {
    // 只摘测试夹具:夹具里的 `label: "图"` 不是真档案标签,要求给它英文译名毫无意义
    // (2026-08-28:main 新增的 catalogMigrateV11.test.ts 就这么把门岗弄红了)。
    const files = ts.sys.readDirectory(root, ['.ts', '.tsx'], undefined, undefined).filter(isModelSpecSource)
    for (const fileName of files) {
      const sourceText = fs.readFileSync(fileName, 'utf8')
      // label \u4e4b\u5916\u4e5f\u6536 hint/placeholder/description \u7b49\u6863\u6848\u5c55\u793a\u5c5e\u6027;\u8df3\u8fc7\u542b ${\u2026} \u7684\u6a21\u677f\u4e32(\u8fd0\u884c\u671f\u7b97\u51fa,\u975e\u6863\u6848\u952e)\u3002
      for (const match of sourceText.matchAll(propRe)) {
        sourceLabels.add(normalizeText(match[1] || match[2] || match[3]))
      }
    }
  }
  const translatedLabels = readTranslatedLabels()
  return [...sourceLabels].filter((label) => !translatedLabels.has(label)).sort((a, b) => a.localeCompare(b, 'en'))
}

// ---------------------------------------------------------------------------
// \u4f9b\u5e94\u5546\u5c55\u793a\u540d\u8fb9\u754c(2026-09-02 \u52a0)
//
// \u4e3a\u4ec0\u4e48\u5355\u5f00\u4e00\u6761\u3001\u800c\u4e0d\u662f\u628a `name` \u585e\u8fdb MODEL_DISPLAY_SOURCE_PROPERTIES:
// `name` \u5728\u8fd9\u51e0\u4e2a\u76ee\u5f55\u91cc\u662f**\u4e24\u65cf\u5b8c\u5168\u4e0d\u540c\u7684\u4e1c\u897f**,\u53ea\u6709\u4e00\u65cf\u7ed9\u4eba\u770b\u2014\u2014
//   \u2460 \u4f9b\u5e94\u5546\u79cd\u5b50\u7684 name(VENDOR_SEED.name)= \u8bbe\u7f6e\u2192\u6a21\u578b \u91cc\u90a3\u4e00\u884c\u6807\u9898,
//      \u7ecf src/ui/onboarding/ModelSettingsHome.tsx:164 `translateModelDisplayText(connection.name)`
//      \u6e32\u67d3,\u6f0f\u8bd1\u5c31\u76f4\u63a5\u662f\u82f1\u6587\u754c\u9762\u4e0a\u7684\u4e2d\u6587(2026-09-02 \u8d70\u67e5\u6293\u5230\u7684\u300c\u706b\u5c71\u65b9\u821f\u300d)\u3002
//   \u2461 catalog mapping \u7684 name(Mapping.name,electron/catalog/types.ts:476)= \u5185\u90e8\u6e20\u9053\u540d,
//      electron/catalog/nativeWireProfiles.ts:23 \u5199\u660e\u300c\u975e UI \u6587\u6848\u300d,\u6e32\u67d3\u5c42\u4ece\u4e0d\u8bfb\u5b83
//      (\u5168\u4ed3 src/ \u91cc `mapping.name` \u96f6\u547d\u4e2d;\u8bbe\u7f6e\u9875\u663e\u793a\u7684\u662f Model.labelZh)\u3002
// \u6cdb\u5316\u5c5e\u6027\u540d\u89c4\u5219\u5206\u4e0d\u5f00\u8fd9\u4e24\u65cf:\u5b9e\u6d4b\u628a `name` \u52a0\u8fdb MODEL_DISPLAY_SOURCE_PROPERTIES \u4f1a\u4e00\u6b21\u8981 53 \u6761\u8bd1\u6587,
// \u5176\u4e2d 49 \u6761\u662f \u2461\u300cSeedance 2.0 \u00b7 \u9996\u5e27\u300d\u8fd9\u7c7b\u5185\u90e8\u6e20\u9053\u540d\u2014\u2014\u7ed9\u5b83\u4eec\u9020\u82f1\u6587\u8bcd\u6761\u53ea\u4f1a\u5f97\u5230 49 \u6761\u6b7b\u8bcd\u6761
// (\u503c\u5bf9\u4e0d\u4e0a\u4efb\u4f55\u6e32\u67d3\u70b9),\u95e8\u5c97\u53d8\u7eff\u800c\u754c\u9762\u6ca1\u53d8\u597d\u3002\u6240\u4ee5\u6309**\u6e32\u67d3\u8fb9\u754c**\u6536:\u53ea\u67e5\u771f\u6b63\u88ab seed \u51fa\u53bb\u7684\u4f9b\u5e94\u5546\u3002
//
// \u540d\u5355\u4ece BUILTIN_VENDOR_SEEDS \u8fd9\u4e2a\u65e2\u6709\u5355\u4e00\u771f\u76f8\u6e90\u73b0\u53d6(\u4e0d\u53e6\u6284\u4e00\u4efd\u540d\u5355,P1),\u987a import \u627e\u5230\u6bcf\u4e2a\u79cd\u5b50\u7684
// name \u5b57\u9762\u91cf\u3002\u597d\u5904\u662f\u65b0\u63a5\u4e00\u5bb6\u4f9b\u5e94\u5546\u81ea\u52a8\u7eb3\u7ba1;\u800c\u4e14\u80fd\u8986\u76d6\u4f4f electron/catalog/ \u4e4b\u5916\u7684\u79cd\u5b50\u2014\u2014
// LOCAL_TEXT_VENDOR_SEED \u5c31\u4f4f\u5728 electron/localRuntime/,\u4efb\u4f55\u6309\u76ee\u5f55\u626b\u7684\u5199\u6cd5\u90fd\u4f1a\u6f0f\u6389\u5b83(\u5b9e\u6d4b:\u5b83\u7684
// \u300c\u672c\u5730\u6a21\u578b\u300d\u6b64\u524d\u786e\u5b9e\u6ca1\u8bd1,\u548c\u300c\u706b\u5c71\u65b9\u821f\u300d\u540c\u4e00\u5929\u540c\u4e00\u4e2a\u6d1e)\u3002
const VENDOR_SEED_LIST_FILE = path.join(ELECTRON_ROOT, 'catalog', 'builtinVendorSeeds.ts')

// \u8bed\u8a00\u4e2d\u7acb\u7684\u54c1\u724c\u540d:\u79cd\u5b50\u91cc\u5b58\u7684\u5c31\u662f\u62c9\u4e01\u5199\u6cd5,\u82f1\u6587\u754c\u9762**\u539f\u6837\u663e\u793a\u5373\u6b63\u786e**,\u4e0d\u8be5\u9020\u82f1\u6587\u8bcd\u6761
// (\u786c\u9020\u4e00\u6761 'APIMart': 'APIMart' \u53ea\u662f\u628a\u8bcd\u5178\u6491\u5927,\u5e76\u4e0d\u89e3\u51b3\u4efb\u4f55\u95ee\u9898)\u3002
//
// \u6bcf\u6761\u5199\u660e\u7406\u7531;\u4f46\u7406\u7531\u672c\u8eab\u4e0d\u662f\u9760\u4eba\u8bfb\u6ce8\u91ca\u6765\u7ef4\u6301\u7684,\u4e0b\u9762 checkVendorSeedNames \u4f1a\u5f53\u65ad\u8a00\u9a8c:
//   \u00b7 \u8c41\u514d\u540d\u91cc\u4e00\u65e6\u6df7\u8fdb CJK \u2192 \u5f53\u573a\u7ea2(\u5b83\u4e0d\u518d\u8bed\u8a00\u4e2d\u7acb\u4e86,\u7406\u7531\u8fc7\u671f\u5373\u5931\u6548);
//   \u00b7 \u8c41\u514d\u9879\u5bf9\u4e0d\u4e0a\u4efb\u4f55\u5728\u518c\u79cd\u5b50(\u6539\u540d/\u4e0b\u7ebf)\u6216\u8be5\u540d\u5df2\u5728 seam \u91cc\u6709\u8bd1\u6587 \u2192 \u5f53\u573a\u7ea2(\u540d\u5355\u4e0d\u8bb8\u70c2\u5728\u8fd9\u513f)\u3002
//
// \u7406\u7531\u53ea\u5199**\u5df2\u7ecf\u786e\u8ba4\u7684\u4e8b**:\u6bcf\u6761\u7ed9\u7684\u662f\u8fd9\u4e2a\u540d\u5b57\u5728\u672c\u4ed3/\u8be5\u5bb6 baseUrl \u4e0a\u7684\u5b9e\u9645\u5199\u6cd5,
// \u800c\u4e0d\u662f\u300c\u8be5\u54c1\u724c\u6ca1\u6709\u4e2d\u6587\u540d\u300d\u2014\u2014\u540e\u8005\u662f\u4e2a\u6ca1\u53bb\u9010\u5bb6\u6838\u5b9e\u7684\u5426\u5b9a\u65ad\u8a00,\u4e0d\u8be5\u5199\u6210\u65e2\u6210\u4e8b\u5b9e\u3002
// \u67d0\u5bb6\u65e5\u540e\u542f\u7528\u5b98\u65b9\u4e2d\u6587\u54c1\u724c\u540d\u65f6,\u8981\u4eba\u628a\u5b83\u4ece\u8fd9\u5f20\u8868\u632a\u8fdb\u8bcd\u5178(\u540d\u5b57\u672c\u8eab\u6df7\u8fdb\u4e2d\u6587\u624d\u4f1a\u81ea\u52a8\u62a5\u7ea2)\u3002
const LOCALE_NEUTRAL_VENDOR_NAMES = new Map([
  ['Kie.ai', '\u5e73\u53f0\u54c1\u724c\u540d,\u79cd\u5b50 baseUrl api.kie.ai'],
  ['APIMart', '\u5e73\u53f0\u54c1\u724c\u540d,\u79cd\u5b50 baseUrl api.apimart.ai'],
  ['Agnes AI', '\u5e73\u53f0\u54c1\u724c\u540d,\u79cd\u5b50 baseUrl apihub.agnes-ai.com'],
  ['RunningHub', '\u5e73\u53f0\u54c1\u724c\u540d,\u79cd\u5b50 baseUrl www.runninghub.cn'],
  ['Replicate', '\u5e73\u53f0\u54c1\u724c\u540d,\u79cd\u5b50 baseUrl api.replicate.com'],
  ['fal.ai', '\u5e73\u53f0\u54c1\u724c\u540d,\u79cd\u5b50 baseUrl queue.fal.run(\u5168\u5c0f\u5199\u662f\u8be5\u5bb6\u81ea\u5df1\u7684\u5199\u6cd5)'],
  ['Runway Dev', 'Runway \u7684\u5f00\u53d1\u8005\u5e73\u53f0,\u79cd\u5b50 baseUrl api.dev.runwayml.com(Dev \u5373\u6307\u8fd9\u6761\u5f00\u53d1\u8005\u7aef\u70b9)'],
  ['Antigravity CLI', 'Google Antigravity \u672c\u673a CLI \u7684\u4ea7\u54c1\u540d;\u79cd\u5b50 baseUrl local://antigravity,\u65e0 HTTP \u7ad9'],
  ['MiniMax', '\u5382\u5546\u54c1\u724c\u540d,\u79cd\u5b50 baseUrl api.minimaxi.com;\u4ed3\u5185\u4e2d\u82f1\u6587\u6587\u6848\u5747\u5199 MiniMax(MiniMax H3 \u5404\u6761\u540c\u5199\u6cd5)'],
  ['ElevenLabs', '\u5382\u5546\u54c1\u724c\u540d,\u79cd\u5b50 baseUrl api.elevenlabs.io;\u4ed3\u5185\u5404\u6761\u540c\u5199\u6cd5(Eleven v3 / Eleven Music v2)'],
  ['Meshy', '\u5382\u5546\u54c1\u724c\u540d,\u79cd\u5b50 baseUrl api.meshy.ai;\u4ed3\u5185\u5404\u6761\u540c\u5199\u6cd5(Meshy 7)'],
])

/** \u89e3\u6790 BUILTIN_VENDOR_SEEDS \u540d\u5355 \u2192 \u6bcf\u4e2a\u79cd\u5b50\u7684 { ident, file, name }\u3002\u89e3\u6790\u4e0d\u51fa\u6765\u4e00\u5f8b\u629b(fail-closed)\u3002 */
function collectVendorSeedNames() {
  const listSource = ts.createSourceFile(
    VENDOR_SEED_LIST_FILE,
    fs.readFileSync(VENDOR_SEED_LIST_FILE, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const moduleOf = new Map()
  let identifiers = null
  listSource.forEachChild((node) => {
    if (
      ts.isImportDeclaration(node) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      for (const element of node.importClause.namedBindings.elements) {
        moduleOf.set(element.name.text, node.moduleSpecifier.text)
      }
    }
    if (!ts.isVariableStatement(node)) return
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'BUILTIN_VENDOR_SEEDS') continue
      let initializer = declaration.initializer
      while (initializer && (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer))) {
        initializer = initializer.expression
      }
      if (initializer && ts.isArrayLiteralExpression(initializer)) {
        identifiers = initializer.elements.filter(ts.isIdentifier).map((element) => element.text)
      }
    }
  })
  if (!identifiers || identifiers.length === 0) {
    throw new Error(
      `\u65e0\u6cd5\u4ece ${path.relative(ROOT, VENDOR_SEED_LIST_FILE)} \u89e3\u6790\u51fa BUILTIN_VENDOR_SEEDS \u6570\u7ec4\u2014\u2014` +
        `\u79cd\u5b50\u540d\u5355\u6362\u4e86\u5f62\u72b6\u5c31\u7b49\u4e8e\u8fd9\u6761\u95e8\u5c97\u9759\u9ed8\u5931\u6548,\u6545\u76f4\u63a5\u62a5\u9519\u800c\u4e0d\u662f\u8df3\u8fc7\u3002`,
    )
  }
  return identifiers.map((identifier) => {
    const specifier = moduleOf.get(identifier)
    const base = specifier ? path.resolve(path.dirname(VENDOR_SEED_LIST_FILE), specifier) : ''
    const file = ['.ts', '.tsx', '/index.ts'].map((suffix) => base + suffix).find((candidate) => fs.existsSync(candidate))
    if (!file) throw new Error(`\u4f9b\u5e94\u5546\u79cd\u5b50 ${identifier} \u7684\u5b9a\u4e49\u6587\u4ef6\u627e\u4e0d\u5230(import \u81ea ${specifier ?? '?'})`)
    const seedSource = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    let name = null
    seedSource.forEachChild((node) => {
      if (!ts.isVariableStatement(node)) return
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== identifier) continue
        let initializer = declaration.initializer
        while (initializer && (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer))) {
          initializer = initializer.expression
        }
        if (!initializer || !ts.isObjectLiteralExpression(initializer)) continue
        for (const property of initializer.properties) {
          if (!ts.isPropertyAssignment(property)) continue
          const propertyName = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : ''
          if (propertyName === 'name' && ts.isStringLiteral(property.initializer)) {
            name = normalizeText(property.initializer.text)
          }
        }
      }
    })
    if (name === null) {
      throw new Error(
        `\u4f9b\u5e94\u5546\u79cd\u5b50 ${identifier}(${path.relative(ROOT, file)})\u7684 name \u4e0d\u662f\u5b57\u7b26\u4e32\u5b57\u9762\u91cf,\u8bfb\u4e0d\u5230\u5c31\u6ca1\u6cd5\u6821\u9a8c\u8bd1\u540d\u2014\u2014` +
          `\u8bf7\u8ba9 name \u4fdd\u6301\u5b57\u9762\u91cf,\u6216\u5728\u6b64\u6269\u5c55\u89e3\u6790\u3002`,
      )
    }
    return { identifier, file: path.relative(ROOT, file).replaceAll('\\', '/'), name }
  })
}

/** \u4f9b\u5e94\u5546\u5c55\u793a\u540d:\u8981\u4e48\u5728 seam \u91cc\u6709\u8bd1\u6587,\u8981\u4e48\u5728\u8bed\u8a00\u4e2d\u7acb\u540d\u5355\u91cc\u767b\u8bb0\u4e14\u7406\u7531\u4ecd\u6210\u7acb\u3002 */
function checkVendorSeedNames(translatedLabels) {
  const seeds = collectVendorSeedNames()
  const untranslated = []
  const staleExemptions = []
  for (const seed of seeds) {
    if (translatedLabels.has(seed.name)) continue
    if (LOCALE_NEUTRAL_VENDOR_NAMES.has(seed.name)) {
      // \u8c41\u514d\u7406\u7531\u5f53\u65ad\u8a00\u9a8c:\u62c9\u4e01\u54c1\u724c\u540d\u4e00\u65e6\u63ba\u8fdb CJK,\u5b83\u5c31\u4e0d\u518d\u8bed\u8a00\u4e2d\u7acb,\u8c41\u514d\u4f5c\u5e9f\u3002
      if (hasHan(seed.name)) {
        untranslated.push({ ...seed, note: '\u5df2\u767b\u8bb0\u4e3a\u8bed\u8a00\u4e2d\u7acb\u54c1\u724c\u540d,\u4f46\u540d\u5b57\u91cc\u542b\u4e2d\u6587\u2014\u2014\u8c41\u514d\u7406\u7531\u5df2\u5931\u6548' })
      }
      continue
    }
    untranslated.push({ ...seed, note: '\u65e2\u6ca1\u6709\u82f1\u6587\u8bd1\u540d,\u4e5f\u6ca1\u767b\u8bb0\u4e3a\u8bed\u8a00\u4e2d\u7acb\u54c1\u724c\u540d' })
  }
  const seedNames = new Set(seeds.map((seed) => seed.name))
  for (const [name, reason] of LOCALE_NEUTRAL_VENDOR_NAMES) {
    if (!seedNames.has(name)) staleExemptions.push({ name, reason, why: '\u6ca1\u6709\u4efb\u4f55\u5728\u518c\u4f9b\u5e94\u5546\u79cd\u5b50\u53eb\u8fd9\u4e2a\u540d\u5b57' })
    else if (translatedLabels.has(name)) staleExemptions.push({ name, reason, why: 'seam \u91cc\u5df2\u7ecf\u6709\u5b83\u7684\u8bd1\u6587,\u8c41\u514d\u662f\u591a\u4f59\u7684' })
  }
  return { seeds, untranslated, staleExemptions }
}

const files = [SRC_ROOT, ELECTRON_ROOT]
  .flatMap((root) => ts.sys.readDirectory(root, ['.ts', '.tsx'], undefined, undefined))
  .filter(isProductSource)
const allFindings = countFindings(files.flatMap(scanFile))
const missingModelLabels = collectUntranslatedModelLabels()
const vendorNames = checkVendorSeedNames(readTranslatedLabels())

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
  console.log(
    `Vendor seed names: ${vendorNames.seeds.length} seeded, ` +
      `${LOCALE_NEUTRAL_VENDOR_NAMES.size} locale-neutral, ` +
      `${vendorNames.untranslated.length} unclassified, ${vendorNames.staleExemptions.length} stale exemptions`,
  )
  for (const seed of vendorNames.untranslated) console.log(`- ${seed.name} (${seed.identifier} @ ${seed.file})`)
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

// 供应商展示名(设置→模型 里的那行标题)也是硬零:每个在册种子的 name 要么有英文译名,
// 要么登记成语言中立品牌名;名单本身也不许烂掉。
if (vendorNames.untranslated.length > 0 || vendorNames.staleExemptions.length > 0) {
  failed = true
  console.error(`\ni18n visible-text gate (vendor seed names) 未通过——设置→模型 的供应商标题会在英文界面显示中文:`)
  for (const seed of vendorNames.untranslated) {
    console.error(`- ${JSON.stringify(seed.name)}  ${seed.identifier} @ ${seed.file}  —— ${seed.note}`)
  }
  for (const stale of vendorNames.staleExemptions) {
    console.error(`- 语言中立名单里的 ${JSON.stringify(stale.name)} 已失效:${stale.why}(登记理由:${stale.reason})`)
  }
  console.error(`  → 真该译的补进 src/i18n/locales/modelDisplayText.ts;`)
  console.error(`     全球统一拉丁写法的品牌名登记进 scripts/check-i18n-visible-text.mjs 的 LOCALE_NEUTRAL_VENDOR_NAMES 并写明理由。`)
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
