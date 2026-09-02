// i18n **键引用解析门岗**(2026-09-01)。
//
// 抓的是一类 parity/可见文案硬零/typecheck **三道都漏**的病:
//   组件 `t('sidebar.workflows')` 引用了一个**两边词典都不存在**的键 → i18next 找不到,
//   直接把**原始 key 字符串**渲染到界面上(`sidebar.workflows` 长得像英文,中文界面里一眼看不出)。
//
// 为什么现有三道拦不住:
//   ① check:i18n-key-parity 查的是 zh↔en **对称**(两边键集合一致)。而「两边都缺同一个键」
//      恰好是**平衡**的——parity 全绿。2026-09-01 实测:sidebar.workflows / sidebar.workflowLibrary /
//      sidebar.resize 三个键 zh=false en=false,parity 一个都报不出来。
//   ② check:i18n 可见文案硬零查的是「源码里有没有裸中文字面量」。raw key 是英文 ASCII,一个汉字没有,
//      照样绿。
//   ③ tsc:renderer 的 `t` 虽然 `CustomTypeOptions.resources = typeof zhCN`,但这版 i18next 的 TFunction
//      对未知点分键**回落 string**、不报类型错(2026-09-01 实测:上面三个坏引用 tsc 全绿,exit 0)。
//      于是类型系统这道也漏。
//
// 根治:**静态提取 src/ 全部翻译引用,逐个对照真实 resources 树验证可解析**;解析不到 = 红,输出 file:line。
// 与 electron 侧的 desktopT 不同——那边 key 是 `DesktopTranslationKey` 字面量联合,写错 key 直接是编译错,
// tsc 拦得住;renderer 这边的 `as 'literal'` 断言把类型检查绕过去了,才需要这道运行前的解析校验补上。
//
// 动态键(模板拼接 `t(`prefix.${x}`)`)走**显式前缀注册表** DYNAMIC_KEY_PREFIXES:每条前缀必须写清
//   ① 为什么是动态的 ② 运行时可能取到的成员从哪来(枚举来源)。裸动态键(前缀不在注册表)= 红。
// 前缀在注册表 → 校验该前缀在树里确实是一棵**子树**(有后代键),防「注册了一个根本不存在的前缀」。
//
// 加规则先验它会红(R17):拿 sidebar.workflows 场景做阳性对照——临时把该键从 sidebar 命名空间删掉,
// 确认门岗报红并打印 file:line,再恢复。见 docs/engineering-rules.md R15 节。

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import { zhCN, en } from '../src/i18n/resources'

const ROOT = process.cwd()
const SRC_ROOT = path.join(ROOT, 'src')
const REPORT = process.argv.includes('--report')

// ── 真实 resource 树(渲染层单一 default namespace,useTranslation() 全为裸调用、无 keyPrefix) ──
// 与 check-i18n-key-parity 同一套 flatten:叶子(string)记全路径,内部节点记为「有后代」。
type Tree = { leaves: Set<string>; subtrees: Set<string> }
function buildTree(node: unknown, prefix: string, tree: Tree): void {
  if (typeof node === 'string') {
    if (prefix) tree.leaves.add(prefix)
    return
  }
  if (node && typeof node === 'object') {
    if (prefix) tree.subtrees.add(prefix)
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      buildTree(value, prefix ? `${prefix}.${key}` : key, tree)
    }
  }
}

const zhTree: Tree = { leaves: new Set(), subtrees: new Set() }
const enTree: Tree = { leaves: new Set(), subtrees: new Set() }
buildTree(zhCN, '', zhTree)
buildTree(en, '', enTree)

// i18next 复数后缀:`t('key', { count })` 会解析到 `key_one` / `key_other` 等,基名本身**不作为叶子存在**。
// (spend.cost.text 就只有 text_one/text_other——调用 t('...text',{count}) 完全合法,但基名不是叶子。)
// 故判定「可解析」时,基名不在也算解析成功——只要任一复数变体在。CLDR 全部类别都覆盖上。
const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other']
function hasPluralLeaf(tree: Tree, key: string): boolean {
  return PLURAL_SUFFIXES.some((suffix) => tree.leaves.has(`${key}${suffix}`))
}

