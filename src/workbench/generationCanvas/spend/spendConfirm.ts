import { declareStoreLifetime } from '../../project/storeLifetime'
import { toast } from '../../../ui/toast'
import { DEFAULT_CANVAS_BATCH_CONCURRENCY } from '../components/canvasProductionScope'
import type { SpendQuote } from '../../../../electron/shared/contracts/spendQuote'
import { isComfyuiVendorKey } from '../model/comfyuiVendor'
import { create } from 'zustand'
import { mintSpendGrant } from '../../api/taskApi'
import type { ProductionContractView } from './productionContractView'
import type { AnchorCheckpointCardModel } from './anchorCheckpointView'
import i18n from '../../../i18n'
import { getDesktopBridge } from '../../../desktop/bridge'

type GenerationEtaBucket = {
  key: string
  vendorKey: string
  modelKey: string
  kind: 'image' | 'video' | 'audio' | 'model3d' | 'text'
  sampleCount: number
  p50Seconds: number
  p90Seconds: number
}

export function generationCostContextForNode(
  node: { meta?: Record<string, unknown> | null } | undefined,
  /** 发起确认那一刻签发的项目（它的历史耗时统计）；null = 不属于任何项目，只给冷启动估计。 */
  projectId: string | null,
): GenerationCostContext {
  const meta = node?.meta || {}
  const read = (key: string): string => typeof meta[key] === 'string' ? String(meta[key]).trim() : ''
  return {
    vendorKey: read('modelVendor') || read('vendor') || read('imageModelVendor') || read('videoModelVendor') || undefined,
    // generationEtaStats indexes the recipe identity from provenance, where modelAlias wins.
    // Keep the confirmation card on that same identity or known history silently becomes cold start.
    modelKey: read('modelAlias') || read('modelKey') || read('imageModel') || read('videoModel') || undefined,
    ...(projectId ? { projectId } : {}),
  }
}

export function generationCostContextForNodes(
  nodes: readonly ({ meta?: Record<string, unknown> | null } | undefined)[],
  projectId: string | null,
): GenerationCostContext {
  const contexts = nodes.map((node) => generationCostContextForNode(node, projectId))
  const vendorKeys = new Set(contexts.map((context) => context.vendorKey).filter(Boolean))
  const modelKeys = new Set(contexts.map((context) => context.modelKey).filter(Boolean))
  return vendorKeys.size === 1 && modelKeys.size === 1
    ? { concurrency: DEFAULT_CANVAS_BATCH_CONCURRENCY, vendorKey: [...vendorKeys][0], modelKey: [...modelKeys][0], projectId: contexts.find((context) => context.projectId)?.projectId }
    : { concurrency: DEFAULT_CANVAS_BATCH_CONCURRENCY }
}

export type HostingDisclosure = {
  message: string
  rememberLabel: string
  onRemember?: () => void | Promise<void>
}

// 付费生成确认 + 铸令牌（渲染层单一收口）。
// 方案：docs/plan/2026-06-21-spend-confirmation-gate.md（所有付费入口使用本次报价确认）。
//
// 铸令牌只发生在真人动作之后：要么是这张卡上的「确认」，要么是用户自己按下的 ↑（单个、不贵、非 Agent，
// 见 spendConfirmationRequirement——2026-09-25 用户拍板单个节点生成不弹窗）。两条都先向主进程要报价、
// 凭报价铸令牌。Agent 发起的一律走这张卡（initiator: 'agent' 必问）。

