// 全功能走查的**场景目录 = 功能状态表**（唯一一份，活的：目录自检接在 contracts 里）。
//
// 用户要的是一张「所有用户功能 × 每个功能的各个状态」的表，出问题时能查表修（Google「关键用户旅程」+ UI 状态规范那一路）。
// 所以这里的每一行是一条**用户旅程**，不是一个脚本：
//   · states：这条旅程会经过的每个状态——用户看到的字（i18n key）、这时能做的动作、代码里谁决定这个状态（文件#符号，
//     尽量对上 docs/engineering/concept-owners.json）、非终态最长等多久（只引用现有登记处；没有登记就明写 gap——那本身就是发现）；
//   · scripts：覆盖它的剧本 / 走查；invariants：核对的铁律（invariants.mjs）；metric：它该上报的成功 / 失败事件（没有就写 gap，反馈雷达要用）。
//   · 每个 state.actions 的可点目标都要能补一行 click target 对照：
//     { target, userExpectation, actualObservation, useCases, ironLaws }。
//     userExpectation 是用户点之前合理以为会发生什么；actualObservation 只填真实走查 / 回执看到的结果，不能用实现推测代替。
//
// 目录自检（scripts/check-full-walk-catalog.mjs，接在 gates:contracts）：owner 指向的符号真实存在、每条旅程至少一条剧本、
// 每个非终态都有 deadline（登记处引用 / 等用户 / 明写的 gap 三选一）、visibleText 的 key 在中英两份词典里都在。
//
// 加新功能或改了哪块：同一个 PR 里更新对应旅程的状态行和剧本（docs/engineering/full-walk.md）。
// 注意：这是公开仓库——状态表里只写用户看得见的事实与代码位置，不写私有待办编号、价格或供应商合作信息。

/**
 * Phase 0 fixes the click-target columns for iron law ⑫「点了=以为的」.
 * Phase 1 fills one row for every action; observations come from a real walk,
 * provider receipt, or persisted state, and unknowns stay `unverified`.
 */
export const CLICK_TARGET_CONTRACT = Object.freeze({
  fields: Object.freeze(['target', 'userExpectation', 'actualObservation', 'useCases', 'ironLaws']),
  // 按钮预期表的七字段集（docs/engineering/test-routing.json 的 buttonExpectationFields）里，目前预期表还没填的可选字段：
  // 设计链接 / 变体或状态 / 无障碍角色 + 名称（getByRole）/ 用户动作。逐步补，不填不红；映射由路由表的 catalogField 声明。
  optionalFields: Object.freeze(['designRef', 'state', 'role', 'accessibleName', 'action']),
  actualObservation: '真实 Electron 走查、供应商回执或落盘状态的证据；未知写 unverified，不得从代码推断',
  candidateLedger: 'tests/ux/full-walk/escapeLedger.json',
  ironLaw: '⑫ 点了=以为的',
})

/**
 * ⑫ 第一批：分镜表这一屏的每个可点目标（方案 §4 S6）。userExpectation 是用户点之前合理以为会发生什么，用大白话写；
 * actualObservation 只抄 pb12 真实走查看到的结果（证据在那一场的 monitor-report.json 的 clickTargets 与截图），
 * 没跑过写 unverified。两者对不上的那几条，走查当场写进逃逸账本 LAW12-<id>。
 */
const SB_TARGET = (row) => Object.freeze({ useCases: Object.freeze(['S6']), ironLaws: Object.freeze(['⑫']), playbook: 'pb12-storyboard-click-expectations', fullWalkJourneys: Object.freeze(['J06-delete-shot']), ...row })
export const STORYBOARD_CLICK_TARGETS = Object.freeze([
  SB_TARGET({
    id: 'sb-row-blank', target: '分镜行的空白处',
    owner: 'src/workbench/creation/storyboard/StoryboardShotTable.tsx#StoryboardShotTable',
    userExpectation: '这一行被选中、高亮；所有行照常显示，内容一个不少',
    actualObservation: '2026-10-05 pb12 真实走查（zh / en 两档一致）：第 2 镜选中、高亮；所有行照常显示，没有东西消失 —— 一致',
  }),
  SB_TARGET({
    id: 'sb-shot-number', target: '画面格左上角的镜号',
    owner: 'src/workbench/creation/storyboard/shotRow/StoryboardShotFrame.tsx#StoryboardShotFrame',
    userExpectation: '和点这一行一样：选中这一镜，不触发生成，别的行不动',
    actualObservation: '2026-10-05 pb12（zh / en）：第 3 镜选中，没有发生成，别的行不动 —— 一致',
  }),
  SB_TARGET({
    id: 'sb-row-checkbox', target: '行首的小方框（复选框）',
    owner: 'src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx#StoryboardShotRow',
    userExpectation: '勾上就是选中这一镜（像表格勾选），之后可以对勾上的几镜批量操作；这一镜照常显示，不变灰、不被藏起来',
    actualObservation: '2026-10-05 pb12（zh / en）：这一镜没有被选中，整行变淡到 60%，打上「本次跳过 / Skipped this run」 —— 不一致（LAW12-sb-row-checkbox）',
  }),
  SB_TARGET({
    id: 'sb-row-more', target: '行首的「⋯」',
    owner: 'src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx#StoryboardShotRow',
    userExpectation: '弹出这一镜的操作菜单（插入、复制、换画幅、删除……），整块都在窗口里；点别处它就关上，点的那一下照样生效',
    actualObservation: '2026-10-05 pb12（zh）修复后复跑：菜单弹出、整块在窗口里；点第 1 镜画面格那一下关上菜单，并照样选中第 1 镜 —— 一致（LAW12-sb-row-more 已修，修前：点别处不关、盖住缩略图）',
  }),
  SB_TARGET({
    id: 'sb-param-duration', target: '底栏的「时长」格',
    owner: 'src/workbench/creation/storyboard/shotRow/ShotComposerBar.tsx#ShotComposerBar',
    userExpectation: '展开可选的秒数；选一个新值，这一格显示新值，这一镜存下来的也是新值，别的镜不变',
    actualObservation: '2026-10-05 pb12（zh / en）：下拉展开，选「3 秒 / 3 sec」后落盘的第 2 镜时长是 3 秒，别的镜不变 —— 一致',
  }),
  SB_TARGET({
    id: 'sb-row-generate', target: '这一行最右的「生成」',
    owner: 'src/workbench/creation/storyboard/shotRow/ShotComposerBar.tsx#ShotComposerBar',
    userExpectation: '只生成这一镜：这一镜马上显示在生成，别的镜不动，供应商只收到这一镜的一次请求',
    actualObservation: '2026-10-05 pb12（zh / en）：供应商只收到这一镜一次请求，画面格换成结果，别的镜没动，没弹多余对话框 —— 一致',
  }),
  SB_TARGET({
    id: 'sb-thumbnail-done', target: '已生成镜头的缩略图',
    owner: 'src/workbench/creation/storyboard/shotRow/StoryboardShotFrame.tsx#StoryboardShotFrame',
    userExpectation: '点一下就打开这一镜的大图来看',
    actualObservation: '2026-10-05 pb12（zh / en）：单击缩略图只选中这一行，什么也没打开；大图要双击或点缩略图下方的展开图标 —— 不一致（LAW12-sb-thumbnail-done）',
  }),
])