// 一个 key 可解析 = 在 zh 或 en 任一树里是叶子(或有复数变体叶子)。
// (parity 门岗保证两边对称;这里对两边取并集,是为了在 parity 尚未跑到时也能独立成立、并让报错聚焦
//  「谁都没有」这种最硬的坏引用——单边缺失由 parity 专管,不在这道重复报。)
function resolvesAsLeaf(key: string): boolean {
  return (
    zhTree.leaves.has(key) ||
    enTree.leaves.has(key) ||
    hasPluralLeaf(zhTree, key) ||
    hasPluralLeaf(enTree, key)
  )
}
// 一个前缀可解析 = 在任一树里是「有后代的子树」。
function resolvesAsSubtree(prefix: string): boolean {
  return zhTree.subtrees.has(prefix) || enTree.subtrees.has(prefix)
}

// ── 显式动态键前缀注册表 ──
// 模板拼接键的静态前缀 P。每条必须说清「为什么动态 + 枚举来源」。
// 不在册的动态前缀一律报红——逼开发者要么补进这里(连同理由),要么改成静态键。
//
// 两种形态:
//   · **subtree**(默认):`t(`P.${x}`)` —— 点后接插值。校验 P 在 resources 树里是「有后代的子树」。
//     这是绝大多数情形。runtime 取到的具体成员由 `why` 里写明的枚举来源保证在词典里(值集与词条同源)。
//   · **concat**:`t(`P${x}`)` —— **无点直接拼后缀**(如 `mode${'System'|'Custom'|'Off'}`)。
//     此时「前缀」是半个词(`...network.mode`),不是子树。改为**枚举全部字面量后缀**,逐个校验
//     `P+suffix` 是叶子。比 subtree 更强:直接验到具体键存在,而非只验父节点在。
type DynamicPrefix =
  | { prefix: string; why: string; kind?: 'subtree' }
  | { prefix: string; why: string; kind: 'concat'; suffixes: string[] }