export type SpendConfirmRequest = {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** 来源：'agent' = 外部 AI 助手（MCP）驱动，换机器人图标 + 副标。缺省按用户直发（金币图标）。 */
  source?: 'user' | 'agent'
  /**
   * 确认门类别（Phase B·分步确认门 surfacing）——决定图标/语气，UI 单一收口不另造并行卡（P1，见 §3.5）：
   * - 'generation'（缺省）= 生成门：要花额度出镜头，金币/机器人图标。
   * - 'reference'         = 参考图门：要花额度出参考图（定妆/场景卡），相机图标。
   * - 'plan'              = 方案门：AI 要往画布落一套节点方案（免费、可撤），分镜图标。
   */
  kind?: 'generation' | 'reference' | 'plan' | 'contract' | 'anchorCheckpoint'
  /** Durable production summary shown inside the existing confirmation shell. */
  contract?: ProductionContractView
  /**
   * P4 §3.2 形象确认卡（anchor_checkpoint 门·免费质量门）：定妆照就绪、等真人过目后开拍镜头批。
   * 与花钱确认卡同一条对话框轨道（P1 一功能一个家），kind:'anchorCheckpoint' 时渲染 AnchorCheckpointCard。
   * 只读模型（哪些定妆照/缩略图/名称/新拍还是复用）由 buildAnchorCheckpointCard 从 Run 投影，卡不自己翻 run。
   */
  anchorCheckpoint?: AnchorCheckpointCardModel
  /**
   * 「重拍选中的」：点它 = 不确认（不 decide approved），把选中的 shotId 沿确认链回传（沿用
   * onOpenPolicySettings 的「请求对象带回调」模式，不改 boolean 契约）。view 层据此 decide rejected +
   * 对选中锚走 S6 返工链。为空则卡不进选中态（无重拍能力）。
   */
  onRework?: (shotIds: string[]) => void
  /**
   * B1 方向门候选（仅 kind:'plan' 的创意方向门）：显示单选行（默认选第一个），确认时把选中的 key
   * 经 onDirectionDecision 回传。为空则方向门退回普通「批准/取消」文案（LLM 关着没拟出候选的兜底）。
   */
  directionCandidates?: Array<{ key: string; title: string; oneLiner: string }>
  /** B1：方向门确认时回传选中候选 key（沿用 onOpenPolicySettings 的「请求对象带回调」模式，不改 boolean 契约）。 */
  onDirectionDecision?: (choiceKey: string | null) => void
  /** Recovery for an incomplete contract policy. Closing through this action is not a rejection. */
  onOpenPolicySettings?: () => void
  /**
   * P4 S3a 多镜确认卡「先试拍第 1 镜」（T3 拍板）：点它 = 不确认、不铸 grant，把「试拍」信号沿确认链回传
   * （沿用 onOpenPolicySettings 的「请求对象带回调」模式，不改 boolean 契约）。缩到首镜 + 重封存 + 重发 gate = S4。
   */
  onTrialFirst?: () => void
  /**
   * P4 S3a 多镜确认卡「返回修改」：卡是只读决策面，改内容的家只有计划编辑器（一功能一个家）。
   * 点它 = 不确认、把「回去改」信号回传（S3a 边界：回传即可，跳转计划编辑器 = 后续切片）。
   */
  onBackToEdit?: () => void
  /** 明细行（节点 / 模型 / 预估），让用户一眼看懂谁要花钱、花在哪。 */
  details?: Array<{ label: string; value: string }>
  /** When anonymous hosting is required, this disclosure is rendered in the same spend card. */
  hostingDisclosure?: HostingDisclosure
}

type Pending = SpendConfirmRequest & { resolve: (ok: boolean) => void }

export type SpendConfirmState = {
  /** 当前显示的确认（队首）。null = 无待确认。对话框只读这一个。 */
  pending: Pending | null
  /**
   * B4：等待中的确认队列（队首之外的排队者）。根治「单槽覆盖」——
   * 两个审批同时来时后者不再冲掉前者的 resolve，而是排队，前一个决议后自动出下一个。
   * FIFO：先到先显。
   */
  queue: Pending[]
  /** 弹确认；resolve true/false。要不要弹由调用方先过 spendConfirmationRequirement。已有在显 → 入队等候（不覆盖）。 */
  requestConfirm: (req: SpendConfirmRequest) => Promise<boolean>
  /** 对话框按钮回调：ok=确认。决议队首后自动晋升下一个。 */
  resolvePending: (ok: boolean, rememberHosting?: boolean) => void
}