const PHASE = 'src/workbench/generationCanvas/runner/generationPhaseDeadline.ts#GENERATION_PHASE_DEADLINE'
const USER = Object.freeze({ waitsFor: 'user' })

/** 剧本（每条一个进程，由 run.mjs 按变体跑）。paid:true 的只在 NOMI_SPEND_OK=1 时跑。 */
export const FULL_WALK_PLAYBOOKS = Object.freeze([
  Object.freeze({
    id: 'pb01-two-page-card', script: 'tests/ux/full-walk/playbooks/pb01-two-page-card.walk.mjs', paid: false,
    title: Object.freeze({ 'zh-CN': 'Agent 画两张图，付费卡两页只在第 1 页点「生成这张」', en: 'Two-image draft, confirm only page 1 of the card' }),
    variants: Object.freeze([Object.freeze({ id: 'base', locale: 'zh-CN' }), Object.freeze({ id: 'en', locale: 'en' })]),
  }),
  Object.freeze({
    id: 'pb02-reference-image', script: 'tests/ux/full-walk/playbooks/pb02-reference-image.walk.mjs', paid: false,
    title: Object.freeze({ 'zh-CN': '连着参考图生成（画布直生成 / Agent 付费卡两条路）', en: 'Generate with a connected reference (canvas and Agent paths)' }),
    variants: Object.freeze([Object.freeze({ id: 'base', locale: 'zh-CN' }), Object.freeze({ id: 'en', locale: 'en' })]),
  }),
  Object.freeze({
    id: 'pb03-default-models', script: 'tests/ux/full-walk/playbooks/pb03-default-models.walk.mjs', paid: false,
    title: Object.freeze({ 'zh-CN': '设了图片默认模型，再让 Agent 画图', en: 'Set the image default, then ask the Agent' }),
    variants: Object.freeze([Object.freeze({ id: 'base', locale: 'zh-CN' }), Object.freeze({ id: 'omit-candidate', locale: 'zh-CN' })]),
  }),
  Object.freeze({
    id: 'pb04-script-attachment-long-chat', script: 'tests/ux/full-walk/playbooks/pb04-script-attachment-long-chat.walk.mjs', paid: false,
    title: Object.freeze({ 'zh-CN': '给 Agent 传 txt 剧本，再来回改好几轮', en: 'Attach a txt script, then a long rewrite chat' }),
    variants: Object.freeze([Object.freeze({ id: 'base', locale: 'zh-CN' })]),
  }),
  Object.freeze({
    id: 'pb11-canvas-single-run', script: 'tests/ux/full-walk/playbooks/pb11-canvas-single-run.walk.mjs', paid: false,
    title: Object.freeze({ 'zh-CN': '画布上点 ↑：一次点击一个单镜 Run，被拒可再点，结果未知被拦', en: 'Canvas generate: one single-shot Run per click, rejected may retry, unknown is blocked' }),
    variants: Object.freeze([Object.freeze({ id: 'base', locale: 'zh-CN' }), Object.freeze({ id: 'en', locale: 'en' })]),
  }),
  Object.freeze({
    id: 'pb10-node-display-rules', script: 'tests/ux/full-walk/playbooks/pb10-node-display-rules.walk.mjs', paid: false,
    title: Object.freeze({ 'zh-CN': '节点上显示什么：版本角标、重拍入口、已保存回执、失败标题、草稿标题', en: 'What a node shows: version badge, re-film entry, saved receipt, failure title, draft title' }),
    variants: Object.freeze([Object.freeze({ id: 'base', locale: 'zh-CN' }), Object.freeze({ id: 'en', locale: 'en' })]),
  }),
  Object.freeze({
    id: 'pb09-agent-failure-and-receipts', script: 'tests/ux/full-walk/playbooks/pb09-agent-failure-and-receipts.walk.mjs', paid: false,
    title: Object.freeze({ 'zh-CN': 'Agent 写稿后的工具收据，和服务商整条回错时面板上那一行', en: 'Tool receipts after the Agent writes, and the row shown when the provider returns a raw error' }),
    variants: Object.freeze([Object.freeze({ id: 'base', locale: 'zh-CN' }), Object.freeze({ id: 'en', locale: 'en' })]),
  }),
  Object.freeze({
    id: 'pb05-pause-resume', script: 'tests/ux/full-walk/playbooks/pb05-pause-resume.walk.mjs', paid: false,
    title: Object.freeze({ 'zh-CN': '全自动起草三镜视频，中途暂停、继续剩余、在 Agent 里按停止', en: 'Full-auto three video shots, pause, resume, stop the Agent' }),
    variants: Object.freeze([Object.freeze({ id: 'base', locale: 'zh-CN' })]),
  }),
  Object.freeze({
    id: 'pb06-failure-small-window', script: 'tests/ux/full-walk/playbooks/pb06-failure-small-window.walk.mjs', paid: false,
    title: Object.freeze({ 'zh-CN': '生成失败：看提示、缩到最小窗、按提示换一家、再生成', en: 'Generation fails: read the notice, shrink the window, switch provider' }),
    variants: Object.freeze([Object.freeze({ id: 'base', locale: 'zh-CN' }), Object.freeze({ id: 'en', locale: 'en' })]),
  }),
  Object.freeze({
    id: 'pb07-failure-kinds', script: 'tests/ux/full-walk/playbooks/pb07-failure-kinds.walk.mjs', paid: false,
    title: Object.freeze({ 'zh-CN': '生成失败有几种：参数错误、结果读不出来、带尾数据的完整图照常落地、认不出类别的话标题跟界面语言', en: 'Failure kinds: rejected parameters, unreadable result, complete image with trailing bytes still lands, unknown provider text keeps the headline in the UI language' }),
    variants: Object.freeze([Object.freeze({ id: 'base', locale: 'zh-CN' }), Object.freeze({ id: 'en', locale: 'en' })]),
  }),
  Object.freeze({
    id: 'pb07-storyboard-prompt-truth', script: 'tests/ux/full-walk/playbooks/pb07-storyboard-prompt-truth.walk.mjs', paid: false,
    title: Object.freeze({ 'zh-CN': '分镜里写的提示词就是发出去的提示词（行内 / 批量 / 放到画布 / Agent 确认框四个入口）', en: 'The storyboard prompt you wrote is the prompt that is sent (four entries)' }),
    variants: Object.freeze([Object.freeze({ id: 'base', locale: 'zh-CN' })]),
  }),
  Object.freeze({
    id: 'pb08-cover-card-kind', script: 'tests/ux/full-walk/playbooks/pb08-cover-card-kind.walk.mjs', paid: false,
    title: Object.freeze({ 'zh-CN': '让 Agent 做一个 3:4 封面：付费卡标题 / 模型 / 画布节点到底是图还是视频', en: 'Ask the Agent for a 3:4 cover: is the card, model and node an image or a video' }),
    variants: Object.freeze([Object.freeze({ id: 'base', locale: 'zh-CN' })]),
  }),
  Object.freeze({
    id: 'pb12-storyboard-click-expectations', script: 'tests/ux/full-walk/playbooks/pb12-storyboard-click-expectations.walk.mjs', paid: false,
    title: Object.freeze({ 'zh-CN': '分镜表上每个可点的地方各点一下：点了是不是用户以为的那件事（铁律 ⑫）', en: 'Click every target on the storyboard table: does it do what the user expected (law 12)' }),
    variants: Object.freeze([Object.freeze({ id: 'base', locale: 'zh-CN' }), Object.freeze({ id: 'en', locale: 'en' })]),
  }),
  Object.freeze({
    id: 'pb91-storyboard-dragon-paid', script: 'tests/ux/full-walk/playbooks/pb91-storyboard-dragon.paid.mjs', paid: true,
    title: Object.freeze({ 'zh-CN': '（付费小额）分镜里写「巨龙」，真出图一张，结果是龙不是人', en: '(paid) Storyboard row says dragon, one real image, it must be a dragon' }),
    variants: Object.freeze([Object.freeze({ id: 'base', locale: 'zh-CN' })]),
  }),
  Object.freeze({
    id: 'pb90-seedream5-paid', script: 'tests/ux/full-walk/playbooks/pb90-seedream5.paid.mjs', paid: true,
    title: Object.freeze({ 'zh-CN': '（付费小额）Seedream 5.0 出一张最小档的图，看落地校验', en: '(paid) One smallest Seedream 5.0 image, check landing' }),
    variants: Object.freeze([Object.freeze({ id: 'base', locale: 'zh-CN' })]),
  }),
])