const DYNAMIC_KEY_PREFIXES: DynamicPrefix[] = [
  // ── creationAi ──
  { prefix: 'creationAi.mode', why: '动态: 创作助手模式 id;枚举来源: listCreationAiModes() 的内置 mode.id(CreationPromptPicker 用 `creationAi.mode.${id}` 再接 .label/.short/.title/.description)' },
  // ── antigravity ──
  { prefix: 'antigravity', why: '动态(整命名空间): AntigravityConnectionCard 的 `antigravity.${feedback}` feedback 反馈码;枚举来源: antigravity 视图 feedback 联合(antigravity.* 顶层词条)' },
  { prefix: 'antigravity.state', why: '动态: antigravity 连接状态机 state 值;枚举来源: AntigravityViewState.state 联合(state.* 词条)' },
  { prefix: 'antigravity.issues', why: '动态: 校验失败原因码;枚举来源: antigravity 档案的 issue 联合(issues.* 词条)' },
  { prefix: 'antigravity.check', why: '动态: 能力自检状态;枚举来源: antigravityDisplayCheckState() 返回值(check.* 词条)' },
  { prefix: 'antigravity.capability', why: '动态: 能力名;枚举来源: antigravity capabilities 数组(capability.* 词条)' },
  // ── community ──
  { prefix: 'community.stages', why: '动态: 反馈中心分享流程阶段;枚举来源: FeedbackShareContent 的 stage option 列表(stages.* 词条)' },
  // ── modelSetup ──
  { prefix: 'modelSetup.kinds', why: '动态: 模型能力种类;枚举来源: DirectScriptDraftForm 的 KINDS 常量(kinds.* 词条)' },
  { prefix: 'modelSetup.existingConnectionError', why: '动态: 既有连接错误码;枚举来源: ExistingConnectionErrorCode 联合(existingConnectionError.* 词条)' },
  // ── browserAssets ──
  { prefix: 'browserAssets.capture.error', why: '动态: 抓取错误码;枚举来源: browserAssetPopoverUtils 的 capture error key(capture.error.* 词条)' },
  // ── onboardingProviders ──
  { prefix: 'onboardingProviders.modelControls.kind', why: '动态: 模型 chip 类别;枚举来源: isKnownModelChipKind 判定的 kind 集(modelControls.kind.* 词条)' },
  { prefix: 'onboardingProviders.workspace.capability.editor.errors', why: '动态: 能力编辑器表单错误码;枚举来源: ModelCapabilityEditor 的 errors.form/errors.modes(editor.errors.* 词条)' },
  { prefix: 'onboardingProviders.workspace.adapter.title', why: '动态: 适配器状态卡标题;枚举来源: ModelAdapterStatusSection 的 state.state 联合(adapter.title.* 词条)' },
  { prefix: 'onboardingProviders.workspace.adapter.body', why: '动态: 适配器状态卡正文;枚举来源: ModelAdapterStatusSection 的 state.state 联合(adapter.body.* 词条)' },
  { prefix: 'onboardingProviders.drawer.network', why: '动态: 网络抽屉 pill;枚举来源: NetworkSection 的 pill.key(drawer.network.* 词条)' },
  {
    prefix: 'onboardingProviders.drawer.network.mode',
    kind: 'concat',
    suffixes: ['System', 'Custom', 'Off'],
    why: '动态-拼接: NetworkSection 的 `network.mode${System|Custom|Off}` 网络代理模式;枚举来源: NetworkSection network mode 三态',
  },
  { prefix: 'onboardingProviders.adapterVerification.mode', why: '动态: 适配器验证任务类型;枚举来源: mode.taskKind / MODE_LABEL_KEYS(adapterVerification.mode.* 词条)' },
  { prefix: 'onboardingProviders.adapterVerification.stage', why: '动态: 适配器验证阶段;枚举来源: run.stage 联合(adapterVerification.stage.* 词条)' },
  { prefix: 'onboardingProviders.adapterVerification.modelState', why: '动态: 适配器验证逐模型状态;枚举来源: model verification state(adapterVerification.modelState.* 词条)' },
  { prefix: 'onboardingProviders.adapterVerification.cardStatus', why: '动态: 适配器卡状态;枚举来源: adapterCard.state 联合(adapterVerification.cardStatus.* 词条)' },
  { prefix: 'onboardingProviders.adapterVerification.action', why: '动态: 适配器验证建议动作;枚举来源: AdapterVerificationScreen 的 advice.action(adapterVerification.action.* 词条)' },
  { prefix: 'onboardingProviders.assistant.reason', why: '动态: 助手连接失败原因;枚举来源: REASON_I18N 映射值(assistant.reason.* 词条)' },
  { prefix: 'onboardingProviders.customCall.template', why: '动态: 自定义调用模板 id;枚举来源: CustomCallEditor 的 template tpl.id(customCall.template.* 词条)' },
  { prefix: 'onboardingProviders.customCall.vars', why: '动态: 自定义调用变量名;枚举来源: CustomCallEditor 的变量名集(customCall.vars.* 词条)' },
  { prefix: 'onboardingProviders.journey.beats', why: '动态: 引导旅途节拍;枚举来源: JourneyTourController 的 beat.id(journey.beats.${id}.title/.body 词条)' },
  { prefix: 'onboardingProviders.splash.nodes', why: '动态: 开屏动画节点标签;枚举来源: SplashIntro 的 labelKeys 数组(splash.nodes.* 词条)' },
  // ── runtime ──
  { prefix: 'runtime.capability.intent', why: '动态: 能力应用意图;枚举来源: capabilityApplyHandler 归一化后的 intent(capability.intent.* 词条)' },
  // ── agentResident ──
  { prefix: 'agentResident', why: '动态(整命名空间): ProjectAgentResidentShell 及 resident/ 展示器的 `agentResident.${preset.labelKey|preset.hintKey|promptPreset.labelKey|hintKey|key|labelKey}`(提示词档 label/hint、审批/花费 hint、referenceRole、工具参数标签);枚举来源: 内置 prompt preset 的 labelKey/hintKey 常量、residentReferenceRole 的 kind→key 映射、READABLE_PARAMETER_LABELS 的 labelKey(均指向 agentResident.* 已存在词条)' },
  {
    prefix: 'agentResident.mode',
    kind: 'concat',
    suffixes: ['AskHint', 'EditSelectionHint', 'AgentHint'],
    why: '动态-拼接: 模式菜单 `agentResident.mode${Ask|EditSelection|Agent}Hint` 逐模式提示;枚举来源: ProjectAgentRunMode 三态(ask/editSelection/agent)',
  },
  {
    prefix: 'agentResident.approvalMode',
    kind: 'concat',
    suffixes: ['SafeAuto', 'Project', 'Step'],
    why: '动态-拼接: 审批策略 `agentResident.approvalMode${SafeAuto|Project|Step}` 标签;枚举来源: ProjectAgentApprovalMode 三态(safe-auto/project/step)',
  },
  {
    prefix: 'agentResident.spendPolicy',
    kind: 'concat',
    suffixes: ['WithinBudget', 'Confirm'],
    why: '动态-拼接: 花费策略 `agentResident.spendPolicy${WithinBudget|Confirm}` 标签;枚举来源: ProjectAgentSpendPolicy 二态(within-budget/confirm)',
  },
  // ── generationCommon ──
  { prefix: 'generationCommon', why: '动态(整命名空间): NodeGenerationComposer/ProductionRunTaskCard/SelectionPromptSaveController 的 `generationCommon.${option.labelKey|view.titleKey|view.descriptionKey|TEXT_MODE_PLACEHOLDER_KEY[...]}`;枚举来源: 这些视图模型里预置的 labelKey/titleKey/descriptionKey 常量(值指向 generationCommon.* 已存在词条)' },
  { prefix: 'generationCommon.agentRuntime', why: '动态: 画布 agent 运行时动作;枚举来源: gate.ts 的 actionKey(agentRuntime.* 词条)' },
  { prefix: 'generationCommon.canvas.controlsHelp.sections', why: '动态: 画布控件帮助分节;枚举来源: CanvasControlsHelpPopover 的 section.id(controlsHelp.sections.* 词条)' },
  { prefix: 'generationCommon.canvas.controlsHelp.actions', why: '动态: 画布控件帮助动作行;枚举来源: CanvasControlsHelpPopover 的 row.actionKey(controlsHelp.actions.* 词条)' },
  { prefix: 'generationCommon.canvas.controlsHelp.shortcuts', why: '动态: 画布控件帮助快捷键行;枚举来源: CanvasControlsHelpPopover 的 row.shortcutKey(controlsHelp.shortcuts.* 词条)' },
  { prefix: 'generationCommon.canvas.empty.categories', why: '动态: 空画布分类提示;枚举来源: CanvasEmptyState 的 categoryKey(empty.categories.* 词条)' },
  { prefix: 'generationCommon.canvas.edge.modes', why: '动态: 画布连线参考模式;枚举来源: GenerationCanvasReactFlowNodes 的 edge mode(edge.modes.* 词条)' },
  {
    prefix: 'generationCommon.canvas.group.aggregate',
    kind: 'concat',
    suffixes: ['Input', 'Output'],
    why: '动态-拼接: GenerationCanvasReactFlowNodes 的 `group.aggregate${Input|Output}` 聚合方向;枚举来源: data.aggregateDirection 二态',
  },
  { prefix: 'generationCommon.memory.kinds', why: '动态: 记忆条目类别;枚举来源: MemoryFold 的 fact.kind(memory.kinds.* 词条)' },
  { prefix: 'generationCommon.node.extractFrame', why: '动态: 抽帧首尾;枚举来源: extractVideoFrameToNode 的 which(node.extractFrame.* 词条)' },
  { prefix: 'generationCommon.observability.error', why: '动态: 可观测错误叙事;枚举来源: narrate.ts 的 error key(observability.error.${key}.reason/.hint 词条)' },
  { prefix: 'generationCommon.observability.action', why: '动态: 可观测动作叙事;枚举来源: narrate.ts 的 ACTION_KEY[action](observability.action.${key}.main/.alt 词条)' },
  { prefix: 'generationCommon.production.artifactKind', why: '动态: 产物类型;枚举来源: ProductionRunTaskCard 的 preview.kind(production.artifactKind.* 词条)' },
  { prefix: 'generationCommon.production.batch.frozen', why: '动态: 批次冻结项;枚举来源: SpendConfirmDialog 的 frozen item(production.batch.frozen.* 词条)' },
  { prefix: 'generationCommon.production.contract', why: '动态: 制作契约字段;枚举来源: ProductionContractSummary 的 label(production.contract.* 词条)' },
  { prefix: 'generationCommon.production.contract.trustLevelValue', why: '动态: 契约信任等级值;枚举来源: ProductionContractSummary 的 view.trustLevel(contract.trustLevelValue.* 词条)' },
  { prefix: 'generationCommon.production.origin', why: '动态: 制作发起来源;枚举来源: ProductionRunTaskCard 的 view.originHost(production.origin.* 词条)' },
  { prefix: 'generationCommon.production.runAction', why: '动态: 制作运行动作;枚举来源: ProductionRunTaskCard 的 action(production.runAction.* 词条)' },
  { prefix: 'generationCommon.production.runDetails.stageStatus', why: '动态: 制作阶段状态;枚举来源: ProductionDetails 的 stage.status(runDetails.stageStatus.* 词条)' },
  { prefix: 'generationCommon.production.runTone', why: '动态: 制作运行语气;枚举来源: ProductionRunTaskCard 的 view.tone(production.runTone.* 词条)' },
  { prefix: 'generationCommon.spend.cost.units', why: '动态: 花费单位;枚举来源: spendConfirm 的 kind(spend.cost.units.* 词条)' },
  // ── storyboardEditor ──
  { prefix: 'storyboardEditor.row.transition', why: '动态: 镜行展开态转场类型;枚举来源: StoryboardShotRowExpand 的 TRANSITION_TYPES 常量(=storyboardShotSchema transition.type 枚举, row.transition.* 词条)' },
  // ── timelineEditor ──
  { prefix: 'timelineEditor.agent.edges', why: '动态: 时间线 agent 边操作;枚举来源: timelineEditPlanModel 的 operation.edge(agent.edges.* 词条)' },
  { prefix: 'timelineEditor.transition.types', why: '动态: 转场类型;枚举来源: 时间线转场 type 集(transition.types.* 词条)' },
  // ── scene3d ──
  { prefix: 'scene3d.taskFlow.taskLabel', why: '动态: 3D 任务流任务标签;枚举来源: scene3dTaskMode 的 task(taskFlow.taskLabel.* 词条)' },
  { prefix: 'scene3d.taskFlow.taskShortLabel', why: '动态: 3D 任务流任务短标签;枚举来源: scene3dTaskMode 的 task(taskFlow.taskShortLabel.* 词条)' },
  // ── settings ──
  { prefix: 'settings.ai.upload.channel.kind', why: '动态: 上传通道类别;枚举来源: AiModelsSection 的 channel.kind(upload.channel.kind.* 词条)' },
  { prefix: 'settings.ai.tikhub.route', why: '动态: TikHub 路由字段;枚举来源: TikhubConnectorCard 的 route 字段(tikhub.route.* 词条)' },
  {
    prefix: 'settings.ai.tikhub.route.mode',
    kind: 'concat',
    suffixes: ['Auto', 'Io', 'Dev'],
    why: '动态-拼接: TikhubConnectorCard 的 `tikhub.route.mode${Auto|Io|Dev}` 路由模式;枚举来源: tikhub route mode 三态',
  },
  { prefix: 'settings.automation.hosts', why: '动态: 自动化主机;枚举来源: 自动化设置的 host key(automation.hosts.* 词条)' },
  { prefix: 'settings.automation.mode.hint', why: '动态: 自动化模式提示;枚举来源: 自动化模式 key(automation.mode.hint.* 词条)' },
  // ── libraries ──
  { prefix: 'libraries.sidebar.builtinCategory', why: '动态: 内置分类 id;枚举来源: ProjectCategory.id(builtinCategory.* 词条: shots/cast/scene/prop/audio)' },
  { prefix: 'libraries.sidebar.nodeKindShort', why: '动态: 节点类型短名;枚举来源: 节点 kind(nodeKindShort.* 词条)' },
  { prefix: 'libraries.skill.importReason', why: '动态: 技能导入失败原因;枚举来源: skill import reason 联合(skill.importReason.* 词条)' },
  { prefix: 'libraries.workflow', why: '动态: 流程库字段;枚举来源: WorkflowLibraryContent 的 value(workflow.* 词条)' },
]

