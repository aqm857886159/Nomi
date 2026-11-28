// 「这个模型现在能不能用」与「模型状态怎么展示」单一主人 ESLint 规则及普查元数据（SM-gates-B2 收口自原 check-model-availability.mjs）。
//
// 判据唯一主人：electron/shared/modelAvailability.ts 的 deriveModelAvailability
//   可用 = 供应商在且启用 → 模型启用 → 目录发布资格成立 → 这家的钥匙此刻解得开
// 结论随每行模型以 `availability` 过 IPC 下发，渲染层不重算。
//
// 本模块供两处共用：
//   ① eslint.config.mjs（`nomi/model-status-one-home`）：单遍拦截退役验证原料/状态词出口旁路（scanAvailabilityBypasses）
//      与未登记的「凭据词 && 发布/启用词」第二份判据（scanSource）；
//   ② scripts/model-status-one-home.test.mjs（Vitest + pre-push SCAN_GUARDS）：核对 18 个 READERS 接线存活、
//      OWNER 导出完好、VENDOR_CONNECTION_PREDICATES 无陈旧豁免。

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const OWNER = 'electron/shared/modelAvailability.ts'
export const CATALOG_BINDING = 'electron/catalog/catalogModelAvailability.ts'
export const RENDERER_GATE = 'src/config/modelCatalogCache.ts'

/** owner 的结论长什么样——读者引用其中任意一个，就算在消费它。 */
export const OWNER_SYMBOLS = [
  'deriveModelAvailability',
  'createCatalogAvailability',
  'catalogModelAvailability',
  'catalogModelIsUsable',
  'keepUsableModelRows',
  'availability',
]

/**
 * 普查表：每个回答「现在有哪些模型能用 / X 角色能用哪些」的读者。
 * `question` 是它对用户说的那句话，`reads` 是它现在读谁。改动这张表 = 改动这条不变量的边界。
 */
export const READERS = [
  { file: 'electron/catalog/catalogStore.ts', question: '目录投影：每行模型的 availability（渲染层全部读者的上游）', reads: 'createCatalogAvailability' },
  { file: 'electron/catalog/catalogHealth.ts', question: '目录健康度里的「可执行模型」计数', reads: 'createCatalogAvailability' },
  { file: 'electron/catalog/executableModel.ts', question: '真要发请求时这条模型能不能执行', reads: 'catalogModelAvailability' },
  { file: 'electron/catalog/modelCatalogListing.ts', question: 'MCP list_models 对外的 usable / statusReason', reads: 'createCatalogAvailability' },
  { file: 'electron/ai/textBrainResolver.ts', question: '首页横幅「创作助手连没连上模型」+ 选哪个文本大脑', reads: 'createCatalogAvailability' },
  { file: 'electron/capabilityCore/generationDefaultModelResolver.ts', question: 'Agent 建分镜时的图片/视频默认模型', reads: 'createCatalogAvailability' },
  { file: 'electron/capabilityCore/moduleCatalogBootstrap.ts', question: 'nomi_generation_plan 的语义能力注册表（钥匙那几档按层放行，见文件内注释）', reads: 'createCatalogAvailability' },
  { file: 'electron/capabilityCore/usableVideoModelCandidates.ts', question: '可用视频模型清单（应用内与 MCP 共用同一份，每次问都现算）', reads: 'createCatalogAvailability' },
  { file: 'electron/providerAdapter/serviceLanguageModels.ts', question: '适配器可用的语言模型', reads: 'createCatalogAvailability' },
  { file: 'src/config/modelCatalogCache.ts', question: '渲染层第一道闸：画布/分镜所有选择器的选项', reads: 'keepUsableModelRows(availability)' },
  { file: 'src/workbench/ai/assistantModelIdentity.ts', question: '创作助手模型下拉（可用性 + 文本角色）', reads: 'model.availability' },
  { file: 'src/workbench/settings/defaultGenerationModelOptions.ts', question: 'Agent 面板「图片默认 / 视频默认」两行', reads: 'model.availability' },
  { file: 'src/workbench/generationCanvas/runner/usableVendorModel.ts', question: '旧节点重解析时选哪条模型', reads: 'model.availability' },
  { file: 'src/workbench/generationCanvas/runner/catalogTaskResolve.ts', question: '节点执行前的目录重解析', reads: 'model.availability' },
  { file: 'src/ui/onboarding/modelSettingsCatalogProjection.ts', question: '设置页 chip 投影（把 availability 带进渲染层）', reads: 'row.availability' },
  { file: 'src/ui/onboarding/modelSettingsHomeState.ts', question: '设置 → 模型 每行状态与「N 个可使用」', reads: 'model.availability' },
  { file: 'src/ui/onboarding/OnboardingDrawer.tsx', question: '接入抽屉「这家的模型已上线 / N 个」', reads: 'model.availability' },
  { file: 'src/ui/onboarding/onboardingDrawerDerivations.ts', question: '接入抽屉「这一类你已经覆盖了吗」', reads: 'model.availability' },
]

