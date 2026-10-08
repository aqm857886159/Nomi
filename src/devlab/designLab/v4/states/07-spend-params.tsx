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
import React, { type JSX } from 'react'
import { V4Intervention } from '../../../../workbench/ai/v4/AgentPanelV4Cards'
import { AgentPanelV4Panel } from '../../../../workbench/ai/v4/AgentPanelV4Panel'
import { V4AutoModeBanner } from '../../../../workbench/ai/v4/AgentPanelV4AutoMode'
import { AgentPanelV4Composer } from '../../../../workbench/ai/v4/AgentPanelV4Composer'
import { useV4Labels } from '../../../../workbench/ai/v4/agentPanelV4Labels'
import { projectSpendCard } from '../../../../workbench/ai/v4/agentPanelSpendCard'
import type { PendingSpendConfirm } from '../../../../desktop/productionRunBridgeTypes'
import NodeGenerationComposer from '../../../../workbench/generationCanvas/nodes/NodeGenerationComposer'
import { useGenerationCanvasStore } from '../../../../workbench/generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../../../workbench/workbenchStore'
import type { GenerationCanvasNode } from '../../../../workbench/generationCanvas/model/generationCanvasTypes'
import { seedModelCatalogForTests } from '../../../../config/modelCatalogCache'
import { useGenerationModelOptionsState } from '../../../../workbench/generationCanvas/adapters/modelOptionsAdapter'
import type { ModelOption } from '../../../../config/models'
import { Piece, useV4Fixtures, V4_LAB_SLOT_HANDLERS } from '../agentPanelV4LabKit'
import { holdDesignLabReady } from '../../labReadyHold'
import { Notification } from '@mantine/core'
import { buildToastNotification } from '../../../../ui/toast'
import { useTranslation } from 'react-i18next'
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
/**
 * Seedance 2.0（kie）：档案带**变体轴**（标准 / 快速 / Mini），付费卡底栏会多一颗变体 chip。
 * 2026-10-08 另一条设计线在 390px 面板里看到：这颗变体被挤出包装、「16:9」压在「标准」上——
 * 这一格专门钉「每颗 chip（含变体）整颗可见、不相压，放不下就换行」。
 */
