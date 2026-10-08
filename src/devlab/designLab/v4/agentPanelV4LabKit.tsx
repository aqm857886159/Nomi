// 设计实验室 · Agent 面板 v4 · 取景台与共用夹具
//
// **两种取景框，对应定稿画布的两种板**：
//   - `Piece`：只渲**那一个积木**，宽度钉死 390（= 面板宽）。Vocabulary 板与 Composer 板画的
//     就是单个积木的状态阵列，所以实验室这两组也只渲那一件。
//     早先那版把 44 个状态全渲成整块面板，于是接触表三列近乎一样——
//     `v4-composer-idle` 那一格里 composer 只占底部 86px，其余 534px 是和它无关的对话流，
//     用户根本看不出「空闲 / 运行中 / 带引用」差在哪。取景框错了，证据就是假的。
//   - `AgentPanelV4Panel`（组件自带）：Flow 三板 + Rendering + Dark 画的是整块面板，那才渲整块。
//
// 夹具文案一律走 i18n（R15）：实验室渲的是**现役组件**，组件里留硬编码中文会直接把
// `check:i18n` 的欠账基线顶高——实验室不是法外之地。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { holdDesignLabReady } from '../labReadyHold'
import type {
  ContextUsage,
  InterventionData,
  QueueRowData,
  TaskCardData,
  ToolReceipt,
  V4Chip,
} from '../../../workbench/ai/v4/agentPanelV4Types'
import type { V4FlowItem } from '../../../workbench/ai/v4/AgentPanelV4Panel'
import type { V4CommandRow, V4ModelRow } from '../../../workbench/ai/v4/AgentPanelV4Composer'

/** 面板宽度 = 定稿的 390（可拖 320–520，< 320 收成 rail）。 */
/**
 * 取景位没有宿主：介入槽的写口在生产里是**必填**（R28——少接一根线就该编译不过），
 * 所以实验室要**显式**写一份空壳，而不是靠 prop 可选来蒙混。
 * 摆在这儿的是长相，不是行为；按下去没有去处是这些格子的既定语义。
 */
export const V4_LAB_SLOT_HANDLERS = Object.freeze({
  onPlanToggle: () => undefined,
  onCollapsePlan: () => undefined,
  /**
   * 反问卡那颗 ×（与「跳过」）的去处。实验室没有宿主可跳过，但仍要**显式**接上——
   * 不接就等于那颗钮在取景里整个消失，而我是靠这些截图去和 Approval Card 实物对账的。
   * 一颗没接线的钮和一颗设计上就没有的钮，在截图里长得一模一样（2026-09-21 实测栽过）。
   */
  onReject: () => undefined,
  /** 付费卡「生成剩下 N 张」（2026-10-01）：同上，不接这颗钮在取景里就整个消失。 */
  onBatch: () => undefined,
})

export const V4_PANEL_WIDTH = 390
/** 接触表格子高度：装得下最高的一格（计划槽 + 四行勾选）。 */
export const V4_CELL_HEIGHT = 700

/**
 * 单个积木的取景框。给一个浅灰底衬托「无框」的助手文本——
 * 没有底衬时纯文本积木在白底上看不出边界，截图里像什么都没渲。
 */
export function Piece({
  children,
  width = V4_PANEL_WIDTH,
}: {
  children: React.ReactNode
  width?: number
}): JSX.Element {
  return (
    <div
      style={{ width }}
      className="flex flex-col gap-2.5 rounded-nomi border border-nomi-line-soft bg-nomi-paper p-2.5"
      data-v4-piece="true"
    >
      {children}
    </div>
  )
}

export function useV4Fixtures() {
  const { t, i18n } = useTranslation()
  // `locale` 跟着夹具一起给出去：金额怎么印看界面语言（`formatMoney`），实验室与生产同一条路。
  return React.useMemo(() => ({ ...buildFixtures(t), locale: i18n.language }), [t, i18n.language])
}

