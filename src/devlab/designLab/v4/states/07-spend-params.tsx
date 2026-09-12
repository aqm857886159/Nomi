// 设计实验室 · Agent 面板 v4 · **付费卡 v2 = 画布节点的生成框整件进介入槽** + 「全自动」档
//
// v1 被用户当场打回（2026-09-10 20:30）。原话：
//   「太丑了，和我们的不一样。你没有用我们下面那种一行的模式：**上边是提示词，下边是那些参数组件**，
//     然后只是你需要用卡，下面再加一些东西。四段视频你都没给我提示词。要和画布里一样的真实体验：
//     提示词，下面控件，能选；生成就生成，不生成就擦掉。后面还有卡就左右翻；批量的话看完也有批量生成按钮。」
//
// v1 错在哪：它把节点那条**参数条**摘出来贴进卡里，却把参数条上面那半件——提示词——留在了画布上。
// 于是四段视频的卡上一个字的提示词都没有，用户要确认的东西（这镜到底拍什么）根本不在卡上。
// 参数条竖排（`layout="stacked"`）更是把「一行」拆成了两行，长得和画布上那条不是一个东西。
//
// v2 的做法只有一句话：**整件 `NodeGenerationComposer` 进来**（`host="panel"`）。
// 卡壳只负责它周围那圈东西——槽头 / 翻页器 / 价格行 / 动作，卡体里一个像素都不是这里画的。
//
// **v3（2026-09-10 21:20 用户看过 v2 后的反馈）**：「卡整体没问题，主要是排版：参数摆得不齐、
// 还上下两行。卡里不需要优化/运镜/更多（都写完了还优化啥）。模型和参数在前，缩成一行。
// 加键盘左右翻页。」三处改动：
//   ① 卡体底栏只剩 `[模型 ▾] [参数 ▾] [×N ▾]` 恒一行——更多/运镜/优化/锁由 `host="panel"` 关掉，
//      展开的参数面板搬到底栏**下面**那个落点（`inlinePanelSlot`），不再把那一排挤成两行；
//   ② 「全部生成」那颗次按钮删掉，改成翻页器旁的范围切换 `逐镜 | 全部`，主按钮自己改口
//      （2026-09-10 按钮规则：一屏一个主动作、批量不是第二颗文字按钮）；「不要」换成一颗 ×；
//   ③ 卡聚焦时 ← → 翻页，翻页器后面印两个箭头当提示。
//
// 这一格是真的能点：
//   · 模型来自**现役目录链**（`seedModelCatalogForTests` 只种最外面那次取数，
//     认档案 / 算参数 / 渲染全部照常走），改模型是节点上那同一个下拉；
//   · 提示词是 `PromptEditor` 本人，打字直接写回 `useGenerationCanvasStore`；
//   · 参数改完，下面那行价格当场重算——因为它就是从同一份 meta 读出来的。
import React from 'react'
import { V4Intervention } from '../../../../workbench/ai/v4/AgentPanelV4Cards'
import { V4AutoModeBanner } from '../../../../workbench/ai/v4/AgentPanelV4AutoMode'
import { AgentPanelV4Composer } from '../../../../workbench/ai/v4/AgentPanelV4Composer'
import { useV4Labels } from '../../../../workbench/ai/v4/agentPanelV4Labels'
import type { InterventionData } from '../../../../workbench/ai/v4/agentPanelV4Types'
import NodeGenerationComposer from '../../../../workbench/generationCanvas/nodes/NodeGenerationComposer'
import { useGenerationCanvasStore } from '../../../../workbench/generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../../../workbench/workbenchStore'
import type { GenerationCanvasNode } from '../../../../workbench/generationCanvas/model/generationCanvasTypes'
import { seedModelCatalogForTests } from '../../../../config/modelCatalogCache'
import { useGenerationModelOptionsState } from '../../../../workbench/generationCanvas/adapters/modelOptionsAdapter'
import type { ModelOption } from '../../../../config/models'
import { Piece, useV4Fixtures, V4_LAB_SLOT_HANDLERS } from '../agentPanelV4LabKit'
import type { LabState } from '../../labScreen'

const SOURCE = '2026-09-10-spend-card-node-params-and-full-auto.md'
const MIRRORS = 'src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx:295'