// 前缀合法性(防「假注册」——注册了一条 resources 里其实不存在的前缀):
//   · subtree 条目:前缀本身必须是「有后代的子树」。
//   · concat 条目:枚举的每个 prefix+suffix 必须是叶子(直接验到具体键)。
type StaleRegistration = { prefix: string; why: string; reason: string }
const staleRegisteredPrefixes: StaleRegistration[] = []
for (const entry of DYNAMIC_KEY_PREFIXES) {
  if (entry.kind === 'concat') {
    const missing = entry.suffixes.filter((suffix) => !resolvesAsLeaf(`${entry.prefix}${suffix}`))
    if (missing.length > 0) {
      staleRegisteredPrefixes.push({ prefix: entry.prefix, why: entry.why, reason: `concat 后缀无对应叶子: ${missing.map((s) => entry.prefix + s).join(', ')}` })
    }
  } else if (!resolvesAsSubtree(entry.prefix)) {
    staleRegisteredPrefixes.push({ prefix: entry.prefix, why: entry.why, reason: '前缀在 resources 树里不是子树' })
  }
}

// 动态键匹配:concat 条目按「前缀是拼接起点」判定(head 去掉尾点后 === concat.prefix);
// subtree 条目按「前缀相等」判定。concat 优先(它的 prefix 更长、更具体)。
function matchDynamic(staticPrefix: string): DynamicPrefix | undefined {
  const concat = DYNAMIC_KEY_PREFIXES.find((e) => e.kind === 'concat' && e.prefix === staticPrefix)
  if (concat) return concat
  return DYNAMIC_KEY_PREFIXES.find((e) => e.kind !== 'concat' && e.prefix === staticPrefix)
}