export function useV4Locale(locale: 'zh-CN' | 'en'): boolean {
  const { i18n } = useTranslation()
  const [ready, setReady] = React.useState(i18n.language === locale)
  React.useLayoutEffect(() => {
    if (i18n.language === locale) { setReady(true); return undefined }
    const release = holdDesignLabReady(`v4-vocabulary:locale:${locale}`)
    void i18n.changeLanguage(locale).then(() => { setReady(true); release() })
    return release
  }, [locale])
  return ready
}

/** 夹具照定稿画布逐格抄：同一句话、同一个数字，才比得出实现有没有走样。 */
function buildFixtures(t: TFunction) {
  const chip = (kind: V4Chip['kind'], label: string): V4Chip => ({ kind, label })

  const context: ContextUsage = {
    used: 62400,
    max: 200000,
    input: t('agentPanelV4.contextInput'),
    output: t('agentPanelV4.contextOutput'),
    reasoning: t('agentPanelV4.contextReasoning'),
    cache: t('agentPanelV4.contextCache'),
    cost: t('agentPanelV4.contextCost'),
  }

  const readTimeline = (over: Partial<ToolReceipt> = {}): ToolReceipt => ({
    label: t('agentPanelV4.fixtureReadTimeline'),
    action: 'timeline',
    status: 'output-available',
    summary: t('agentPanelV4.fixtureReadTimelineSummary'),
    trailing: t('agentPanelV4.fixtureElapsedFast'),
    ...over,
  })

  const receipts = {
    running: readTimeline({ status: 'input-streaming', summary: undefined, trailing: undefined }),
    inputAvailable: readTimeline({ status: 'input-available', trailing: undefined }),
    approvalRequested: readTimeline({ status: 'approval-requested', summary: undefined, trailing: undefined }),
    approvalResponded: readTimeline({ status: 'approval-responded', summary: undefined, trailing: undefined }),
    done: readTimeline({
      output: t('agentPanelV4.fixtureReadTimelineOutput'),
    }),
    expanded: readTimeline({
      expanded: true,
      output: t('agentPanelV4.fixtureReadTimelineOutput'),
    }),
    denied: readTimeline({ status: 'output-denied', summary: undefined, trailing: undefined }),
    error: {
      label: t('agentPanelV4.fixtureReadTimeline'),
      action: 'timeline',
      status: 'output-error',
      trailing: t('agentPanelV4.fixtureProjectClosed'),
    } satisfies ToolReceipt,
    skill: {
      label: t('agentPanelV4.fixtureLoadSkill'),
      action: 'skill',
      status: 'output-available',
      summary: t('agentPanelV4.fixtureLoadSkillSummary'),
      trailing: '',
    } satisfies ToolReceipt,
    attachment: {
      label: t('agentPanelV4.fixtureReadAttachment'),
      action: 'attachment',
      status: 'output-available',
      summary: t('agentPanelV4.fixtureReadAttachmentSummary'),
      trailing: '',
    } satisfies ToolReceipt,
    layout: {
      label: t('agentPanelV4.fixtureCollapseInspector'),
      action: 'layout',
      status: 'output-available',
      trailing: '',
      undoable: true,
    } satisfies ToolReceipt,
    videoFailed: {
      label: t('agentPanelV4.fixtureGenVideo'),
      action: 'video',
      status: 'output-error',
      trailing: t('agentPanelV4.taskStatus.failed'),
    } satisfies ToolReceipt,
    stopped: {
      label: t('agentPanelV4.fixtureGenImages'),
      action: 'image',
      status: 'output-denied',
      summary: '2 / 4',
      trailing: t('agentPanelV4.fixtureStopped'),
    } satisfies ToolReceipt,
    readDoc: {
      label: t('agentPanelV4.fixtureReadDoc'),
      action: 'document',
      status: 'output-available',
      summary: t('agentPanelV4.fixtureReadDocSummary'),
      trailing: t('agentPanelV4.fixtureElapsedRead'),
      output: t('agentPanelV4.fixtureReadTimelineOutput'),
    } satisfies ToolReceipt,
    draftShots: {
      label: t('agentPanelV4.fixtureDraftShots'),
      action: 'plan',
      status: 'input-streaming',
    } satisfies ToolReceipt,
    skillShots: {
      label: t('agentPanelV4.fixtureLoadSkill'),
      action: 'skill',
      status: 'output-available',
      summary: `${t('agentPanelV4.skillShots')} /shots`,
      trailing: '',
    } satisfies ToolReceipt,
    draftEdits: {
      label: t('agentPanelV4.fixtureDraftEdits'),
      action: 'plan',
      status: 'output-available',
      trailing: '',
    } satisfies ToolReceipt,
  }

  const tasks: Record<string, TaskCardData> = {
    queued: {
      title: t('agentPanelV4.fixtureGenImageOne'),
      action: 'image',
      status: 'queued',
      trailing: t('agentPanelV4.fixtureQueuePos'),
    },
    running: {
      title: t('agentPanelV4.fixtureGenImageOne'),
      action: 'image',
      status: 'running',
      trailing: t('agentPanelV4.fixtureRunningSeconds'),
      excerpt: t('agentPanelV4.fixtureExcerpt'),
      params: ['GPT Image 2', '16:9', '2K'],
      cost: '≈ ¥0.12',
      progress: 45,
    },
    complete: {
      title: t('agentPanelV4.fixtureGenImagesThree'),
      action: 'image',
      status: 'complete',
      trailing: t('agentPanelV4.fixtureCostThree'),
      candidates: [{ tag: t('agentPanelV4.adopt'), adopted: true }, { tag: '2' }, { tag: '3' }],
      footnote: t('agentPanelV4.fixtureAdoptHint'),
      undoable: true,
    },
    failed: {
      title: t('agentPanelV4.fixtureGenVideo'),
      action: 'video',
      status: 'failed',
      error: t('agentPanelV4.fixtureVendorFailure'),
      errorAction: t('agentPanelV4.fixtureRetryOtherModel'),
    },
    stopped: {
      title: t('agentPanelV4.fixtureGenVideo'),
      action: 'video',
      status: 'stopped',
      trailing: t('agentPanelV4.fixtureFramesDone'),
    },
    fourRefs: {
      title: t('agentPanelV4.fixtureGenImages'),
      action: 'image',
      status: 'running',
      trailing: t('agentPanelV4.fixtureCostFour'),
      params: ['NanoBanana 2', '16:9', '2K'],
      // 角标逐字照画布 FlowGeneration 板：前两张已完成、第三张在跑、第四张排队。
      candidates: [
        { tag: '1 ✓' },
        { tag: '2 ✓', adopted: true },
        { tag: '3 …', pending: true },
        { tag: `4 ${t('agentPanelV4.taskStatus.queued')}`, pending: true },
      ],
      progress: 50,
      footnote: t('agentPanelV4.fixtureOnCanvasHint'),
      footnoteTrailing: t('agentPanelV4.fixtureCostSpent'),
    },
    trimApplied: {
      title: t('agentPanelV4.fixtureTrimAndShift'),
      action: 'edit',
      status: 'complete',
      trailing: t('agentPanelV4.fixtureNoCharge'),
      footnote: t('agentPanelV4.fixtureTwoEditsUndo'),
      undoable: true,
    },
  }

  const slots: Record<string, InterventionData> = {
    irreversible: {
      kind: 'approval-irreversible',
      title: t('agentPanelV4.slotDeleteNodes'),
      badge: t('agentPanelV4.slotIrreversible'),
      summary: t('agentPanelV4.slotDeleteSummary'),
      scope: t('agentPanelV4.slotScopeOnce'),
      confirmLabel: t('agentPanelV4.slotDelete'),
    },
    reversible: {
      kind: 'approval-reversible',
      title: t('agentPanelV4.slotTrim'),
      badge: t('agentPanelV4.slotReversible'),
      scope: t('agentPanelV4.slotTrimScope'),
    },
    rejectReason: {
      kind: 'reject-reason',
      title: t('agentPanelV4.slotTrim'),
      scope: t('agentPanelV4.slotRejectReason'),
      reasonPlaceholder: t('agentPanelV4.slotRejectSample'),
    },
    // 夹具的字段要和**生产投影** `projectSpendCard` 对得上，否则实验室画的是另一张卡
    // ——这个坑这条 lane 上已经踩过两次（卡头「需要你定一下」、幽灵的「换模型」按钮）。
    // 生产投影今天产出（多镜、报得出价）：问话式 `title` + `badge` + 翻页器 + 翻页行右端的 `totalLead`
    // + 动作行最左的「生成剩下 N 段」+ 右边「去掉这段」和主按钮（2026-10-01 排布）。
    spend: {
      kind: 'spend',
      title: t('agentPanelV4.slotSpendTitle'),
      badge: t('agentPanelV4.slotSpendBadge'),
      pager: { index: 0, total: 4, keyHint: t('agentPanelV4.pagerKeyHint') },
      // 单位跟标题同一条规则（这一叠是视频，说「段」；2026-10-01 用户拍板）。
      totalLead: t('agentPanelV4.spendTotalLeadVideo', { count: 4, amount: '¥1.20' }),
      alternateLabel: t('agentPanelV4.spendRemoveThisVideo'),
      batchLabel: t('agentPanelV4.spendConfirmRemainingVideo', { count: 4 }),
      params: ['Kling O1', '4 × 3s', 'std', '¥1.20'],
      confirmLabel: t('agentPanelV4.slotGenerate'),
    },
    // 反问三格共用同一张卡（2026-09-21：反问是**通用**能力，不为某一种问题写死）。
    // 长相差别只来自数据：有没有说明 / 有没有熔断那句话 / 卡内那一行有没有字。
    question: {
      kind: 'question',
      title: t('agentPanelV4.slotQuestionTitle'),
      options: [
        { id: 'calm', label: t('agentPanelV4.slotOptionVoiceCalm'), description: t('agentPanelV4.slotOptionVoiceCalmWhy'), recommended: true },
        { id: 'urgent', label: t('agentPanelV4.slotOptionVoiceUrgent'), description: t('agentPanelV4.slotOptionVoiceUrgentWhy') },
        { id: 'warm', label: t('agentPanelV4.slotOptionVoiceWarm') },
      ],
    },
    // ── 通用性的六种问法（2026-09-21 用户：「只有那一种反问就离谱了」）──
    // 每一格换一个**题目**，不是换一套皮肤：证的是同一张卡什么都能问。
    // 上面那格（3 个选项 · 有说明 · 有推荐）原本问的是画幅，已换成口吻——
    // 契约里从来没有「画幅」这个字段，夹具里也不该有，否则读代码的人会以为它是专用的。
    /** ① 一个选项都没有：纯自由作答。缺参数、开放式问题常常就是这样。 */
    questionFree: {
      kind: 'question',
      title: t('agentPanelV4.slotQuestionFreeTitle'),
      summary: t('agentPanelV4.slotQuestionFreeNote'),
    },
    /** ② 只有 2 个选项（拍板区间的下界）。 */
    questionTwo: {
      kind: 'question',
      title: t('agentPanelV4.slotQuestionTwoTitle'),
      options: [
        { id: 'shot-3', label: t('agentPanelV4.slotQuestionTwoOptionA'), description: t('agentPanelV4.slotQuestionTwoOptionAWhy'), recommended: true },
        { id: 'shot-5', label: t('agentPanelV4.slotQuestionTwoOptionB'), description: t('agentPanelV4.slotQuestionTwoOptionBWhy') },
      ],
    },
    /**
     * ③ 4 个选项（上界），且标签与说明**长短差得很远**——其中一条 EN 说明是刻意写长的。
     * 这一格是为换行准备的：英文串本来就比中文长 1.5–2 倍，截断只有眼睛看得出来。
     */
    questionFourMixed: {
      kind: 'question',
      title: t('agentPanelV4.slotQuestionMixedTitle'),
      options: [
        { id: 'png', label: t('agentPanelV4.slotQuestionMixedOptionA'), description: t('agentPanelV4.slotQuestionMixedOptionAWhy') },
        { id: 'jpeg', label: t('agentPanelV4.slotQuestionMixedOptionB'), description: t('agentPanelV4.slotQuestionMixedOptionBWhy'), recommended: true },
        { id: 'webp', label: t('agentPanelV4.slotQuestionMixedOptionC') },
        { id: 'both', label: t('agentPanelV4.slotQuestionMixedOptionD'), description: t('agentPanelV4.slotQuestionMixedOptionDWhy') },
      ],
    },
    /** ④ 只有标签、一条说明都没有（模型不写我们就不替它编）。 */
    questionLabelsOnly: {
      kind: 'question',
      title: t('agentPanelV4.slotQuestionLabelsTitle'),
      options: [
        { id: 'v1', label: t('agentPanelV4.slotQuestionLabelsOptionA') },
        { id: 'v2', label: t('agentPanelV4.slotQuestionLabelsOptionB') },
        { id: 'v3', label: t('agentPanelV4.slotQuestionLabelsOptionC') },
        { id: 'none', label: t('agentPanelV4.slotQuestionLabelsOptionD') },
      ],
    },
    /** ⑥ 缺参数这个**生产者**（⑤ 熔断在下面）：同一张卡，只是问句由宿主补一句人话。 */
    questionMissingParam: {
      kind: 'question',
      title: t('agentPanelV4.slotQuestionMissingTitle'),
      summary: t('agentPanelV4.slotQuestionMissingNote'),
      options: [
        { id: '3s', label: t('agentPanelV4.slotQuestionMissingOptionA') },
        { id: '5s', label: t('agentPanelV4.slotQuestionMissingOptionB'), description: t('agentPanelV4.slotQuestionMissingOptionBWhy'), recommended: true },
      ],
    },
    /**
     * ⑦ **多题一张卡**（Approval Card 的「一次一题、卡高随题滑动、左下 1/3」）。
     *
     * 今天**没有生产者**：对外契约 `askUserInputSchema` 一次只收一题。这一格是
     * 卡的能力取景，不是一条已接线的旅程——所以它只进实验室，不进真机走查的断言。
     * 契约哪天长出 `questions[]`，`askCardQuestions()` 改一个函数就接上了。
     */
    questionThree: {
      kind: 'question',
      title: t('agentPanelV4.slotQuestionTwoTitle'),
      questions: [
        {
          question: t('agentPanelV4.slotQuestionTwoTitle'),
          options: [
            { id: 'shot-3', label: t('agentPanelV4.slotQuestionTwoOptionA'), description: t('agentPanelV4.slotQuestionTwoOptionAWhy'), recommended: true },
            { id: 'shot-5', label: t('agentPanelV4.slotQuestionTwoOptionB'), description: t('agentPanelV4.slotQuestionTwoOptionBWhy') },
          ],
        },
        {
          // 第二题是**多选**：标记从圆点变方框，主按钮等用户按（不自动前进）。
          question: t('agentPanelV4.slotQuestionMixedTitle'),
          multiSelect: true,
          options: [
            { id: 'png', label: t('agentPanelV4.slotQuestionMixedOptionA'), description: t('agentPanelV4.slotQuestionMixedOptionAWhy') },
            { id: 'jpeg', label: t('agentPanelV4.slotQuestionMixedOptionB'), description: t('agentPanelV4.slotQuestionMixedOptionBWhy'), recommended: true },
            { id: 'webp', label: t('agentPanelV4.slotQuestionMixedOptionC') },
          ],
        },
        {
          // 第三题一个选项都没有：末题的主按钮印「发送」，卡高缩到只剩一行输入。
          question: t('agentPanelV4.slotQuestionFreeTitle'),
          options: [],
        },
      ],
    },
    /** ⑧ 多选**单独**一格（上面那格要翻到第二题才看得到，静态取景看不见）。 */
    questionMulti: {
      kind: 'question',
      title: t('agentPanelV4.slotQuestionMixedTitle'),
      questions: [{
        question: t('agentPanelV4.slotQuestionMixedTitle'),
        multiSelect: true,
        options: [
          { id: 'png', label: t('agentPanelV4.slotQuestionMixedOptionA'), description: t('agentPanelV4.slotQuestionMixedOptionAWhy') },
          { id: 'jpeg', label: t('agentPanelV4.slotQuestionMixedOptionB'), description: t('agentPanelV4.slotQuestionMixedOptionBWhy'), recommended: true },
          { id: 'webp', label: t('agentPanelV4.slotQuestionMixedOptionC') },
          { id: 'both', label: t('agentPanelV4.slotQuestionMixedOptionD'), description: t('agentPanelV4.slotQuestionMixedOptionDWhy') },
        ],
      }],
    },
    // 熔断转提问：同一字段连着 3 次没过，就别再撞了。**复用同一张卡**——
    // 它只是这张卡的第三个生产者，不是第二种长相。
    questionRetry: {
      kind: 'question',
      title: t('agentPanelV4.slotQuestionRetryTitle'),
      summary: t('agentPanelV4.questionRetryExhausted', { count: 3 }),
      options: [
        { id: 'reference', label: t('agentPanelV4.slotOptionAsReference') },
        { id: 'shot', label: t('agentPanelV4.slotOptionAsShot') },
        { id: 'mixed', label: t('agentPanelV4.slotOptionMixed') },
      ],
    },
    plan: {
      kind: 'plan',
      title: t('agentPanelV4.slotPlanTitle'),
      badge: t('agentPanelV4.fixtureCostFour'),
      plan: [
        { label: t('agentPanelV4.slotPlanShot1'), detail: '3.0s', checked: true },
        { label: t('agentPanelV4.slotPlanShot2'), detail: '4.0s', checked: true },
        { label: t('agentPanelV4.slotPlanShot3'), detail: '4.0s', checked: false },
        { label: t('agentPanelV4.slotPlanShot4'), detail: '4.0s', checked: true },
      ],
      confirmLabel: t('agentPanelV4.slotPlanConfirm'),
      alternateLabel: t('agentPanelV4.slotPlanAlternate'),
    },
    credential: {
      kind: 'credential',
      title: t('agentPanelV4.slotCredentialTitle'),
      scope: t('agentPanelV4.slotCredentialScope'),
      confirmLabel: t('agentPanelV4.slotCredentialConfirm'),
      alternateLabel: t('agentPanelV4.slotCredentialAlternate'),
    },
    deviation: {
      kind: 'deviation',
      title: t('agentPanelV4.slotDeviationTitle'),
      // 「有出入」这一格今天只活在实验室里（投影层没有任何一条路产出 `deviation`）。
      // 选项形状跟着反问那份契约走——同一个组件读同一份数据，不为一格开第二种写法。
      options: [
        { id: 'draw', label: t('agentPanelV4.slotDeviationDraw') },
        { id: 'skip', label: t('agentPanelV4.slotDeviationSkip') },
      ],
      selectedOption: 1,
    },
    spendOneClip: {
      kind: 'spend',
      title: t('agentPanelV4.slotSpendOneTitle'),
      badge: t('agentPanelV4.slotSpendBadge'),
      params: ['Kling O1', '3s', 'std', '16:9', '¥0.90'],
      scope: t('agentPanelV4.slotSpendOneScope'),
      confirmLabel: t('agentPanelV4.slotGenerate'),
    },
    threeEdits: {
      kind: 'approval-reversible',
      title: t('agentPanelV4.slotThreeEdits'),
      badge: t('agentPanelV4.slotReversible'),
      plan: [
        { label: t('agentPanelV4.slotEditTransition'), checked: true },
        { label: t('agentPanelV4.slotEditCaption'), checked: true },
        { label: t('agentPanelV4.slotEditVolume'), checked: true },
      ],
    },
  }

  const queues: Record<string, readonly QueueRowData[]> = {
    mixed: [
      { title: t('agentPanelV4.queueOne'), status: 'running' },
      {
        title: t('agentPanelV4.queueTwo'),
        status: 'queued',
        actions: [t('agentPanelV4.queueJumpAhead')],
        destructiveAction: t('agentPanelV4.queueDelete'),
      },
      {
        title: t('agentPanelV4.queueThree'),
        status: 'queued',
        actions: [t('agentPanelV4.queueJumpAhead')],
        destructiveAction: t('agentPanelV4.queueDelete'),
      },
    ],
    interrupt: [
      { title: t('agentPanelV4.queueOne'), status: 'complete' },
      { title: t('agentPanelV4.queueTwo'), status: 'running', actions: [t('agentPanelV4.queueInterrupt')] },
    ],
    one: [{ title: t('agentPanelV4.queueMakeVideo'), status: 'queued', actions: ['1'], destructiveAction: t('agentPanelV4.queueDelete') }],
  }

  const chips = {
    attachment: chip('file', t('agentPanelV4.fixtureAttachmentName')),
    skill: chip('skill', t('agentPanelV4.fixtureSkillChip')),
    clip: chip('clip', t('agentPanelV4.fixtureClipChip')),
    shot: chip('clip', t('agentPanelV4.fixtureShotChip')),
  }

  /** Flow 三板的完整对话流，逐条对着画布抄。 */
  const flows: Record<string, readonly V4FlowItem[]> = {
    creation: [
      { kind: 'user', text: t('agentPanelV4.fixtureUserRead') },
      { kind: 'tool', receipt: receipts.readDoc },
      { kind: 'assistant', text: t('agentPanelV4.fixtureAssistantLongest'), status: 'complete' },
      { kind: 'user', text: t('agentPanelV4.fixtureUserShots') },
      { kind: 'tool', receipt: receipts.skillShots },
      { kind: 'tool', receipt: receipts.draftShots },
      { kind: 'assistant', text: t('agentPanelV4.fixtureAssistantPlan'), status: 'streaming' },
    ],
    generation: [
      { kind: 'user', text: t('agentPanelV4.fixtureUserRefs') },
      { kind: 'task', task: tasks.fourRefs },
      { kind: 'user', text: t('agentPanelV4.fixtureUserToVideo'), chips: [chips.shot] },
    ],
    preview: [
      { kind: 'user', text: t('agentPanelV4.fixtureUserTrim'), chips: [chips.clip] },
      { kind: 'tool', receipt: receipts.done },
      { kind: 'assistant', text: t('agentPanelV4.fixtureAssistantTrim'), status: 'complete' },
      { kind: 'task', task: tasks.trimApplied },
      { kind: 'user', text: t('agentPanelV4.fixtureUserThreeEdits') },
      { kind: 'tool', receipt: receipts.draftEdits },
    ],
    rendering: [{ kind: 'assistant', text: t('agentPanelV4.fixtureMarkdown'), status: 'complete' }],
    dark: [
      { kind: 'user', text: t('agentPanelV4.fixtureUserTrim') },
      { kind: 'tool', receipt: receipts.done },
      { kind: 'assistant', text: t('agentPanelV4.fixtureAssistantTrim'), status: 'complete' },
      { kind: 'task', task: tasks.complete },
      { kind: 'task', task: tasks.failed },
    ],
  }

  // 两个弹层接线后是**受控**的：清单由容器给（模型来自目录、命令来自技能 + 提示词库）。
  // 实验室这两格照定稿画布逐行抄同一份清单，取的是「同样的数据长同样的样子」这件事。
  // 每行**一个下拉**（`NomiSelect`）。此前这里是一段静态胶囊文字，接线后的生产版
  // 却退化成「17 行都叫『对话』、一个下拉都没有」——两边谁都不是定稿的样子。
  // 现在实验室与生产渲染的是同一个 `V4ModelRow`：一行 = 一个决定 + 它的可选项。
  const modelRows: readonly V4ModelRow[] = [
    {
      slot: t('agentPanelV4.modelChat'),
      name: t('agentPanelV4.chatModel'),
      selectedValue: 'chat',
      options: [{ value: 'chat', label: t('agentPanelV4.chatModel') }],
    },
    {
      slot: t('agentPanelV4.imageDefault'),
      name: t('agentPanelV4.imageModel'),
      cost: t('agentPanelV4.imagePrice'),
      selectedValue: 'image',
      options: [{ value: '', label: t('agentPanelV4.modelAuto') }, { value: 'image', label: t('agentPanelV4.imageModel') }],
    },
    {
      slot: t('agentPanelV4.videoDefault'),
      name: t('agentPanelV4.videoModel'),
      cost: t('agentPanelV4.videoPrice'),
      selectedValue: 'video',
      options: [{ value: '', label: t('agentPanelV4.modelAuto') }, { value: 'video', label: t('agentPanelV4.videoModel') }],
    },
  ]

  /**
   * 「同一个工具连着失败六次」那一段（2026-09-06 打包版真实场景）。
   * 折叠层的产出是两条：一行 `tool-group` + 一条 `process`——实验室渲的就是它们。
   */
  const retryStretch: readonly V4FlowItem[] = [
    {
      kind: 'tool-group',
      label: t('agentPanelV4.fixtureShotCard'),
      action: 'canvas',
      status: 'output-error',
      count: 6,
      trailing: t('agentPanelV4.toolGroupAllFailed'),
      reason: t('agentPanelV4.fixtureShotCardReason'),
      receipts: Array.from({ length: 6 }, () => ({
        label: t('agentPanelV4.fixtureShotCard'),
        action: 'canvas' as const,
        status: 'output-error' as const,
        summary: t('agentPanelV4.fixtureShotCardReason'),
        trailing: t('agentPanelV4.fixtureElapsedFast'),
        output: t('agentPanelV4.fixtureShotCardReason'),
      })),
    },
    {
      kind: 'process',
      label: t('agentPanelV4.processAttempts', { count: 6 }),
      segments: [t('agentPanelV4.fixtureProcessOne'), t('agentPanelV4.fixtureProcessTwo')],
    },
  ]

  const commandCategories: readonly string[] = [
    t('agentPanelV4.skillAll'),
    t('agentPanelV4.sectionSkills'),
    t('agentPanelV4.sectionPrompts'),
  ]

  /** `/` 菜单两段：技能 + 提示词（2026-09-06 拍板 ⑤ 把提示词库并进同一个菜单）。 */
  const commandRows: readonly V4CommandRow[] = [
    { id: 'skill:kasdan', name: t('agentPanelV4.skillKasdan'), command: '/kasdan', desc: t('agentPanelV4.skillKasdanDesc'), section: t('agentPanelV4.sectionSkills'), selected: true },
    { id: 'skill:shots', name: t('agentPanelV4.skillShots'), command: '/shots', desc: t('agentPanelV4.skillShotsDesc'), section: t('agentPanelV4.sectionSkills') },
    { id: 'skill:pace', name: t('agentPanelV4.skillPace'), command: '/pace', desc: t('agentPanelV4.skillPaceDesc'), section: t('agentPanelV4.sectionSkills') },
    { id: 'prompt:ad', name: t('agentPanelV4.skillAd'), command: '/product-ad', desc: t('agentPanelV4.skillAdDesc'), section: t('agentPanelV4.sectionPrompts') },
  ]

  return { context, receipts, tasks, slots, queues, chips, flows, retryStretch, modelRows, commandRows, commandCategories, t }
}