/**
 * 目录里的三个视频模型。`modelKey` 是**真身份串**——`resolveArchetypeForModel` 靠它认档案，
 * 写错一个字这一格就退回「认不出的模型」那条路，参数全没了。
 * label 用拉丁名：模型名不翻译，也不该占用 i18n 词条（R15 管的是**我们写的**可见文字）。
 */
const KLING: ModelOption = {
  value: 'kling-3.0/video',
  modelKey: 'kling-3.0/video',
  vendor: 'kie',
  vendorName: 'kie',
  label: 'Kling 3.0',
  kind: 'video',
}
const MODEL_OPTIONS: readonly ModelOption[] = [
  KLING,
  { value: 'seedance-2.5', modelKey: 'seedance-2.5', vendor: 'apimart', vendorName: 'APIMart', label: 'Seedance 2.5', kind: 'video' },
  { value: 'minimax-hailuo-3', modelKey: 'minimax-hailuo-3', vendor: 'apimart', vendorName: 'APIMart', label: 'Hailuo 3', kind: 'video' },
]

/**
 * 目录 health：无桥环境里 `getCatalogHealth()` 会抛，参数条上会挂一句「目录连不上」。
 * 那是实验室环境的噪音，不是形态，所以一并种一份健康的。
 */
const HEALTH = {
  ok: true,
  counts: { vendors: 2, enabledVendors: 2, models: 3, enabledModels: 3, mappings: 3, enabledMappings: 3, enabledApiKeys: 2 },
  byKind: [{ kind: 'video' as const, enabledModels: 3, executableModels: 3 }],
  issues: [],
}

/** 这一单的四个镜头。提示词是真的写在节点上的 —— v1 最大的窟窿就是这四句一句都没出现。 */
const SHOT_PROMPTS: readonly string[] = [
  '雨夜街口，霓虹映在积水里，女孩撑伞停在斑马线前，镜头缓缓推近她的侧脸',
  '公交车灯扫过雾气，她转身回望巷口，风把伞面吹得微微翻起',
  '特写：她手里那张泛黄的旧照片被雨点打湿，指腹擦过照片边角',
  '远景：两个人隔着斑马线停下，红灯转绿，人群从中间穿过',
]

const NODE_ID = (index: number): string => `spend-shot-${index + 1}`

/** 每秒单价随画质档走。真接线时这三个数来自供应商目录/报价接口；这里写死只为让「改参数 → 价格当场变」真的发生。 */
const UNIT_PRICE_PER_SECOND: Record<string, number> = { std: 0.1, pro: 0.2, '4K': 0.4 }

type ShotQuote = { unit: number; seconds: number; amount: number }

/** 一镜的报价。`null` = 这个组合报不出价（接线后是常态：中转/自建端点多半没有价目）。 */
function quoteShot(meta: Record<string, unknown> | undefined): ShotQuote | null {
  const unit = UNIT_PRICE_PER_SECOND[String(meta?.mode ?? '')]
  const seconds = Number(meta?.duration)
  if (!unit || !Number.isFinite(seconds)) return null
  return { unit, seconds, amount: unit * seconds }
}

function money(amount: number): string {
  return `¥${amount.toFixed(2)}`
}

function baseMeta(): Record<string, unknown> {
  return {
    archetype: { id: 'kling-3.0', modeId: 't2v' },
    modelKey: KLING.modelKey,
    modelAlias: KLING.value,
    modelVendor: KLING.vendor,
    vendor: KLING.vendor,
    modelLabel: KLING.label,
    videoModel: KLING.value,
    videoModelVendor: KLING.vendor,
    mode: 'std',
    duration: '3',
    aspect_ratio: '16:9',
    sound: false,
  }
}

function shotNode(index: number, metaOverride: Record<string, unknown> = {}): GenerationCanvasNode {
  return {
    id: NODE_ID(index),
    kind: 'video',
    categoryId: 'shots',
    title: `镜头 ${index + 1}`,
    prompt: SHOT_PROMPTS[index],
    position: { x: 0, y: 0 },
    size: { width: 340, height: 192 },
    status: 'idle',
    meta: { ...baseMeta(), ...metaOverride },
  }
}