const SEEDANCE: ModelOption = {
  value: 'bytedance/seedance-2',
  modelKey: 'bytedance/seedance-2',
  vendor: 'kie',
  vendorName: 'kie',
  label: 'Seedance 2.0',
  kind: 'video',
}
const LAB_MODELS = { kling: KLING, seedance: SEEDANCE } as const
type LabModel = keyof typeof LAB_MODELS
const MODEL_OPTIONS: readonly ModelOption[] = [
  KLING,
  SEEDANCE,
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


function baseMeta(model: LabModel): Record<string, unknown> {
  const option = LAB_MODELS[model]
  return {
    archetype: model === 'seedance'
      ? { id: 'seedance-2', modeId: 't2v', variantId: 'standard' }
      : { id: 'kling-3.0', modeId: 't2v' },
    modelKey: option.modelKey,
    modelAlias: option.value,
    modelVendor: option.vendor,
    vendor: option.vendor,
    modelLabel: option.label,
    videoModel: option.value,
    videoModelVendor: option.vendor,
    ...(model === 'seedance' ? { resolution: '720p', duration: '5' } : { mode: 'std', duration: '3' }),
    aspect_ratio: '16:9',
    sound: false,
  }
}

function shotNode(index: number, model: LabModel, metaOverride: Record<string, unknown> = {}): GenerationCanvasNode {
  return {
    id: NODE_ID(index),
    kind: 'video',
    categoryId: 'shots',
    title: `镜头 ${index + 1}`,
    prompt: SHOT_PROMPTS[index],
    position: { x: 0, y: 0 },
    size: { width: 340, height: 192 },
    status: 'idle',
    meta: { ...baseMeta(model), ...metaOverride },
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
  /** 挂载后自动点开的那一件。截图截不出「点一下会怎样」，所以展开态一律**真的点一下**（`mention` = 在提示词末尾真的打一个 @）。 */
  openTrigger?: 'model' | 'panel' | 'mention'
  /** 画布上另有两张已经出图的节点（打 @ 时它们该出现在「画布」那一组）。 */
  canvasImages?: boolean
  /** 这一格的界面语言（缺省中文）。 */
  locale?: 'zh-CN' | 'en'
  /** 卡上的模型（缺省 Kling 3.0）。 */
  model?: LabModel
  /** 面板宽（缺省生产的 390）：窄一档用来钉「放不下就换行」。 */
  panelWidth?: number
}

/** 画布上已出图的两张（卡上打 @ 时「画布」那一组列它们）。图是内联的小 SVG（候选只收可引用的地址：本地 / 内联 / http），不碰网络。 */
const CANVAS_IMAGE_A = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI5NiIgaGVpZ2h0PSI5NiI+PHJlY3Qgd2lkdGg9Ijk2IiBoZWlnaHQ9Ijk2IiBmaWxsPSIjZDljYmI2Ii8+PGNpcmNsZSBjeD0iNDgiIGN5PSI0MCIgcj0iMTgiIGZpbGw9IiM4YTZmNTIiLz48cmVjdCB4PSIyMiIgeT0iNjIiIHdpZHRoPSI1MiIgaGVpZ2h0PSIyNCIgcng9IjEwIiBmaWxsPSIjOGE2ZjUyIi8+PC9zdmc+'
const CANVAS_IMAGE_B = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI5NiIgaGVpZ2h0PSI5NiI+PHJlY3Qgd2lkdGg9Ijk2IiBoZWlnaHQ9Ijk2IiBmaWxsPSIjMmIzNDQyIi8+PGNpcmNsZSBjeD0iNDgiIGN5PSI0MCIgcj0iMTgiIGZpbGw9IiM2ZjhmYjMiLz48cmVjdCB4PSIyMiIgeT0iNjIiIHdpZHRoPSI1MiIgaGVpZ2h0PSIyNCIgcng9IjEwIiBmaWxsPSIjNmY4ZmIzIi8+PC9zdmc+'
const CANVAS_IMAGE_NODES: readonly GenerationCanvasNode[] = [
  { id: 'canvas-image-1', kind: 'image', categoryId: 'cast', title: '女孩定妆', prompt: '', position: { x: 0, y: 0 }, status: 'success',
    result: { id: 'canvas-image-1-r', type: 'image', url: CANVAS_IMAGE_A, createdAt: 1 } },
  { id: 'canvas-image-2', kind: 'image', categoryId: 'scene', title: '雨夜街口', prompt: '', position: { x: 0, y: 0 }, status: 'success',
    result: { id: 'canvas-image-2-r', type: 'image', url: CANVAS_IMAGE_B, createdAt: 1 } },
]

/** 切到这一格要的语言；切完之前不举就绪旗（否则截到的是上一格的语言）。 */
function useLabLocale(locale: CardFixture['locale']): boolean {
  const { i18n } = useTranslation()
  const want = locale ?? 'zh-CN'
  const [applied, setApplied] = React.useState(i18n.language === want)
  React.useEffect(() => {
    if (i18n.language === want) { setApplied(true); return undefined }
    const release = holdDesignLabReady(`v4-spend:locale:${want}`)
    void i18n.changeLanguage(want).then(() => { setApplied(true); release() })
    return release
  }, [i18n, want])
  return applied
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
  openTrigger,
  canvasImages = false,
  locale,
  model = 'kling',
  panelWidth,
  inPanel = false,
  waiting,
}: CardFixture & { inPanel?: boolean; waiting?: boolean }): JSX.Element {
  const modelOption = LAB_MODELS[model]
  const localeApplied = useLabLocale(locale)
  const fx = useV4Fixtures()
  const labels = useV4Labels()
  const [ready, setReady] = React.useState(false)
  const [index, setIndex] = React.useState(page)
  const cardRef = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    seedModelCatalogForTests(HEALTH, [
      { kind: 'video', requiredMode: 'text_to_video', options: MODEL_OPTIONS },
      { kind: 'video', requiredMode: 'image_to_video', options: MODEL_OPTIONS },
    ])
    useWorkbenchStore.setState({ activeCategoryId: 'shots' })
    useGenerationCanvasStore.setState({
      nodes: [...Array.from({ length: shots }, (_, i) => shotNode(i, model, metaByShot[i])), ...(canvasImages ? CANVAS_IMAGE_NODES : [])],
      edges: [],
      selectedNodeIds: [],
    })
    setIndex(page)
    setReady(true)
    // 夹具是每一格重建一次的常量对象，深比较无意义；这几个基元决定了这一格是什么样。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots, page, priceUnknown, canvasImages, model])

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
    if (openTrigger !== 'mention' || !ready || !optionsReady || !localeApplied) return undefined
    // 真的在提示词末尾打一个 @（和用户敲键盘走同一条 TipTap 事务），候选浮层由 @ 插件自己弹出来。
    const release = holdDesignLabReady('v4-spend:mention-open')
    const editorRoot = cardRef.current?.querySelector('.ProseMirror') as (HTMLElement & { editor?: { chain: () => { focus: (at: string) => { insertContent: (text: string) => { run: () => void } } } } }) | null
    if (!editorRoot?.editor) throw new Error('[v4-spend-params] 找不到卡上的提示词编辑器，@ 浮层打不开')
    editorRoot.editor.chain().focus('end').insertContent(' @').run()
    let frame = 0
    const waitForList = (): void => {
      if (document.querySelector('[data-mention-list="true"]') || frame > 120) { release(); return }
      frame += 1
      requestAnimationFrame(waitForList)
    }
    requestAnimationFrame(waitForList)
    return release
  }, [openTrigger, ready, optionsReady, localeApplied])
  React.useLayoutEffect(() => {
    if (!openTrigger || openTrigger === 'mention' || !ready || !optionsReady) return
    const selector = openTrigger === 'model'
      ? `button[aria-label="${modelLabel}"]`
      : '[data-parameter-more], [data-parameter-summary]'
    const trigger = cardRef.current?.querySelector<HTMLButtonElement>(selector)
    // 点不到就说出来：这一格的全部信息量就在「展开之后长什么样」，静默截一张收起态是假证据。
    if (!trigger) throw new Error(`[v4-spend-params] 找不到 openTrigger="${openTrigger}" 的触发器：${selector}`)
    trigger.click()
  }, [openTrigger, ready, optionsReady, modelLabel])

  if (!ready || !node || !localeApplied) return <Piece><div /></Piece>

  const quotes = nodes.filter((candidate) => candidate.kind === 'video').map((candidate) => (priceUnknown ? null : quoteShot(candidate.meta)))
  // **ShellStage 手法**：卡上印的一切由**生产投影** `projectSpendCard` 算，这里只负责把
  // 取景台的画布节点 + 报价喂成主进程那份待确认单的形状（`PendingSpendConfirm`）。
  //
  // 这里原来是一份手抄的投影（标题 / 徽章 / 价格行 / 主按钮各算一遍）。它和生产投影
  // 已经分过四次叉：卡头「需要你定一下」、幽灵的「换模型」按钮、页脚左下说的不是一件事、
  // 还有一句生产侧**从来不印**的算式「1 镜 × 3s · 标准画质 · ¥0.10/秒」（生产没有单价可报）。
  // 每一次都是用户在真机上先看出来的——实验室画的是一张不存在的卡，拍板就拍在了空处。
  // 现在只有一份投影，实验室这一格想分叉也没地方分。
  const pendingSpend: PendingSpendConfirm = {
    projectId: 'design-lab', runId: 'design-lab-run', operationId: 'design-lab-op',
    planVersion: 1, quoteId: 'design-lab-quote', candidateRevision: 1,
    currency: 'CNY',
    shots: nodes.filter((candidate) => candidate.kind === 'video').map((candidate, i) => {
      const quote = quotes[i]
      return {
        shotId: `lab-shot-${i + 1}`,
        nodeId: candidate.id,
        index: i + 1,
        prompt: String(candidate.prompt ?? ''),
        providerId: String(modelOption.vendor ?? ''),
        modelId: String(candidate.meta?.modelKey || ''),
        kind: 'video' as const,
        mode: 'text_to_video',
        parameters: {},
        price: quote ? { known: true as const, amount: quote.amount } : { known: false as const },
      }
    }),
    knownSubtotal: quotes.reduce((sum, quote) => sum + (quote?.amount ?? 0), 0),
    unknownShotCount: quotes.filter((quote) => !quote).length,
  }
  const data = projectSpendCard(pendingSpend, { page: index }, fx.t, {
    // 「Nomi 选的」= 模型还是 Nomi 当初挑的那个。用户在卡上一改模型，这句话跟着消失。
    locale: fx.locale,
    agentPickedModelIds: [String(modelOption.modelKey ?? '')],
  })
  if (!data) return <Piece><div /></Piece>

  const composer = (
    <NodeGenerationComposer
      node={node}
      visualSize={node.size ?? { width: 340, height: 192 }}
      host="panel"
      onFeedback={() => undefined}
    />
  )
  const cardLabels = { ...labels.intervention, reject: fx.t('agentPanelV4.spendParamsDecline') }

  // 「放进真面板里」那一格（上面对话流、下面 composer、外面面板壳）。**同一张真卡**——
  // 同一份生产投影、同一个正文组件，只是换了宿主。原来面板里那格付费卡用的是一排静态
  // 文字 chip 当正文，那不是真卡的形态，用户拍板看的就成了一个不存在的东西。
  if (inPanel) {
    return (
      <div ref={cardRef}>
        <AgentPanelV4Panel
          slotHandlers={{ ...V4_LAB_SLOT_HANDLERS, onPage: setIndex }}
          flow={fx.flows.creation}
          slot={data}
          slotComposer={composer}
          {...(waiting === undefined ? {} : { slotWaiting: waiting })}
          context={{ ...fx.context, used: 36000 }}
          height={860}
          {...(panelWidth ? { width: panelWidth } : {})}
        />
      </div>
    )
  }

  return (
    <Piece>
      <div ref={cardRef}>
        <V4Intervention
          {...V4_LAB_SLOT_HANDLERS}
          data={data}
          labels={cardLabels}
          onPage={setIndex}
          composer={composer}
        />
      </div>
    </Piece>
  )
}

