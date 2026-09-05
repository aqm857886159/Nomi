// **动态翻译键前缀注册表**——正向门岗(check-i18n-key-refs)与反向门岗(check-i18n-dead-keys)的**共同真相源**。
//
// 为什么单独成模块:两道门岗对同一份注册表有**相反方向**的需求——
//   · 正向(键引用解析):`t(`P.${x}`)` 的静态前缀 P 必须在册,否则是「裸动态键」= 红。
//   · 反向(死键检测):P 覆盖到的叶子**不能判死**——运行时可能取到,静态看不见引用。
// 抄成两份则必然漂移(删了一条前缀,正向红了改这份、反向那份还留着 → 反向把活键判死、删掉 = 线上白屏)。
// 故此处是唯一定义,两边 import。(R14.1:同一语义只许有一个 owner。)
//
// 每条必须写清 ① 为什么是动态的 ② 运行时可能取到的成员从哪来(枚举来源)。
//
// 两种形态:
//   · **subtree**(默认):`t(`P.${x}`)` —— 点后接插值。P 在 resources 树里必须是「有后代的子树」。
//   · **concat**:`t(`P${x}`)` —— **无点直接拼后缀**(如 `mode${'System'|'Custom'|'Off'}`)。
//     此时 P 是半个词、不是子树,故改为枚举全部字面量后缀,逐个校验 `P+suffix` 是叶子。

import { VENDOR_CONNECTION_PILL_LABEL_MEMBERS } from '../../src/ui/onboarding/vendorConnectionView'

export type DynamicPrefix =
  | { prefix: string; why: string; kind?: 'subtree'; members?: readonly string[] }
  | { prefix: string; why: string; kind: 'concat'; suffixes: string[] }

/**
 * **覆盖整棵顶层命名空间的前缀 = 死键门岗对该命名空间整片失明。**
 *
 * 2026-09-05 实证（`generationCommon`）：一条 `t(`generationCommon.${labelKey}`)` 就让 4965 键里
 * 整个 generationCommon 只报 B 档、永不报死；把注册表那条 umbrella 删掉**一个字都没变**——
 * 因为反向门岗把**源码模板 head** 也当动态前缀，注册表之外自动生效。收窄调用点后当场冒出 180 条 A 档。
 *
 * 故此表是**只减不增的欠账**（check-i18n-dead-keys 强制核对：新增一个整命名空间前缀当场报红；
 * 某条已经不再过宽也报红，逼你把它摘掉）。清账方式**不是**改注册表，是改调用点：
 * 常量存**整键**并 `satisfies TranslationKey`（见 `src/i18n/translationKey.ts`），拼接消失、前缀自然收窄。
 */
export const OVERBROAD_NAMESPACE_DEBT: readonly string[] = []

export const DYNAMIC_KEY_PREFIXES: DynamicPrefix[] = [
  // ── creationAi ──
  { prefix: 'creationAi.mode', why: '动态: 创作助手模式 id;枚举来源: listCreationAiModes() 的内置 mode.id(CreationPromptPicker 用 `creationAi.mode.${id}` 再接 .label/.short/.title/.description)' },
  // ── antigravity ──
  { prefix: 'antigravity.state', why: '动态: Antigravity 连接状态;枚举来源: AntigravityConnectionStatus["state"] 六态(antigravity.state.* 词条)' },
  { prefix: 'antigravity.notice', why: '动态: Antigravity 连接状态对应的提示语;枚举来源: 同 state 六态(antigravity.notice.* 词条)' },
  { prefix: 'antigravity.check', why: '动态: Antigravity 能力校验展示态;枚举来源: antigravityDisplayCheckState() 的返回联合(antigravity.check.* 词条)' },
  { prefix: 'antigravity.capability', why: '动态: Antigravity 能力项;枚举来源: 卡片 capabilities 列表(antigravity.capability.* 词条)' },
  { prefix: 'antigravity.issues', why: '动态: Antigravity 失败原因码;枚举来源: 视图 view.issue 联合(antigravity.issues.* 词条)' },
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
  {
    prefix: 'onboardingProviders.vendorCard.connection',
    members: VENDOR_CONNECTION_PILL_LABEL_MEMBERS,
    why: '动态: 供应商连接胶囊文案;枚举来源: vendorConnectionView 的 VENDOR_CONNECTION_PILL_LABEL_MEMBERS（由 VendorConnection.state 四态映射，unsupported 复用 saved）',
  },
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
  { prefix: 'generationCommon.assistant.toolCall', why: "动态: 工具调用的人话摘要;枚举来源: toolCallSummary.ts 的 tt(key)——键先存进 const T 再 `${T}.${key}` 拼,模板 head 为空、正反两道门岗都看不见,故必须在册(该文件里 summarizeToolCall/buildStepDetailLabels 传入的字面量 key)" },
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
  { prefix: 'timelineEditor.transition.types', why: '动态: 转场类型;枚举来源: 时间线转场 type 集(transition.types.* 词条)' },
  // ── scene3d ──
  { prefix: 'scene3d.inspector.posePreset', why: '动态: 人偶姿势预设名;枚举来源: scene3dConstants 的 MANNEQUIN_POSE_PRESETS[].id(id 与词条同名,故键由 id 派生,不另存一份 labelKey)' },
  { prefix: 'scene3d.taskFlow.taskLabel', why: '动态: 3D 任务流任务标签;枚举来源: scene3dTaskMode 的 task(taskFlow.taskLabel.* 词条)' },
  { prefix: 'scene3d.taskFlow.taskShortLabel', why: '动态: 3D 任务流任务短标签;枚举来源: scene3dTaskMode 的 task(taskFlow.taskShortLabel.* 词条)' },
  // ── settings ──
  { prefix: 'settings.general.telemetry', why: '动态: 遥测设置状态标签;枚举来源: TelemetrySettingsView.status 的 configured/unconfigured/disabled 三态映射为 statusConfigured/statusUnconfigured/statusDisabled 词条' },
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