type CardFixture = {
  /** 这一单有几镜。1 = 单镜卡（不出翻页器、不出范围切换）。 */
  shots?: number
  /** 打开时停在第几页（0 基）。 */
  page?: number
  /** 覆写某一镜的参数（「改完时长价格刷新」那一格用）。 */
  metaByShot?: Record<number, Record<string, unknown>>
  /** 报不出价那一档。 */
  priceUnknown?: boolean
  /** 打开时范围停在哪一档（「全部模式」那一格用 `all`）。 */
  scope?: 'each' | 'all'
  /** 挂载后自动点开的那一件。截图截不出「点一下会怎样」，所以展开态一律**真的点一下**。 */
  openTrigger?: 'model' | 'panel'
}

/**
 * 付费卡 v2。
 *
 * 卡体 = `NodeGenerationComposer host="panel"`，也就是用户在画布上选中一个镜头时看到的那张框：
 * 上边提示词（`PromptEditor` + @ 引用），下边一行参数条（模型芯片 + 摘要 pill + ×N）。
 * 卡壳只在它上下各加一点东西：
 *   · 上：槽头（「生成 N 镜的视频」+「付费」+「Nomi 选的」）与翻页器 `‹ 2/4 ›`；
 *   · 下：价格算式行 + 动作（「生成 ¥X」/「全部生成 ¥合计」/「不要」）。
 *
 * **生成钮为什么不留在参数条右端**：画布上那颗 `↑` 是「这张卡上唯一的出口」。在介入槽里，
 * 「生成」和「不要」是同一个决定的两面（做 / 不做），必须并排放在同一处；
 * 把「生成」留在参数条里、「不要」放在底栏，等于把一个决定拆成两个家（§1.5 一功能一个家），
 * 而且用户改完参数抬眼看到的第一颗钮会是「生成」，「不要」反而要往下找。
 * 所以 `host="panel"` 明确不渲染那颗 `↑`（连同画布专属的锁徽标一起），主按钮由卡壳给。
 */