/**
 * **答的是另一个问题**的谓词：它们问「这家连上了没」，不是「这个模型现在能不能用」。
 * 每条都必须写清理由；新增未登记的一律红。
 */
export const VENDOR_CONNECTION_PREDICATES = {
  'electron/catalog/catalogHealth.ts': '健康度里的 enabledApiKeys 统计的是「钥匙」不是「模型」',
  'src/ui/onboarding/onboardingDrawerConnections.ts': '抽屉卡片分组「已连接 / 可添加」，问的是连接本身',
  'src/workbench/settings/settingsAutomationView.ts': '自动化设置里的连接状态灯（connected / disconnected）',
}

const CREDENTIAL = /\b(hasApiKey|apiKeyDecryptStatus|decryptApiKeyRecord|apiKeysByVendor|credentialStatus|keyStatus)\b/
const PUBLICATION = /\b(published|publishedModes|modelHasPublishedExecution|derivePublishedExecution)\b|\.enabled\b/

/** 扫「凭据词 && 发布/启用词」形状的布尔表达式，只记最外层那一个（嵌套的是同一处）。 */
export function scanSource(relative, text) {
  if (!CREDENTIAL.test(text)) return []
  const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found = []
  const visit = (node, insideHit) => {
    let hit = insideHit
    if (!insideHit && ts.isBinaryExpression(node)
      && (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || node.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      const expression = node.getText(source)
      if (CREDENTIAL.test(expression) && PUBLICATION.test(expression)) {
        found.push({
          file: relative,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          expression: expression.replace(/\s+/g, ' ').slice(0, 120),
        })
        hit = true
      }
    }
    ts.forEachChild(node, (child) => visit(child, hit))
  }
  visit(source, false)
  return found
}

/** 退役的预检原料和状态出口不准重生。 */
export function scanAvailabilityBypasses(relative, text) {
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(relative) || relative.includes('/devlab/')) return []
  const renderer = relative.startsWith('src/')
  const execution = ['electron/runtime.ts', 'electron/textTaskRunner.ts', 'electron/providerAdapter/serviceCatalog.ts'].includes(relative)
  const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found = []
  const report = (node, message) => found.push({ file: relative, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, message })
  const property = (node) => ts.isPropertyAccessExpression(node) ? node.name.text
    : ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null
  const visit = (node) => {
    if (relative === 'electron/main.ts' && ts.isCallExpression(node) && node.expression.getText(source) === 'listModelCatalogModels') {
      const map = node.parent
      if (!ts.isPropertyAccessExpression(map) || map.name.text !== 'map' || !ts.isCallExpression(map.parent)
        || map.parent.arguments[0]?.getText(source) !== 'projectRendererCatalogModel') report(node, '目录跨 IPC 只交剥掉验证原料的投影')
    }
    if (renderer && relative !== 'src/ui/onboarding/ModelStatusMark.tsx' && ts.isConditionalExpression(node)
      && /availability|modelStatus|status\.state/.test(node.condition.getText(source))
      && (ts.isStringLiteralLike(node.whenTrue) || ts.isStringLiteralLike(node.whenFalse))
      && /(?:text|bg|border)-(?:workbench-success|workbench-danger|nomi-warning)/.test(`${node.whenTrue.getText(source)} ${node.whenFalse.getText(source)}`)) report(node, '状态颜色只读展示投影，不按可用性另挑色')
    if (ts.isIdentifier(node)) {
      if (['revalidatePendingCredential', 'probeAdapterCredential', 'recordModelExecutionResult', 'testConnection'].includes(node.text)) report(node, '退役的模型预检不能回到生产入口')
      if ((renderer || execution) && ['credentialVerificationPending', 'adapterState'].includes(node.text)) report(node, '只读 availability 与 formatInProgress，不读验证原料')
      if ((execution || renderer && !relative.endsWith('/ComfyuiWorkflowSettingsPage.tsx')) && node.text === 'verificationPending') report(node, '首用与展示不读旧待验证标记')
    }
    if (renderer && ['state', 'evidence'].includes(property(node)) && /adapter/i.test(node.expression.getText(source))) report(node, '渲染层不读原始 adapter 验证结果；当前状态读投影')
    if (ts.isStringLiteralLike(node)) {
      const value = node.text
      if ((renderer || execution) && ['credentialVerificationPending', 'adapterState', 'verificationPending'].includes(value)) report(node, '界面和发送入口不读验证原料')
      if (['nomi:onboarding:test-connection', 'modelSetup.testConnection', 'testConnection'].includes(value)) report(node, '测试连接入口已删除')
      if (renderer && relative !== 'src/ui/onboarding/ModelStatusMark.tsx' && !relative.startsWith('src/i18n/')
        && /^onboardingProviders\.(modelStatus\.|adapterVerification\.(cardStatus|modelState)\.|workspace\.adapter\.title\.|vendorCard\.modelsAvailable|drawer\.home\.(verificationFailedUsable|unreachableCount)|keyOnly\.(pendingTitle|recheckedTitle|offlineTitle))/.test(value)) report(node, '状态词只经 ModelStatusMark 渲染')
      if (renderer && /^(generationCommon\.)?parameters\.untried$/.test(value)) report(node, '模型框不再显示未试跑')
    }
    if (execution && ts.isCallExpression(node) && /^(probeDirectKeyCredential|validateCandidateCredential|fetchModelList)$/.test(property(node.expression) ?? node.expression.getText(source))) report(node, '保存时的拒收闸不能接在发送入口')
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const SECOND_AVAILABILITY_MESSAGE =
  '「这个模型现在能不能用」只有一份判据（electron/shared/modelAvailability.ts 的 deriveModelAvailability）：请读 model.availability 或 createCatalogAvailability(state)；若确为回答「这家连上了没」，须在 scripts/model-status-one-home.mjs 的 VENDOR_CONNECTION_PREDICATES 登记理由。'

export const modelStatusOneHomeRule = {
  meta: { type: 'problem', schema: [], messages: { bypass: '{{message}}' } },
  create(context) {
    return {
      Program() {
        const relative = path.relative(ROOT, context.filename).split(path.sep).join('/')
        if (/\.(test|spec|d)\.[cm]?[jt]sx?$/.test(relative) || relative.includes('/devlab/')) return
        const text = context.sourceCode.text
        for (const finding of scanAvailabilityBypasses(relative, text)) {
          context.report({ loc: { line: finding.line, column: 0 }, messageId: 'bypass', data: { message: finding.message } })
        }
        if (relative !== OWNER && relative !== CATALOG_BINDING && !(relative in VENDOR_CONNECTION_PREDICATES)) {
          for (const finding of scanSource(relative, text)) {
            context.report({
              loc: { line: finding.line, column: 0 },
              messageId: 'bypass',
              data: { message: `${SECOND_AVAILABILITY_MESSAGE}（命中：${finding.expression}）` },
            })
          }
        }
      },
    }
  },
}