// ── 源码扫描 ──
type Finding = { file: string; line: number; kind: string; detail: string }

function isSourceFile(fileName: string): boolean {
  const relative = path.relative(ROOT, fileName).replaceAll('\\', '/')
  return (
    !relative.includes('/__tests__/') &&
    !/\.(?:test|spec|stories)\.[cm]?[jt]sx?$/.test(relative) &&
    // 词典本身与其类型声明不算「引用」。
    relative !== 'src/i18n/resources.ts' &&
    !relative.startsWith('src/i18n/locales/')
  )
}

// 取模板字面量的静态前缀:head 文本直到第一个 ${…}。`t(`a.b.${x}`)` → 'a.b'(去掉尾随的点)。
// 若 head 为空(键完全从变量拼,如 `t(`${a}.${b}`)`)→ 返回 null,由调用方按「无静态前缀」报红。
//
// 例外:`t(`${key}.label`)` 这种「head 为空、首段是一个引用了模板字面量 const 的标识符」——
// 顺着那个 const 的初始化模板取它的静态前缀,再接上本模板 head 之后的第一段静态文本。
// (CreationPromptPicker 的 `const key = `creationAi.mode.${id}`` 就是这形状:真实键是
//  `creationAi.mode.${id}.label`,静态前缀应是 `creationAi.mode`。)不做更深的常量折叠——只这一跳,
// 覆盖现存写法即可,再深就该改成静态键或直接注册前缀。
// 剥掉 `as const` / `as X` / 括号,拿到里面真正的表达式。
function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node
  while (ts.isAsExpression(current) || ts.isParenthesizedExpression(current) || ts.isTypeAssertionExpression(current)) {
    current = current.expression
  }
  return current
}