function SpendComposerCard({
  shots = 4,
  page = 0,
  metaByShot = {},
  priceUnknown = false,
  scope = 'each',
  openTrigger,
}: CardFixture): JSX.Element {
  const fx = useV4Fixtures()
  const labels = useV4Labels()
  const [ready, setReady] = React.useState(false)
  const [index, setIndex] = React.useState(page)
  const [activeScope, setActiveScope] = React.useState<'each' | 'all'>(scope)
  const cardRef = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    seedModelCatalogForTests(HEALTH, [
      { kind: 'video', requiredMode: 'text_to_video', options: MODEL_OPTIONS },
      { kind: 'video', requiredMode: 'image_to_video', options: MODEL_OPTIONS },
    ])
    useWorkbenchStore.setState({ activeCategoryId: 'shots' })
    useGenerationCanvasStore.setState({
      nodes: Array.from({ length: shots }, (_, i) => shotNode(i, metaByShot[i])),
      edges: [],
      selectedNodeIds: [],
    })
    setIndex(page)
    setActiveScope(scope)
    setReady(true)
    // 夹具是每一格重建一次的常量对象，深比较无意义；这几个基元决定了这一格是什么样。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots, page, priceUnknown, scope])

  // 节点从 store 订阅（不是从上面那次 setState 的返回值拿）：用户在提示词里打字、在参数条里
  // 改画质，写的都是 store，价格行必须跟着那份**唯一**的 meta 走。
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const node = nodes.find((candidate) => candidate.id === NODE_ID(index))

  // 展开态由取景台**真的点一下触发钮**得到，不是另画一份展开的样子。
  // 模型下拉按 aria-label 找（那条 label 走 i18n，跟着语言走，不写死中文选择器）；
  // 参数面板的触发器按**走查锚点属性**找，因为它是谁取决于摆法：
  // chips 形态（付费卡这一处）是那颗 ⚙ `[data-parameter-more]`，summary 形态是摘要 pill
  // `[data-parameter-summary]`。此前这里写死了摘要 pill 的 aria-label——摆法一换就点了个空，
  // 截回来的是一张「和收起时一模一样」的假证据（这一格自称面板展开，却什么都没展开）。
  //
  // 为什么要等 `optionsReady`：目录是**异步**到的（现役 `useModelOptionsState` 先 setState([]) 再落数据）。
  // 在没有模型的那一帧上点，参数条上根本还没有那颗芯片——点了个寂寞，截回来的是「没展开」的假证据。
  // 所以这里等的不是一个墙钟，是「那颗钮真的在了」这个条件（R18：不许私接墙钟等待）。
  const modelLabel = fx.t('generationCommon.parameters.model')
  const optionsReady = useGenerationModelOptionsState('video', 'text_to_video').options.length > 0
  React.useLayoutEffect(() => {
    if (!openTrigger || !ready || !optionsReady) return
    const selector = openTrigger === 'model'
      ? `button[aria-label="${modelLabel}"]`
      : '[data-parameter-more], [data-parameter-summary]'
    const trigger = cardRef.current?.querySelector<HTMLButtonElement>(selector)
    // 点不到就说出来：这一格的全部信息量就在「展开之后长什么样」，静默截一张收起态是假证据。
    if (!trigger) throw new Error(`[v4-spend-params] 找不到 openTrigger="${openTrigger}" 的触发器：${selector}`)
    trigger.click()
  }, [openTrigger, ready, optionsReady, modelLabel])

  if (!ready || !node) return <Piece><div /></Piece>

  const quotes = nodes.map((candidate) => (priceUnknown ? null : quoteShot(candidate.meta)))
  const current = quotes[index]
  const total = quotes.every((quote) => quote) ? quotes.reduce((sum, quote) => sum + (quote?.amount ?? 0), 0) : null
  // 逐镜参数可以各不相同，所以「N 段 × 3s · ¥0.10/秒」这句算式**只有在真的整齐时才成立**。
  // 一旦有一镜被改长了，还印那句就是在报一个不存在的算法——那时改印「N 镜 · 逐镜不同」，
  // 具体数字交给下面那个逐镜折叠口。
  const uniform = quotes.every((quote) => quote && quote.seconds === quotes[0]?.seconds && quote.unit === quotes[0]?.unit)
  const quality = String(node.meta?.mode) === 'std' ? fx.t('agentPanelV4.qualityStandard') : fx.t('agentPanelV4.qualityPro')

  const price: InterventionData['price'] = {
    breakdown: total === null
      ? fx.t('agentPanelV4.spendParamsBreakdownNoUnit', { count: shots })
      : uniform && quotes[0]
        ? fx.t('agentPanelV4.spendParamsBreakdown', { count: shots, seconds: quotes[0].seconds, quality, unit: money(quotes[0].unit) })
        : fx.t('agentPanelV4.spendParamsBreakdownMixed', { count: shots }),
    ...(total === null
      ? { unavailable: fx.t('agentPanelV4.spendParamsUnavailable') }
      : { totalLabel: fx.t('agentPanelV4.spendParamsTotalLabel'), total: money(total) }),
    // 逐镜摊开只在「不整齐」时才有信息量：整齐时每一行都是同一个数，摊开等于把同一句话抄 4 遍。
    ...(total !== null && shots > 1 && !uniform
      ? {
          perItemLabel: fx.t('agentPanelV4.spendParamsPerItem', { count: shots }),
          perItem: quotes.map((quote, i) => ({
            label: fx.t('agentPanelV4.spendParamsShot', { number: i + 1 }),
            amount: money(quote?.amount ?? 0),
          })),
        }
      : {}),
  }

  // 「Nomi 选的」只在**模型还是 Nomi 挑的那个**时印。用户一改模型这句话就成了假话，
  // 所以它是从当前 meta 现算的，不是卡上写死的一行小字。
  const pickedByNomi = String(node.meta?.modelKey || '') === KLING.modelKey
  const badge = pickedByNomi
    ? `${fx.t('agentPanelV4.slotSpendBadge')} · ${fx.t('agentPanelV4.spendParamsModelPicked')}`
    : fx.t('agentPanelV4.slotSpendBadge')

  // 报不出价时没有「全部合计」可印，范围切换也就无从谈起——那一档退回逐镜。
  const batchScope = activeScope === 'all' && shots > 1 && total !== null
  const data: InterventionData = {
    kind: 'spend',
    // 标题里**不再印金额**：金额随参数变，两个地方印同一个数就一定有一个先漂。
    // 它只说「要做什么」，钱归价格行与那两颗钮（后者是用户按下去时的那句承诺）。
    title: fx.t('agentPanelV4.spendParamsTitle', { count: shots }),
    badge,
    ...(shots > 1
      ? {
          pager: {
            index,
            total: shots,
            keyHint: fx.t('agentPanelV4.pagerKeyHint'),
            ...(total !== null
              ? {
                  scope: {
                    value: batchScope ? ('all' as const) : ('each' as const),
                    eachLabel: fx.t('agentPanelV4.spendParamsScopeEach'),
                    allLabel: fx.t('agentPanelV4.spendParamsScopeAll'),
                    ariaLabel: fx.t('agentPanelV4.spendParamsScopeAria'),
                  },
                }
              : {}),
          },
        }
      : {}),
    price,
    // 正常那两档一句话都不多说：卡上每一样东西都能改、改完价格就变，这件事**看得见**，
    // 不需要再写一行「确认前都能改」（D1：让用户多读的默认砍掉）。
    // 只有报不出价那一档必须说话——那是用户在按下去之前唯一没法自己看出来的事。
    ...(total === null ? { scope: fx.t('agentPanelV4.spendParamsScopeUnknown') } : {}),
    // 主按钮只有一颗，标签跟着**范围**走：逐镜印这一页的价，全部印合计 + 几镜。
    // v2 那颗「全部生成 ¥1.20」次按钮已删（2026-09-10 按钮规则：批量不是第二颗文字按钮）。
    confirmLabel: batchScope && total !== null
      ? fx.t('agentPanelV4.spendParamsConfirmAll', { count: shots, amount: money(total) })
      : current
        ? fx.t('agentPanelV4.spendParamsConfirm', { amount: money(current.amount) })
        : fx.t('agentPanelV4.spendParamsConfirmUnknown'),
  }

  return (
    <Piece>
      <div ref={cardRef}>
        <V4Intervention
          {...V4_LAB_SLOT_HANDLERS}
          data={data}
          labels={{ ...labels.intervention, reject: fx.t('agentPanelV4.spendParamsDecline') }}
          onPage={setIndex}
          onScope={setActiveScope}
          composer={
            <NodeGenerationComposer
              node={node}
              visualSize={node.size ?? { width: 340, height: 192 }}
              host="panel"
              onFeedback={() => undefined}
            />
          }
        />
      </div>
    </Piece>
  )
}