export const useSpendConfirmStore = create<SpendConfirmState>()((set, get) => ({
  pending: null,
  queue: [],
  requestConfirm: (req) => {
    return new Promise<boolean>((resolve) => {
      const entry = { ...req, resolve }
      // 队首空着就直接显；否则排队（根治：绝不覆盖已在等待的 resolve）。
      if (get().pending) set((state) => ({ queue: [...state.queue, entry] }))
      else set({ pending: entry })
    })
  },
  resolvePending: (ok, rememberHosting) => {
    const p = get().pending
    // 先决议当前队首，再从队列晋升下一个到显示位（空则 null）。
    set((state) => {
      const [next, ...rest] = state.queue
      return {
        pending: next ?? null,
        queue: rest,
      }
    })
    if (ok && rememberHosting) void p?.hostingDisclosure?.onRemember?.()
    p?.resolve(ok)
  },
}))

/**
 * 确认 + 铸令牌一条龙。确认通过返回 grantId（随生成请求下传供主进程核验）；取消返回 null。
 * @param nodeIds 本次要生成的节点 id（grant 绑定它们，主进程按 nodeId 核验消费）。
 */
export async function confirmAndMintGrant(opts: {
  assertCurrent?: () => Promise<void>
  nodeIds: string[]
  title: string
  message: string
  confirmLabel?: string
  maxAttemptsPerNode?: number
  /** 本次要跑的每一份（报价按它逐份报；份数也是「一下跑几个」的判据，见 spendConfirmationRequirement）。 */
  nodes: Array<{ meta?: Record<string, unknown> | null } | undefined>
  hostingDisclosure?: HostingDisclosure
  initiator?: SpendInitiator
}): Promise<string | null> {
  let quoteId: string | undefined
  const ok = await confirmGenerationSpend(opts.nodes, {
    title: opts.title,
    ...(opts.initiator ? { initiator: opts.initiator } : {}),
    message: opts.message,
    onQuoteConfirmed: (id) => { quoteId = id },
    ...(opts.confirmLabel ? { confirmLabel: opts.confirmLabel } : {}),
    ...(opts.hostingDisclosure ? { hostingDisclosure: opts.hostingDisclosure } : {}),
  })
  if (!ok) return null
  await opts.assertCurrent?.()
  return mintSpendGrant(opts.nodeIds, opts.maxAttemptsPerNode, quoteId)
}

/**
 * 这批节点跑起来**花不花额度**——本地 ComfyUI 跑在用户自己的显卡上，一分钱不花。
 *
 * 真机走查抓到的：给本地 ComfyUI 点生成，弹的卡上写着「会消耗模型额度」。这既是**假话**，
 * 又白挡一次点击——ComfyUI 用户一天点几十次生成，这一下下全是白费的摩擦。
 * 付费确认卡的存在意义是「别让人意外花钱」；不花钱就没有要防的东西。
 */
export function generationSpendsCredits(nodes: Array<{ meta?: Record<string, unknown> | null } | undefined>): boolean {
  const vendors = nodes
    .map((n) => {
      const meta = n?.meta || {}
      const pick = (k: string) => (typeof meta[k] === 'string' ? (meta[k] as string).trim() : '')
      return pick('modelVendor') || pick('vendor') || pick('imageModelVendor') || pick('videoModelVendor')
    })
    .filter(Boolean)
  // 一个供应商都认不出 → 保守当付费（宁可多问一次，不可偷偷花钱）。
  if (vendors.length === 0) return true
  return !vendors.every((v) => isComfyuiVendorKey(v))
}

/** 谁发起的这一下生成：用户自己在画布 / 分镜表上点的，还是 Agent（含外部 MCP）替他发起的。 */
export type SpendInitiator = 'user' | 'agent'

/**
 * 单次报价达到这么多点（目录报价单位）才要确认。2026-09-25 用户拍板「≥ 10 点」：图片与大多数视频直接生成，
 * 贵的视频模型仍问一下。仓库里此前没有任何金额门槛（09-09 删了硬预算、09-14 删了 confirmFirstSpend），
 * 这是唯一一处；要改门槛只改这里。
 */
export const SINGLE_RUN_CONFIRM_THRESHOLD_CREDITS = 10