function resolveConstTemplatePrefix(sourceFile: ts.SourceFile, name: string): string | null {
  let found: string | null = null
  const walk = (node: ts.Node): void => {
    if (
      found === null &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      const init = unwrapExpression(node.initializer) // `const key = `…` as const` 的 initializer 是 AsExpression。
      if (ts.isTemplateExpression(init)) {
        const head = init.head.text
        if (head) found = head.replace(/\.+$/, '')
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(sourceFile)
  return found
}

function staticPrefixOfTemplate(node: ts.TemplateExpression, sourceFile: ts.SourceFile): string | null {
  const head = node.head.text
  if (head) return head.replace(/\.+$/, '') // 去掉尾随点:'antigravity.state.' → 'antigravity.state'。
  // head 为空:`${ident}...` —— 若首段插值是引用某 const 模板的标识符,顺藤取其前缀。
  const firstSpan = node.templateSpans[0]
  if (firstSpan && ts.isIdentifier(firstSpan.expression)) {
    return resolveConstTemplatePrefix(sourceFile, firstSpan.expression.text)
  }
  return null
}

// 判断一个调用是不是翻译函数调用:`t(...)` 或 `i18n.t(...)` / `<x>.t(...)`(方法名为 t)。
function isTranslationCall(node: ts.CallExpression): boolean {
  const callee = node.expression
  if (ts.isIdentifier(callee)) return callee.text === 't'
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text === 't'
  return false
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function scanFile(fileName: string): Finding[] {
  const sourceText = fs.readFileSync(fileName, 'utf8')
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const relative = path.relative(ROOT, fileName).replaceAll('\\', '/')
  const findings: Finding[] = []

  function checkStaticKey(key: string, line: number, kind: string): void {
    // `i18n:` 前缀由 chunkBoundary 在渲染时 slice 掉再 t();这里已在调用方剥离,传进来的是纯 key。
    if (key === '') return // 空 key(如 chunkBoundary 里 `'i18n:'` 这个前缀常量本身,slice 后为空)——不是引用。
    if (resolvesAsLeaf(key)) return
    // 引用了一个「有后代的子树」而非叶子(如 t('sidebar') 指向对象)——i18next 会返回 [object Object]/键本身,
    // 同样是坏引用。
    if (resolvesAsSubtree(key)) {
      findings.push({ file: relative, line, kind: `${kind}-points-at-subtree`, detail: key })
      return
    }
    findings.push({ file: relative, line, kind, detail: key })
  }

  function checkDynamicPrefix(prefix: string | null, line: number, raw: string): void {
    if (prefix === null) {
      findings.push({ file: relative, line, kind: 'dynamic-no-static-prefix', detail: raw })
      return
    }
    if (!matchDynamic(prefix)) {
      findings.push({ file: relative, line, kind: 'dynamic-unregistered-prefix', detail: `${raw}  (static prefix: ${prefix})` })
    }
    // 已注册前缀的「前缀/后缀存在性」由 staleRegisteredPrefixes 统一校验,不逐调用点重复报。
  }

  function visit(node: ts.Node): void {
    // ① `'i18n:...'` 字符串字面量(chunkBoundary label)——渲染时会 i18n.t(slice('i18n:'.length))。
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text.startsWith('i18n:')) {
      checkStaticKey(node.text.slice('i18n:'.length), lineOf(sourceFile, node), 'chunk-label')
    }

    // ② 翻译函数调用 t(...) / i18n.t(...)
    if (ts.isCallExpression(node) && isTranslationCall(node) && node.arguments.length > 0) {
      const arg = node.arguments[0]
      if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
        checkStaticKey(arg.text, lineOf(sourceFile, arg), 't-call')
      } else if (ts.isTemplateExpression(arg)) {
        checkDynamicPrefix(staticPrefixOfTemplate(arg, sourceFile), lineOf(sourceFile, arg), arg.getText(sourceFile))
      }
      // 其它形态(变量键 `t(keyVar)`、条件表达式 `t(a ? 'x' : 'y')`)——条件表达式拆两支查:
      else if (ts.isConditionalExpression(arg)) {
        for (const branch of [arg.whenTrue, arg.whenFalse]) {
          if (ts.isStringLiteral(branch) || ts.isNoSubstitutionTemplateLiteral(branch)) {
            checkStaticKey(branch.text, lineOf(sourceFile, branch), 't-call')
          } else if (ts.isTemplateExpression(branch)) {
            checkDynamicPrefix(staticPrefixOfTemplate(branch, sourceFile), lineOf(sourceFile, branch), branch.getText(sourceFile))
          }
        }
      }
      // 纯变量键(无字面量可查)静默跳过——无法静态判定,且这些点极少;真要覆盖需运行时插桩,超出本门岗范围。
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings
}

const files = ts.sys.readDirectory(SRC_ROOT, ['.ts', '.tsx'], undefined, undefined).filter(isSourceFile)
const findings = files.flatMap(scanFile)

// 稳定排序,报告可读。
findings.sort((a, b) => a.file.localeCompare(b.file, 'en') || a.line - b.line || a.detail.localeCompare(b.detail, 'en'))

if (REPORT) {
  console.log(`Scanned ${files.length} source files; ${zhTree.leaves.size} resolvable keys.`)
  console.log(`Registered dynamic prefixes: ${DYNAMIC_KEY_PREFIXES.length}`)
  console.log(`Unresolved references: ${findings.length}`)
  for (const f of findings) console.log(`  ${f.file}:${f.line} [${f.kind}] ${f.detail}`)
  if (staleRegisteredPrefixes.length > 0) {
    console.log(`Stale registered prefixes: ${staleRegisteredPrefixes.length}`)
    for (const p of staleRegisteredPrefixes) console.log(`  - ${p.prefix} (${p.reason})`)
  }
  process.exit(0)
}

const problems = findings.length + staleRegisteredPrefixes.length
if (problems === 0) {
  console.log(
    `i18n key-ref gate passed (${files.length} files scanned, ${zhTree.leaves.size} keys, ${DYNAMIC_KEY_PREFIXES.length} dynamic prefixes; every reference resolves)`,
  )
  process.exit(0)
}

console.error(`i18n key-ref gate failed: ${problems} problem(s)`)
if (findings.length > 0) {
  console.error(`\nUnresolvable translation references (would render the raw key on screen):`)
  for (const f of findings) {
    if (f.kind === 'dynamic-unregistered-prefix') {
      console.error(`- ${f.file}:${f.line}  未注册的动态键前缀 → ${f.detail}`)
    } else if (f.kind === 'dynamic-no-static-prefix') {
      console.error(`- ${f.file}:${f.line}  动态键没有静态前缀(整个 key 从变量拼)→ ${f.detail}`)
    } else if (f.kind.endsWith('-points-at-subtree')) {
      console.error(`- ${f.file}:${f.line}  引用指向对象子树而非叶子文案 → "${f.detail}"`)
    } else {
      console.error(`- ${f.file}:${f.line}  [${f.kind}] "${f.detail}" —— 两个词典都没有这个键`)
    }
  }
  console.error(
    `\n  → 修法:把键补进它真正该住的命名空间(zh + en 同时),或改用已存在的键;` +
      `动态键把静态前缀连同「为什么动态 + 枚举来源」加进 scripts/check-i18n-key-refs.ts 的 DYNAMIC_KEY_PREFIXES。`,
  )
}
if (staleRegisteredPrefixes.length > 0) {
  console.error(`\n注册表里有失效前缀(等于假注册):`)
  for (const p of staleRegisteredPrefixes) console.error(`- ${p.prefix}  —— ${p.reason}\n    (${p.why})`)
  console.error(`  → 该前缀词条可能被删/改名;更新 DYNAMIC_KEY_PREFIXES 或补回词条。`)
}
process.exit(1)