/** 切到「全自动」的二次确认。**不是新组件**：它就是介入槽的可撤销档（换档本身可撤销）。 */
function AutoModeConfirmCard(): JSX.Element {
  const fx = useV4Fixtures()
  const labels = useV4Labels()
  return (
    <Piece>
      <V4Intervention
        {...V4_LAB_SLOT_HANDLERS}
        data={{
          kind: 'approval-reversible',
          // 2026-09-10 用户拍板：标题左边那个对勾删掉。标题是一句问句，前面顶着 ✓ 读起来像「已经切好了」。
          hideIcon: true,
          title: fx.t('agentPanelV4.autoModeConfirmTitle'),
          summary: fx.t('agentPanelV4.autoModeConfirmBody'),
          confirmLabel: fx.t('agentPanelV4.autoModeConfirmOk'),
        }}
        labels={{ ...labels.intervention, reject: fx.t('agentPanelV4.autoModeConfirmCancel') }}
      />
    </Piece>
  )
}

/** 开启后的常驻提醒：一条 h-6 微字横条，压在 composer 上沿——它在的地方就是你打字的地方。 */
function AutoModeReminderCell(): JSX.Element {
  const fx = useV4Fixtures()
  const [tier, setTier] = React.useState<'project' | 'safe-auto'>('project')
  const [dismissed, setDismissed] = React.useState(false)
  return (
    <Piece>
      {tier === 'project' && !dismissed ? (
        <V4AutoModeBanner
          label={fx.t('agentPanelV4.permission.project')}
          note={fx.t('agentPanelV4.autoModeBannerNote')}
          revertLabel={fx.t('agentPanelV4.autoModeBannerRevert')}
          dismissLabel={fx.t('agentPanelV4.autoModeBannerDismiss')}
          onRevert={() => setTier('safe-auto')}
          onDismiss={() => setDismissed(true)}
        />
      ) : null}
      <AgentPanelV4Composer panelHeight={620} mode="idle" permission={tier} value="" />
    </Piece>
  )
}