/** 第一版十条最重要的旅程。 */
export const FULL_WALK_JOURNEYS = Object.freeze([
  Object.freeze({
    id: 'J01-generate-image',
    title: Object.freeze({ 'zh-CN': '生成一张图', en: 'Generate an image' }),
    states: Object.freeze([
      { id: 'composing', kind: 'user', visibleText: ['generationCommon.nodeEmpty.image.title', 'generationCommon.nodeEmpty.image.description'], actions: ['输入提示词', '选模型', '点 ↑ 生成'], owner: 'src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx#NodeGenerationComposer', deadline: USER },
      { id: 'confirming-spend', kind: 'user', visibleText: ['generationCommon.spend.confirm', 'generationCommon.spend.cancel'], actions: ['确认生成', '取消'], owner: 'src/workbench/generationCanvas/spend/spendConfirm.ts#spendConfirmationRequirement', deadline: USER },
      { id: 'queued', kind: 'system', visibleText: ['generationCommon.observability.progress.queued'], actions: ['停止'], owner: 'src/workbench/observability/narrate.ts#narrateProgress', deadline: { ref: PHASE, key: 'queued' } },
      { id: 'requesting', kind: 'system', visibleText: ['generationCommon.observability.progress.submitting'], actions: ['停止'], owner: 'src/workbench/observability/narrate.ts#narrateProgress', deadline: { ref: PHASE, key: 'requesting' } },
      { id: 'generating', kind: 'system', visibleText: ['generationCommon.observability.progress.generating', 'generationCommon.observability.progress.generatingElapsed'], actions: ['停止'], owner: 'src/workbench/observability/narrate.ts#narrateProgress', deadline: { ref: PHASE, key: 'generating' } },
      { id: 'still-generating', kind: 'system', visibleText: ['generationCommon.observability.progress.stillGenerating'], actions: ['停止'], owner: 'src/workbench/observability/narrate.ts#narrateProgress', deadline: { ref: PHASE, key: 'still-generating' } },
      { id: 'finalizing', kind: 'system', visibleText: ['generationCommon.observability.progress.finalizing'], actions: [], owner: 'src/workbench/observability/narrate.ts#narrateProgress', deadline: { ref: PHASE, key: 'finalizing' } },
      { id: 'saved-receipt', kind: 'system', visibleText: ['generationCommon.observability.progress.saved'], actions: [], owner: 'src/workbench/observability/generationFeedback.ts#savedFeedbackWindowOpen', deadline: { ref: 'src/workbench/observability/generationFeedback.ts#SAVED_FEEDBACK_WINDOW_MS' } },
      { id: 'success', kind: 'terminal', visibleText: ['generationCommon.versionCards.stackCount'], actions: ['下载', '加入时间轴', '再生成一版'], owner: 'src/workbench/generationCanvas/nodes/versionCards/NodeVersionCardsHost.tsx#NodeVersionCardsHost' },
      { id: 'error', kind: 'terminal', visibleText: ['generationCommon.observability.action.retry.main', 'generationCommon.observability.action.switchModel.main', 'generationCommon.node.providerFailed', 'generationCommon.node.switchProvider', 'generationCommon.observability.error.outputUnreadable.reason', 'generationCommon.observability.error.outputUnreadable.hint'], actions: ['重试', '换个模型', '切到另一家'], owner: 'src/workbench/observability/classifyError.ts#classifyGenerationError' },
      { id: 'recoverable', kind: 'user', visibleText: ['generationCommon.recoverable.title', 'generationCommon.production.runAction.retry-retrieval'], actions: ['重新取回（免费）', '标记失败'], owner: 'src/workbench/generationCanvas/runner/recoverTaskActions.ts#recoverNodeResult', deadline: USER },
    ].map(Object.freeze)),
    scripts: Object.freeze(['tests/ux/full-walk/playbooks/pb02-reference-image.walk.mjs', 'tests/ux/full-walk/playbooks/pb06-failure-small-window.walk.mjs', 'tests/ux/full-walk/playbooks/pb07-failure-kinds.walk.mjs', 'tests/ux/full-walk/playbooks/pb10-node-display-rules.walk.mjs', 'tests/ux/full-walk/playbooks/pb11-canvas-single-run.walk.mjs', 'tests/ux/node-params-and-version-pill.walk.mjs', 'tests/ux/full-walk/playbooks/pb90-seedream5.paid.mjs']),
    invariants: Object.freeze([1, 2, 3, 5, 7, 9]),
    metric: Object.freeze({ success: 'generation.completed{result=success}', failure: 'generation.completed{result=failure}', owner: 'src/workbench/api/taskApi.ts' }),
  }),
  Object.freeze({
    id: 'J02-image-to-video',
    title: Object.freeze({ 'zh-CN': '图转视频', en: 'Image to video' }),
    states: Object.freeze([
      { id: 'connecting', kind: 'user', visibleText: ['generationCommon.nodeEmpty.video.title', 'generationCommon.nodeEmpty.video.description'], actions: ['把图连到视频卡', '点「转视频」'], owner: 'src/workbench/generationCanvas/nodes/completeNodeConnection.ts#completeNodeConnection', deadline: USER },
      { id: 'mode-picked', kind: 'user', visibleText: ['generationCommon.parameters.model', 'generationCommon.shotConversion.firstFrame'], actions: ['换模式', '改参数', '点 ↑ 生成'], owner: 'src/workbench/generationCanvas/nodes/buildNodeModelChangePatch.ts#buildNodeModelChangePatch', deadline: USER },
      { id: 'resolving', kind: 'system', visibleText: ['generationCommon.observability.progress.submitting'], actions: ['停止'], owner: 'src/workbench/observability/narrate.ts#narrateProgress', deadline: { ref: PHASE, key: 'resolving' } },
      { id: 'generating', kind: 'system', visibleText: ['generationCommon.observability.progress.generating', 'generationCommon.observability.progress.stillGenerating'], actions: ['停止'], owner: 'src/workbench/observability/narrate.ts#narrateProgress', deadline: { ref: PHASE, key: 'generating' } },
      { id: 'finalizing', kind: 'system', visibleText: ['generationCommon.observability.progress.finalizing'], actions: [], owner: 'src/workbench/observability/narrate.ts#narrateProgress', deadline: { ref: PHASE, key: 'finalizing' } },
      { id: 'success', kind: 'terminal', visibleText: ['generationCommon.versionCards.stackCount'], actions: ['播放', '拖进时间轴'], owner: 'src/workbench/generationCanvas/nodes/versionCards/NodeVersionCardsHost.tsx#NodeVersionCardsHost' },
      { id: 'error', kind: 'terminal', visibleText: ['generationCommon.observability.action.retry.main'], actions: ['重试', '换个模型'], owner: 'src/workbench/observability/classifyError.ts#classifyGenerationError' },
    ].map(Object.freeze)),
    scripts: Object.freeze(['tests/ux/omni-video-reference-gate.walk.mjs', 'tests/ux/storyboard-first-frame-false-alarms.walk.mjs']),
    invariants: Object.freeze([1, 3, 5, 6]),
    metric: Object.freeze({ success: 'generation.completed{result=success}', failure: 'generation.completed{result=failure}', owner: 'src/workbench/api/taskApi.ts' }),
  }),
  Object.freeze({
    id: 'J03-reference-generation',
    title: Object.freeze({ 'zh-CN': '连参考图生成', en: 'Generate with a reference image' }),
    states: Object.freeze([
      { id: 'reference-connected', kind: 'user', visibleText: ['generationCommon.parameters.referencesAria'], actions: ['拖线连参考', '@ 引用素材', '断开'], owner: 'src/workbench/generationCanvas/runner/referenceSlots.ts#assignEdgeToSlot', deadline: USER },
      { id: 'uploading-reference', kind: 'system', visibleText: ['generationCommon.observability.progress.submitting'], actions: ['停止'], owner: 'electron/catalog/assetLocalization.ts#resolveAssetIngestionWithFallback', deadline: { ref: PHASE, key: 'requesting' } },
      { id: 'agent-card-waiting', kind: 'user', visibleText: ['agentPanelV4.spendParamsTitleImage_one', 'agentPanelV4.spendConfirmThisImage', 'agentPanelV4.spendRemoveThisImage'], actions: ['生成这张', '去掉这张', '×'], owner: 'src/workbench/ai/v4/spendCardDraft.ts#projectSpendNode', deadline: USER },
      { id: 'generating', kind: 'system', visibleText: ['generationCommon.observability.progress.generating'], actions: ['停止'], owner: 'src/workbench/observability/narrate.ts#narrateProgress', deadline: { ref: PHASE, key: 'generating' } },
      { id: 'success', kind: 'terminal', visibleText: ['generationCommon.versionCards.stackCount'], actions: ['下载', '设为首帧'], owner: 'src/workbench/generationCanvas/nodes/versionCards/NodeVersionCardsHost.tsx#NodeVersionCardsHost' },
      { id: 'error', kind: 'terminal', visibleText: ['generationCommon.observability.action.retry.main'], actions: ['重试'], owner: 'src/workbench/observability/classifyError.ts#classifyGenerationError' },
    ].map(Object.freeze)),
    scripts: Object.freeze(['tests/ux/full-walk/playbooks/pb02-reference-image.walk.mjs', 'tests/ux/full-walk/playbooks/pb07-storyboard-prompt-truth.walk.mjs', 'tests/ux/full-walk/playbooks/pb91-storyboard-dragon.paid.mjs', 'tests/ux/pr619-reference-task.walk.mjs']),
    invariants: Object.freeze([1, 3, 5]),
    metric: Object.freeze({ success: 'generation.completed{capability=image-edit,result=success}', failure: 'generation.completed{capability=image-edit,result=failure}', owner: 'src/workbench/api/taskApi.ts' }),
  }),
  Object.freeze({
    id: 'J04-agent-multishot-spend',
    title: Object.freeze({ 'zh-CN': 'Agent 起草多镜并付费确认', en: 'Agent drafts several shots and the user confirms the spend' }),
    states: Object.freeze([
      { id: 'agent-turn-running', kind: 'system', visibleText: ['agentPanelV4.stop'], actions: ['停止'], owner: 'electron/agentLane/laneHost.mts#LANE_IDLE_MS', deadline: { ref: 'electron/agentLane/laneHost.mts#LANE_IDLE_MS' } },
      { id: 'drafted-on-canvas', kind: 'system', visibleText: ['generationCommon.production.canvasLanding.queued'], actions: ['看占位卡'], owner: 'electron/shared/productionShotPhase.ts#deriveProductionShotState', deadline: { gap: '草稿落画布之后到出卡之间没有登记时限（出卡由同一回合的 generate 负责）' } },
      { id: 'card-waiting', kind: 'user', visibleText: ['agentPanelV4.spendParamsTitleImage_other', 'agentPanelV4.spendConfirmThisImage', 'agentPanelV4.spendRemoveThisImage'], actions: ['翻页', '生成这张', '去掉这张', '×'], owner: 'src/workbench/ai/v4/useAgentPanelSpendConfirm.ts#useAgentPanelSpendConfirm', deadline: USER },
      { id: 'shots-queued', kind: 'system', visibleText: ['generationCommon.production.canvasLanding.queuedNth'], actions: ['暂停'], owner: 'electron/shared/productionShotPhase.ts#deriveProductionShotState', deadline: { ref: 'electron/productionRun/multiShotBatchScheduler.ts#POLL_DELAY_CAP_MS' } },
      { id: 'shot-generating', kind: 'system', visibleText: ['generationCommon.observability.progress.generating'], actions: ['暂停'], owner: 'electron/shared/productionShotPhase.ts#deriveProductionShotState', deadline: { ref: PHASE, key: 'generating' } },
      { id: 'done', kind: 'terminal', visibleText: ['generationCommon.composer.regenerate'], actions: ['再出一版（选中节点后按 ↑；10-06 删了浮条的「重拍这镜」）', '下载'], owner: 'electron/shared/productionShotPhase.ts#deriveProductionShotState' },
      { id: 'failed', kind: 'terminal', visibleText: ['generationCommon.production.canvasLanding.stoppedAfterFailure'], actions: ['重试（失败卡上，走返工链、停下的批次接着跑）'], owner: 'electron/productionRun/multiShotBatchScheduler.ts#settleAtRest' },
    ].map(Object.freeze)),
    scripts: Object.freeze(['tests/ux/full-walk/playbooks/pb01-two-page-card.walk.mjs', 'tests/ux/full-walk/playbooks/pb03-default-models.walk.mjs', 'tests/ux/full-walk/playbooks/pb08-cover-card-kind.walk.mjs', 'tests/ux/core-smoke-spend-confirm.walk.mjs']),
    invariants: Object.freeze([1, 2, 3, 4, 6, 9]),
    metric: Object.freeze({ gap: '付费卡的「确认 / 收回 / 只确认当前页」没有任何上报；agent.turn.completed 在 telemetryEvents 里声明了却没有发射点' }),
  }),
  Object.freeze({
    id: 'J05-pause-resume',
    title: Object.freeze({ 'zh-CN': '暂停后继续', en: 'Pause, then resume' }),
    states: Object.freeze([
      { id: 'running', kind: 'system', visibleText: ['generationCommon.production.status.running', 'generationCommon.production.control.pause'], actions: ['暂停', '取消制作'], owner: 'src/workbench/production/productionRunView.ts#buildProductionRunView', deadline: { ref: PHASE, key: 'generating' } },
      { id: 'pausing', kind: 'system', visibleText: ['generationCommon.production.status.pausing', 'generationCommon.production.description.pausing'], actions: ['继续剩余'], owner: 'electron/productionRun/productionRunLifecycle.ts#settleRunLifecycle', deadline: { gap: '「正在安全暂停」持续到交给供应商的最后一件活收尾（收尾挂在仓库写入口上，谁写下最后一笔都一样）；那件活本身在制作批次里没有登记最长时限——调度器一直问到供应商给出终态' } },
      { id: 'paused', kind: 'user', visibleText: ['generationCommon.production.status.paused', 'generationCommon.production.canvasLanding.stoppedManual', 'generationCommon.production.canvasLanding.continueRemaining'], actions: ['继续剩余', '画布接手一镜'], owner: 'electron/shared/productionShotPhase.ts#deriveProductionShotState', deadline: USER },
      { id: 'resume-refused', kind: 'terminal', visibleText: ['generationCommon.production.canvasLanding.actionFailure.runChanged', 'generationCommon.production.canvasLanding.actionFailure.providerUnavailable', 'generationCommon.production.canvasLanding.actionFailure.runFinished'], actions: [], owner: 'electron/capabilityCore/appIntegrationProductionActions.ts#productionShotActionFailureOf' },
      { id: 'completed', kind: 'terminal', visibleText: ['generationCommon.production.status.completed'], actions: [], owner: 'src/workbench/production/productionRunView.ts#buildProductionRunView' },
    ].map(Object.freeze)),
    scripts: Object.freeze(['tests/ux/full-walk/playbooks/pb05-pause-resume.walk.mjs']),
    invariants: Object.freeze([1, 4, 5, 6]),
    metric: Object.freeze({ gap: '暂停 / 继续剩余 / 取消制作都没有上报；只有产品日志' }),
  }),
  Object.freeze({
    id: 'J06-delete-shot',
    title: Object.freeze({ 'zh-CN': '删镜头', en: 'Delete a shot' }),
    states: Object.freeze([
      { id: 'row-menu-open', kind: 'user', visibleText: ['storyboardEditor.rowMenu.deleteUndoable'], actions: ['删除'], owner: 'src/workbench/generationCanvas/agent/storyboardPlanEdits.ts#removeShotAt', deadline: USER },
      { id: 'undo-window', kind: 'system', visibleText: ['storyboardEditor.rowMenu.deleteUndoable'], actions: ['撤销'], owner: 'src/utils/showUndoToast.ts#showUndoToast', deadline: { ref: 'src/utils/showUndoToast.ts#DEFAULT_DURATION_MS' } },
      { id: 'deleted', kind: 'terminal', visibleText: [], actions: ['⌘Z'], owner: 'src/workbench/generationCanvas/agent/storyboardPlanEdits.ts#removeShotAt' },
    ].map(Object.freeze)),
    scripts: Object.freeze(['tests/ux/storyboard-table-exec.walk.mjs', 'tests/ux/creation-plan-delete-undo.walk.mjs', 'tests/ux/full-walk/playbooks/pb12-storyboard-click-expectations.walk.mjs']),
    invariants: Object.freeze([1, 2, 6]),
    metric: Object.freeze({ gap: '删镜头没有上报；删掉排队中镜头之后制作流程还会不会派它，只能靠走查看 Run' }),
  }),
  Object.freeze({
    id: 'J07-switch-model',
    title: Object.freeze({ 'zh-CN': '换模型', en: 'Switch the model' }),
    states: Object.freeze([
      { id: 'picker-open', kind: 'user', visibleText: ['generationCommon.parameters.model', 'generationCommon.parameters.provider'], actions: ['选另一个模型', '选另一家'], owner: 'src/workbench/generationCanvas/nodes/buildNodeModelChangePatch.ts#buildNodeModelChangePatch', deadline: USER },
      { id: 'switch-suggested', kind: 'user', visibleText: ['generationCommon.node.providerFailed', 'generationCommon.node.switchProvider'], actions: ['切到另一家', '关掉提示'], owner: 'src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts#useNodeModelAutoSelect', deadline: USER },
      { id: 'switched', kind: 'terminal', visibleText: ['generationCommon.parameters.model'], actions: ['点 ↑ 生成'], owner: 'src/workbench/generationCanvas/nodes/buildNodeModelChangePatch.ts#buildNodeModelChangePatch' },
    ].map(Object.freeze)),
    scripts: Object.freeze(['tests/ux/full-walk/playbooks/pb06-failure-small-window.walk.mjs', 'tests/ux/model-pick-confirm.walk.mjs']),
    invariants: Object.freeze([3, 4, 7, 9]),
    metric: Object.freeze({ gap: '换模型 / 按提示切家都没有上报' }),
  }),
  Object.freeze({
    id: 'J08-agent-attachment',
    title: Object.freeze({ 'zh-CN': '给 Agent 传附件', en: 'Attach a file to the Agent' }),
    states: Object.freeze([
      { id: 'picking', kind: 'user', visibleText: ['agentPanelV4.addAnyFile'], actions: ['选文件', '拖进来', '粘贴'], owner: 'src/workbench/ai/composer/useComposerAttachments.ts#useComposerAttachments', deadline: USER },
      { id: 'uploading', kind: 'system', visibleText: ['runtime.attachments.uploadFailed'], actions: ['移除'], owner: 'src/workbench/ai/composer/useComposerAttachments.ts#useComposerAttachments', deadline: { gap: '附件导入没有登记时限；导入卡住时签一直转' } },
      { id: 'attached', kind: 'user', visibleText: ['agentPanelV4.attachmentUnavailable'], actions: ['发送', '移除'], owner: 'src/workbench/ai/composer/useComposerAttachments.ts#useComposerAttachments', deadline: USER },
      { id: 'sent-to-model', kind: 'terminal', visibleText: [], actions: [], owner: 'electron/agentLane/laneDesktopInput.ts#createDesktopLaneInput' },
    ].map(Object.freeze)),
    scripts: Object.freeze(['tests/ux/full-walk/playbooks/pb04-script-attachment-long-chat.walk.mjs', 'tests/ux/full-walk/playbooks/pb09-agent-failure-and-receipts.walk.mjs']),
    invariants: Object.freeze([3, 5, 8]),
    metric: Object.freeze({ gap: '附件上传成功 / 失败、模型是否读到附件都没有上报' }),
  }),
  Object.freeze({
    id: 'J09-export-film',
    title: Object.freeze({ 'zh-CN': '导出成片', en: 'Export the film' }),
    states: Object.freeze([
      { id: 'timeline-ready', kind: 'user', visibleText: ['generationCommon.exportStatus.emptyTimeline'], actions: ['点「导出」'], owner: 'src/workbench/export/exportApi.ts#startTimelineMp4ExportJob', deadline: USER },
      { id: 'exporting', kind: 'system', visibleText: ['taskCenter.exportJob.statuses.rendering', 'taskCenter.exportJob.statuses.encoding', 'generationCommon.exportStatus.exporting'], actions: ['取消'], owner: 'src/workbench/taskCenter/exportJobTaskCenter.ts#buildExportJobTaskRows', deadline: { gap: '导出任务没有登记时限（渲染 / 编码 / 封装各段都没有上限）' } },
      { id: 'succeeded', kind: 'terminal', visibleText: ['taskCenter.exportJob.statuses.succeeded'], actions: ['打开文件'], owner: 'src/workbench/taskCenter/exportJobTaskCenter.ts#buildExportJobTaskRows' },
      { id: 'failed', kind: 'terminal', visibleText: ['taskCenter.exportJob.failed', 'taskCenter.exportJob.diskFull'], actions: ['重试'], owner: 'src/workbench/taskCenter/exportJobTaskCenter.ts#buildExportJobTaskRows' },
    ].map(Object.freeze)),
    scripts: Object.freeze(['tests/ux/preview-export-busy.walk.mjs', 'tests/ux/agent-runtime-video-export.walk.mjs']),
    invariants: Object.freeze([4, 5, 7]),
    metric: Object.freeze({ success: 'export.completed{result=success}', failure: 'export.completed{result=failure}', owner: 'src/workbench/export/exportApi.ts' }),
  }),
  Object.freeze({
    id: 'J10-open-old-project',
    title: Object.freeze({ 'zh-CN': '打开旧项目', en: 'Open an old project' }),
    states: Object.freeze([
      { id: 'library', kind: 'user', visibleText: ['library.recentProjects', 'library.continueCreating'], actions: ['点项目卡', '新建空白项目'], owner: 'src/workbench/library/ProjectLibraryPage.tsx#ProjectLibraryPage', deadline: USER },
      { id: 'loading', kind: 'system', visibleText: ['library.loadingProjects'], actions: [], owner: 'src/workbench/project/projectHydrationRecovery.ts#hydrateWorkbenchProjectWithRecovery', deadline: { gap: '打开 / 迁移项目没有登记时限' } },
      { id: 'opened', kind: 'terminal', visibleText: [], actions: ['继续创作'], owner: 'src/workbench/project/projectNormalize.ts#normalizeRecord' },
      { id: 'load-failed', kind: 'terminal', visibleText: ['library.loadFailedTitle', 'library.loadFailedDescription'], actions: ['重试', '打开文件夹'], owner: 'src/workbench/library/ProjectLibraryPage.tsx#ProjectLibraryPage' },
    ].map(Object.freeze)),
    scripts: Object.freeze(['tests/ux/full-walk/playbooks/pb01-two-page-card.walk.mjs', 'tests/ux/canvas-open-fit.walk.mjs', 'tests/ux/library-load-error.walk.mjs']),
    invariants: Object.freeze([5, 6, 7]),
    metric: Object.freeze({ gap: '打开项目 / 迁移失败没有上报（只有 app.started）' }),
  }),
])