/**
 * 「这一下要不要弹付费确认」的**唯一判据**（2026-09-25 用户拍板：单个节点生成不弹窗）。
 *
 * 为什么是这几条、别的都不问：确认卡的存在意义是「别让人意外花钱」。用户自己点一个节点的 ↑，
 * 点数已经常驻写在 ↑ 旁边（点之前就看得到），再弹一张卡复述同一个数，是每天几十次的白摩擦。
 * 剩下的都是「意外」的来源：
 *   - Agent / 外部 MCP 发起：人不一定在看，钱这一步必须人点头；
 *   - 一下跑 ≥2 个（×N、多选、批量、先补参考再生成）：点一次花好几份，数目要人看一眼；
 *   - 单次 ≥ 门槛：贵；
 *   - 第一次走匿名托管：告知只能在这张卡里给；
 *   - 拿不到报价：不知道多少钱，保守问（宁可多问一次，不可偷偷花钱）。
 * **未标价不在里面**：目录没标价时 ↑ 旁写「未标价」，不挡生成（2026-09-21「未知价不许挡生成」）。
 *
 * 纯函数、调用方只报事实（谁发起、跑几个、报价、要不要告知），不在入口上各判各的——
 * Ctrl+Enter 单选、重试、分镜行生成、结果卡重新生成走的是不同函数，但都落到这一个判据上。
 */
export function spendConfirmationRequirement(input: {
  initiator: SpendInitiator
  runCount: number
  /** 主进程报价：数字 = 目录价；null = 目录未标价；undefined = 没拿到报价。 */
  amount: number | null | undefined
  hostingDisclosure: boolean
}): boolean {
  return input.initiator === 'agent'
    || input.runCount > 1
    || (typeof input.amount === 'number' && input.amount >= SINGLE_RUN_CONFIRM_THRESHOLD_CREDITS)
    || input.hostingDisclosure
    || input.amount === undefined
}

/**
 * 付费确认（不花额度就直接放行，不弹卡；判据见 `spendConfirmationRequirement`）。返回 false = 用户取消。
 *
 * 不弹卡时**照样**先向主进程要报价、把 quoteId 交给调用方去铸令牌：主进程的花钱闸认的是「这一笔有一张
 * 被确认过的报价」（`electron/spendGrant.ts` `assertAndConsumeQuotedSpend`），不带报价的令牌会被它拦下、
 * 改弹一张「经 AI 助手驱动」的卡——那等于把一个弹窗换成另一个更吓人的弹窗。这里的「确认」由用户按 ↑
 * 那一下承担（点之前点数已写在 ↑ 旁）。
 */
export async function confirmGenerationSpend(
  nodes: Array<{ meta?: Record<string, unknown> | null } | undefined>,
  opts: { title: string; message: string; confirmLabel?: string; hostingDisclosure?: HostingDisclosure; onQuoteConfirmed?: (quoteId: string) => void; initiator?: SpendInitiator },
): Promise<boolean> {
  if (!generationSpendsCredits(nodes)) return true
  const inputs = nodes.map((node) => {
    const context = generationCostContextForNode(node, null)
    return { vendorKey: context.vendorKey ?? '', modelKey: context.modelKey ?? '', parameters: node?.meta ?? {} }
  })
  let quote
  try { quote = await getDesktopBridge()?.tasks.quoteSpend(inputs) }
  catch (error) {
    toast(error instanceof Error ? error.message : i18n.t('generationCommon.batchPlan.authorizationFailed'), 'error')
    return false
  }
  const required = spendConfirmationRequirement({
    initiator: opts.initiator ?? 'user',
    runCount: nodes.length,
    amount: quote ? quote.amount : undefined,
    hostingDisclosure: Boolean(opts.hostingDisclosure),
  })
  if (!required && quote) {
    opts.onQuoteConfirmed?.(quote.quoteId)
    return true
  }
  const confirmed = await useSpendConfirmStore.getState().requestConfirm({
    details: [spendQuoteDetail(quote ?? { amount: null })],
    title: opts.title,
    message: opts.message,
    ...(opts.confirmLabel ? { confirmLabel: opts.confirmLabel } : {}),
    ...(opts.hostingDisclosure ? { hostingDisclosure: opts.hostingDisclosure } : {}),
  })
  if (confirmed && quote) opts.onQuoteConfirmed?.(quote.quoteId)
  return confirmed
}

export type GenerationCostKind = 'text' | 'image' | 'video' | 'audio' | 'model3d' | 'mixed'