export const V4_SPEND_PARAMS_STATES: readonly LabState[] = [
  {
    id: 'v4-spend-params-collapsed',
    name: '付费卡 · 上提示词 / 下参数条（4 镜第 1 页 · 翻页器 · 价格算式）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'component-only',
    render: () => <SpendComposerCard />,
  },
  {
    id: 'v4-spend-params-collapsed-dark',
    name: '付费卡 · 上提示词 / 下参数条（暗色）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <SpendComposerCard />,
  },
  {
    id: 'v4-spend-params-single',
    name: '付费卡 · 单镜（无翻页器、无范围切换，其余一模一样）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'component-only',
    render: () => <SpendComposerCard shots={1} />,
  },
  {
    id: 'v4-spend-params-all',
    name: '付费卡 · 范围切到「全部」（主按钮改口成「生成 4 镜 ¥1.20」，没有第二颗文字按钮）',
    source: SOURCE,
    mirrors: 'src/workbench/ai/v4/AgentPanelV4Cards.tsx:184',
    coverage: 'component-only',
    render: () => <SpendComposerCard scope="all" />,
  },
  {
    id: 'v4-spend-params-model-open',
    name: '付费卡 · 模型下拉展开（和节点上同一个下拉：同一份目录、同行供应商 chip）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:539',
    coverage: 'component-only',
    capture: 'viewport',
    render: () => <SpendComposerCard openTrigger="model" />,
  },
  {
    id: 'v4-spend-params-panel-open',
    name: '付费卡 · ⚙ 就地展开长尾参数（比例/时长/画质已在底栏 chip 上，这里是没上 chip 的那些）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:337',
    coverage: 'component-only',
    render: () => <SpendComposerCard openTrigger="panel" />,
  },
  {
    id: 'v4-spend-params-repriced',
    name: '付费卡 · 这一镜改成 5s（算式退成「逐镜不同」，合计 ¥1.20→¥1.40，钮上的数同步）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'component-only',
    render: () => <SpendComposerCard metaByShot={{ 0: { duration: '5' } }} />,
  },
  {
    id: 'v4-spend-params-page2',
    name: '付费卡 · 翻到第 2 页（提示词与参数各自独立，翻页只换内容不换位置）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'component-only',
    render: () => <SpendComposerCard page={1} />,
  },
  {
    id: 'v4-spend-params-price-unknown',
    name: '付费卡 · 价格算不出（不印 ¥0；钮退成「仍要生成」，多一句诚实交代）',
    source: SOURCE,
    mirrors: 'src/workbench/ai/v4/AgentPanelV4Cards.tsx:214',
    coverage: 'component-only',
    render: () => <SpendComposerCard priceUnknown />,
  },
  {
    id: 'v4-auto-mode-confirm',
    name: '全自动 · 切档二次确认（标题左侧对勾已删）',
    source: SOURCE,
    mirrors: 'src/workbench/ai/v4/AgentPanelV4Cards.tsx:296',
    coverage: 'component-only',
    render: () => <AutoModeConfirmCard />,
  },
  {
    id: 'v4-auto-mode-confirm-dark',
    name: '全自动 · 切档二次确认（暗色）',
    source: SOURCE,
    mirrors: 'src/workbench/ai/v4/AgentPanelV4Cards.tsx:296',
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <AutoModeConfirmCard />,
  },
  {
    id: 'v4-auto-mode-reminder',
    name: '全自动 · 常驻提醒（一点回「自动改」，右端 × 可叉掉）',
    source: SOURCE,
    mirrors: 'src/workbench/ai/v4/AgentPanelV4AutoMode.tsx:36',
    coverage: 'component-only',
    render: () => <AutoModeReminderCell />,
  },
  {
    id: 'v4-auto-mode-reminder-dark',
    name: '全自动 · 常驻提醒（暗色）',
    source: SOURCE,
    mirrors: 'src/workbench/ai/v4/AgentPanelV4AutoMode.tsx:36',
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <AutoModeReminderCell />,
  },
]