/**
 * 卡上点生成、宿主在本项目素材里认不出卡上的某张参考图时，卡上弹的那一条（`spendCardFailure` → `toast(…, 'error')`）。
 * 画的就是生产那一条通知：`buildToastNotification` 的同一份图标 / 颜色 / 正文，放进 Mantine 的同一个 Notification。
 */
function ReferenceNotInProjectToast({ locale }: { locale?: 'zh-CN' | 'en' }): JSX.Element {
  const applied = useLabLocale(locale)
  const fx = useV4Fixtures()
  if (!applied) return <Piece><div /></Piece>
  const data = buildToastNotification({ id: 'lab-reference-not-in-project', message: fx.t('agentPanelV4.spendActionReferenceNotInProject'), type: 'error' })
  return (
    <Piece>
      <Notification icon={data.icon} color={data.color} withBorder withCloseButton={data.withCloseButton} className="w-[22rem]">
        {data.message}
      </Notification>
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
    id: 'v4-panel-spend-light',
    name: '⑤ 付费确认卡**在真面板里**（真卡：正文是节点参数条，数据走生产投影）',
    source: '2026-09-22 用户：「卡族换壳，主要是要用我们的设计系统」；对账物 = 同屏 composer',
    coverage: 'component-only',
    span: 2,
    render: () => <SpendComposerCard shots={1} inPanel />,
  },
  {
    id: 'v4-panel-spend-seedance',
    name: '⑤ 付费卡在真面板里 · Seedance 2.0（带变体 chip）· 生产宽 390',
    source: '2026-10-08 协调会话：390px 下「16:9」压在「标准」上、变体 chip 溢出包装；合同：每颗 chip 整颗可见、放不下换行',
    coverage: 'component-only',
    span: 2,
    render: () => <SpendComposerCard shots={1} inPanel model="seedance" />,
  },
  {
    id: 'v4-panel-spend-seedance-narrow',
    name: '⑤ 付费卡在真面板里 · Seedance 2.0 · 面板压窄到 300（放不下 → 换到第二行，不滚动、不进 ⚙）',
    source: '2026-10-08 协调会话合同：报价参数永不退进 ⚙、不裁、不横向滚动，真放不下就换行',
    coverage: 'component-only',
    span: 2,
    render: () => <SpendComposerCard shots={1} inPanel model="seedance" panelWidth={300} />,
  },
  {
    id: 'v4-panel-spend-seedance-en',
    name: '⑤ 付费卡在真面板里 · Seedance 2.0 · 390（英文）',
    source: '2026-10-08 协调会话：同上，英文一轨',
    coverage: 'component-only',
    span: 2,
    render: () => <SpendComposerCard shots={1} inPanel model="seedance" locale="en" />,
  },
  {
    id: 'v4-panel-spend-seedance-narrow-en',
    name: '⑤ 付费卡在真面板里 · Seedance 2.0 · 压窄到 300（英文）',
    source: '2026-10-08 协调会话：同上，英文一轨',
    coverage: 'component-only',
    span: 2,
    render: () => <SpendComposerCard shots={1} inPanel model="seedance" panelWidth={300} locale="en" />,
  },
  {
    // 待答态的对照格（2026-09-22），付费卡这一张。理由同 `v4-panel-question-answered`。
    id: 'v4-panel-spend-confirmed',
    name: '⑤ 付费卡**已确认**——外框回到普通纸面',
    source: '2026-09-22 用户拍板：待答时强调，已确认后回普通纸面',
    coverage: 'component-only',
    span: 2,
    render: () => <SpendComposerCard shots={1} inPanel waiting={false} />,
  },
  {
    id: 'v4-panel-spend-batch',
    name: '⑤ 多镜付费卡在真面板里（逐镜翻页 + 翻页行右端「N 张 · 合计」）',
    source: '2026-09-22 卡族换壳收尾：多镜批量卡正文沿用现有形态，只换外壳与页脚',
    coverage: 'component-only',
    span: 2,
    render: () => <SpendComposerCard shots={4} inPanel />,
  },
  {
    id: 'v4-panel-spend-unknown',
    name: '⑤ 未知价付费卡在真面板里（左下整句交代，主按钮照常可点）',
    source: '用户 2026-09-21 硬性拍板：算不出价绝不拦生成',
    coverage: 'component-only',
    span: 2,
    render: () => <SpendComposerCard shots={1} priceUnknown inPanel />,
  },
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
    id: 'v4-spend-params-model-open',
    name: '付费卡 · 模型下拉展开（和节点上同一个下拉：同一份目录、同行供应商 chip）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:444',
    coverage: 'component-only',
    capture: 'viewport',
    render: () => <SpendComposerCard openTrigger="model" />,
  },
  {
    id: 'v4-spend-params-panel-open',
    name: '付费卡 · ⚙ 就地展开长尾参数（比例/时长/画质已在底栏 chip 上，这里是没上 chip 的那些）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:519',
    coverage: 'component-only',
    render: () => <SpendComposerCard openTrigger="panel" />,
  },
  {
    id: 'v4-spend-mention-canvas',
    name: '付费卡 · 打 @：本项目画布上已出图的节点在「画布」那一组（选中落进卡自己的参考槽，和画布同一份候选）',
    source: 'docs/plan/2026-10-07-spend-card-references-one-owner.md',
    mirrors: 'src/workbench/generationCanvas/nodes/useNodeMentionSource.ts:165',
    coverage: 'component-only',
    capture: 'viewport',
    render: () => <SpendComposerCard shots={1} canvasImages openTrigger="mention" />,
  },
  {
    id: 'v4-spend-mention-canvas-en',
    name: '付费卡 · 打 @（英文界面）',
    source: 'docs/plan/2026-10-07-spend-card-references-one-owner.md',
    mirrors: 'src/workbench/generationCanvas/nodes/useNodeMentionSource.ts:165',
    coverage: 'component-only',
    capture: 'viewport',
    render: () => <SpendComposerCard shots={1} canvasImages openTrigger="mention" locale="en" />,
  },
  {
    id: 'v4-spend-reference-not-in-project',
    name: '付费卡 · 有一张参考图不在本项目素材里（点名是参考图，给拿掉 / 用 @ 重选的路）',
    source: 'docs/plan/2026-10-07-spend-card-references-one-owner.md',
    mirrors: 'src/workbench/ai/v4/spendCardFailure.ts:45',
    coverage: 'component-only',
    render: () => <ReferenceNotInProjectToast />,
  },
  {
    id: 'v4-spend-reference-not-in-project-en',
    name: '付费卡 · 参考图不在本项目素材里（英文界面）',
    source: 'docs/plan/2026-10-07-spend-card-references-one-owner.md',
    mirrors: 'src/workbench/ai/v4/spendCardFailure.ts:45',
    coverage: 'component-only',
    render: () => <ReferenceNotInProjectToast locale="en" />,
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