/**
 * 功能清单（38 个场景 P01–P38、5 条端到端任务 T1–T5、16 个高风险回归点）里还没长成旅程的条目：
 * 挂到已有旅程上（journey），或者写明缺什么、为什么现在写不了（gap）。不许悄悄漏掉。
 */
export const FULL_WALK_INVENTORY = Object.freeze([
  ...[
    ['P01', '首次启动', { gap: '开屏 / 引导只在打包版首启出现，开发构建只能证入口在' }],
    ['P02', '新建项目', { journey: 'J10-open-old-project' }],
    ['P03', '项目管理（重命名 / 复制 / 删除 / 恢复）', { gap: '下一批剧本：项目库里的重命名、复制、删除和撤销还没有剧本' }],
    ['P04', '文稿与分镜', { journey: 'J04-agent-multishot-spend' }],
    ['P05', '单镜编辑（锁定 / 跳过 / 删除撤销）', { journey: 'J06-delete-shot' }],
    ['P06', '批量镜头设置', { gap: '下一批：分镜表批量条换模型再批量生成' }],
    ['P07', '画布加节点', { gap: '下一批：逐种节点添加（现有 design-lab-canvas-add-menu 只证菜单）' }],
    ['P08', '画布节点操作', { gap: '下一批：拖动 / 缩放 / 重命名 / 复制 / 删除 / ⌘Z 的铁律剧本（现有 canvas-node-context-menu 未接监视器）' }],
    ['P09', '编组与框', { gap: '核心冒烟已覆盖删除 + ⌘Z；拖动 / 折叠还没有接监视器' }],
    ['P10', '连线与参考', { journey: 'J03-reference-generation' }],
    ['P11', '画布导航', { gap: '核心冒烟 canvas-drag-pan-gestures 覆盖手势；小地图 / 画面小窗没有剧本' }],
    ['P12', '画布批量生成', { gap: '下一批：框选两张卡批量生成、切版本托盘' }],
    ['P13', '文生图', { journey: 'J01-generate-image' }],
    ['P14', '图生图 / 编辑', { journey: 'J03-reference-generation' }],
    ['P15', '参考生视频', { journey: 'J02-image-to-video' }],
    ['P16', '首尾帧视频', { journey: 'J02-image-to-video' }],
    ['P17', '音频', { gap: '音频节点的生成要音频夹具（本机回环只有图片 / 视频）' }],
    ['P18', '3D / 导演 / 白板', { gap: '导演台与 3D 需要 WebGL 与模型文件，走查另有 director-* 系列，未接监视器' }],
    ['P19', '本地素材导入', { gap: '下一批：拖入 / 粘贴 / 素材库上传的铁律剧本' }],
    ['P20', '网页 / 跨项目素材', { gap: '找参考要 TikHub 或测试桩；跨项目复制下一批写' }],
    ['P21', '抽帧与效果', { gap: '下一批：视频抽帧 → 连到图片卡' }],
    ['P22', '时间轴剪辑', { gap: '下一批：拖进时间轴、裁剪、分割、波纹删除' }],
    ['P23', '转场 / 字幕 / 音量', { gap: '下一批' }],
    ['P24', '预览与小窗', { gap: '下一批' }],
    ['P25', '导出 MP4', { journey: 'J09-export-film' }],
    ['P26', 'Artifact / 其他导出', { gap: '下一批：Artifact 下载扩展名' }],
    ['P27', 'Agent 对话', { journey: 'J08-agent-attachment' }],
    ['P28', 'Agent 工具', { journey: 'J04-agent-multishot-spend' }],
    ['P29', 'Agent 反问', { gap: '下一批：反问卡单选 / 多选 / 自定义回答' }],
    ['P30', '技能库 / 历史', { gap: '下一批' }],
    ['P31', '费用卡', { journey: 'J04-agent-multishot-spend' }],
    ['P32', '批次与返工', { journey: 'J05-pause-resume' }],
    ['P33', '任务中心 / 通知', { journey: 'J05-pause-resume' }],
    ['P34', '模型接入', { gap: '接入要用户自己的中转或 key；零花费夹具只能测自检流程，下一批写' }],
    ['P35', '「用 AI 帮我接入」', { gap: '要真文本模型写脚本；夹具只能证入口' }],
    ['P36', 'ComfyUI / 工作流', { gap: '要本机 ComfyUI' }],
    ['P37', 'MCP', { gap: '要外部客户端；现有 mcp-* e2e 未接监视器' }],
    ['P38', '设置通用 / 关于', { journey: 'J07-switch-model' }],
    ['T1', '做一支短片（端到端）', { gap: '串 J04 → J02 → J09；下一批用剧本拼出整条' }],
    ['T2', '参考素材创作（端到端）', { journey: 'J03-reference-generation' }],
    ['T3', '素材整理与复用（端到端）', { gap: '下一批' }],
    ['T4', '外部 Agent 制作（端到端）', { gap: '要外部 MCP 客户端' }],
    ['T5', '供应商接入后实拍（端到端）', { gap: '要真 key，只进付费小额组' }],
    ['R01', '结果地址两种形状', { gap: '夹具能回两种形状，下一批补一条' }],
    ['R02', '建连重置（换模型后连线不丢）', { journey: 'J07-switch-model' }],
    ['R03', '连参考图默认参考模式', { journey: 'J02-image-to-video' }],
    ['R04', '镜头认领 / 任务归属', { journey: 'J05-pause-resume' }],
    ['R05', 'MCP 后台启动', { gap: '要外部客户端' }],
    ['R06', 'Agent 卡死 / 超时', { journey: 'J08-agent-attachment' }],
    ['R07', '画布卡顿（300 节点）', { gap: 'tests/perf 另有基准，未接监视器' }],
    ['R08', '费用确认重复执行', { journey: 'J04-agent-multishot-spend' }],
    ['R09', '付费结果免费找回', { journey: 'J01-generate-image' }],
    ['R10', '批量参考冻结', { gap: '下一批：分镜表参考未锁定时批量' }],
    ['R11', '导出忙状态', { journey: 'J09-export-film' }],
    ['R12', '文件扩展名', { gap: '现有 agent-spend-long-output-name 覆盖，未接监视器' }],
    ['R13', '中英文切换', { journey: 'J04-agent-multishot-spend' }],
    ['R14', '亮暗模式', { gap: '下一批：每个旅程加暗色变体' }],
    ['R15', '项目切换中的后台任务', { gap: '现有 project-switch-background-run 覆盖，未接监视器' }],
    ['R16', 'MCP / Agent 写入收据', { journey: 'J08-agent-attachment' }],
  ].map(([id, title, link]) => Object.freeze({ id, title, ...link })),
])