export type GenerationCostContext = {
  vendorKey?: string
  modelKey?: string
  projectId?: string
  concurrency?: number
  waveSizes?: readonly number[]
  etaStats?: readonly GenerationEtaBucket[]
}

const etaStatsCache = new Map<string, { readAt: number; stats: readonly GenerationEtaBucket[] }>()
const COLD_START_SECONDS: Record<Exclude<GenerationCostKind, 'text' | 'mixed'>, readonly [number, number]> = {
  image: [30, 180],
  video: [300, 1200],
  audio: [30, 300],
  model3d: [120, 900],
}

function historicalEta(context: GenerationCostContext | undefined, kind: GenerationCostKind): GenerationEtaBucket | undefined {
  if (!context?.vendorKey || !context.modelKey || kind === 'text' || kind === 'mixed') return undefined
  const projectId = context.projectId
  let stats = context.etaStats
  if (!stats && projectId) {
    const cached = etaStatsCache.get(projectId)
    if (cached && Date.now() - cached.readAt < 10_000) stats = cached.stats
    else {
      try {
        const reply = getDesktopBridge()?.events?.generationEtaStats?.(projectId)
        stats = Array.isArray(reply?.stats) ? reply.stats as GenerationEtaBucket[] : []
        etaStatsCache.set(projectId, { readAt: Date.now(), stats })
      } catch {
        stats = []
      }
    }
  }
  return stats?.find((item) => item.vendorKey === context.vendorKey && item.modelKey === context.modelKey && item.kind === kind)
}

function etaMinutes(count: number, kind: GenerationCostKind, context?: GenerationCostContext): string {
  const concurrency = Math.max(1, context?.concurrency ?? 1)
  const batches = (context?.waveSizes ?? [count]).reduce((sum, size) => sum + Math.ceil(size / concurrency), 0)
  const sample = historicalEta(context, kind)
  const [lowSeconds, highSeconds] = sample
    ? [sample.p50Seconds * batches, sample.p90Seconds * batches]
    : kind === 'text' || kind === 'mixed' ? [0, 0] : COLD_START_SECONDS[kind].map((seconds) => seconds * batches) as [number, number]
  const low = Math.max(1, Math.round(lowSeconds / 60))
  const high = Math.max(low, Math.round(highSeconds / 60))
  return low === high ? String(low) : `${low}–${high}`
}

/** 件数 + 额度提示；文本耗时无可靠估计，不沿用媒体的固定时长。 */
export function describeGenerationCost(count: number, kind: GenerationCostKind = 'image', context?: GenerationCostContext): string {
  if (kind === 'text') return i18n.t('generationCommon.spend.cost.text', { count })
  const minutes = etaMinutes(count, kind, context)
  const unit = i18n.t(`generationCommon.spend.cost.units.${kind}`, { count })
  return i18n.t('generationCommon.spend.cost.media', { count, unit, minutes })
}


export function spendQuoteDetail(quote: Pick<SpendQuote, 'amount'>): { label: string; value: string } {
  return {
    label: i18n.t('generationCommon.spend.estimatedAmount'),
    value: quote.amount === null
      ? i18n.t('generationCommon.spend.catalogUnpriced')
      : i18n.t('generationCommon.spend.catalogCredits', { amount: quote.amount }),
  }
}

/**
 * C1 寿命声明：付费待确认队列（审计 §9 点名「最值得先做真机的一条，涉钱」）。
 *
 * **释放不能只是置空**：`pending`/`queue` 里挂着还没 resolve 的 Promise 回调——
 * 直接 `setState({ pending: null })` 会让等它的那次生成**永远等下去**（一个不会返回的
 * await，任务卡就此停在「等待确认」）。所以这里逐个 `resolve(false)`：
 * 离开项目 = 没有人会去答这张卡了，那就是「不确认」。
 */
export const spendConfirmStoreLifetime = declareStoreLifetime({
  store: 'useSpendConfirmStore',
  fields: { pending: 'project', queue: 'project' },
  releaseProject: () => {
    const { pending, queue } = useSpendConfirmStore.getState()
    useSpendConfirmStore.setState({ pending: null, queue: [] })
    for (const entry of [pending, ...queue]) entry?.resolve(false)
  },
})
