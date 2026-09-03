import { isComfyuiVendorKey } from '../model/comfyuiVendor'
import { create } from 'zustand'
import { mintSpendGrant } from '../../api/taskApi'
import type { ProductionContractView } from './productionContractView'
import type { AnchorCheckpointCardModel } from './anchorCheckpointView'
import i18n from '../../../i18n'
import { getDesktopActiveProjectId } from '../../../desktop/activeProject'
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

export function generationCostContextForNode(node: { meta?: Record<string, unknown> | null } | undefined): GenerationCostContext {
  const meta = node?.meta || {}
  const read = (key: string): string => typeof meta[key] === 'string' ? String(meta[key]).trim() : ''
  const projectId = getDesktopActiveProjectId()
  return {
    vendorKey: read('modelVendor') || read('vendor') || read('imageModelVendor') || read('videoModelVendor') || undefined,
    // generationEtaStats indexes the recipe identity from provenance, where modelAlias wins.
    // Keep the confirmation card on that same identity or known history silently becomes cold start.
    modelKey: read('modelAlias') || read('modelKey') || read('imageModel') || read('videoModel') || undefined,
    ...(projectId ? { projectId } : {}),
  }
}

export function generationCostContextForNodes(nodes: readonly ({ meta?: Record<string, unknown> | null } | undefined)[]): GenerationCostContext {
  const contexts = nodes.map(generationCostContextForNode)
  const vendorKeys = new Set(contexts.map((context) => context.vendorKey).filter(Boolean))
  const modelKeys = new Set(contexts.map((context) => context.modelKey).filter(Boolean))
  return vendorKeys.size === 1 && modelKeys.size === 1
    ? { vendorKey: [...vendorKeys][0], modelKey: [...modelKeys][0], projectId: contexts.find((context) => context.projectId)?.projectId }
    : {}
}

export type HostingDisclosure = {
  message: string
  rememberLabel: string
  onRemember?: () => void | Promise<void>
}

// 付费生成确认 + 铸令牌（渲染层单一收口）。
// 方案：docs/plan/2026-06-21-spend-confirmation-gate.md（务实纵深 A1：用户直发轻确认、agent 强确认）。
//
// 铸令牌只发生在「真人点击确认」的 onClick → resolve(true) → mintSpendGrant 这条链上。
// AI 只能发 tool-call / 文本，够不到这里；agent 受理走同一确认（不可 light 抑制）。

export type SpendConfirmRequest = {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** 轻确认（用户直发）：允许「本次会话不再提示」。agent 受理不传 = 每次必确认。 */
  light?: boolean
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
  /**
   * 倒计时（毫秒）：设了即显进度条 + 「N 秒后自动忽略」，到点自动按「未确认」返回（不死等）。
   * 给 MCP/agent 驱动的确认用——外部调用方那头在等，超时必须给个干净返回。
   */
  countdownMs?: number
  /** When anonymous hosting is required, this disclosure is rendered in the same spend card. */
  hostingDisclosure?: HostingDisclosure
}

type Pending = SpendConfirmRequest & { resolve: (ok: boolean) => void }

type SpendConfirmState = {
  /** 当前显示的确认（队首）。null = 无待确认。对话框只读这一个。 */
  pending: Pending | null
  /**
   * B4：等待中的确认队列（队首之外的排队者）。根治「单槽覆盖」——
   * 两个审批同时来时后者不再冲掉前者的 resolve，而是排队，前一个决议后自动出下一个。
   * FIFO：先到先显。
   */
  queue: Pending[]
  lightSuppressed: boolean
  /** 弹确认；resolve true/false。light 且本会话已抑制 → 直接 true 不弹。已有在显 → 入队等候（不覆盖）。 */
  requestConfirm: (req: SpendConfirmRequest) => Promise<boolean>
  /** 对话框按钮回调：ok=确认；suppressLight=勾了「本会话不再提示」。决议队首后自动晋升下一个。 */
  resolvePending: (ok: boolean, suppressLight?: boolean, rememberHosting?: boolean) => void
}

export const useSpendConfirmStore = create<SpendConfirmState>()((set, get) => ({
  pending: null,
  queue: [],
  lightSuppressed: false,
  requestConfirm: (req) => {
    // A remembered spend prompt must not suppress a still-unanswered hosting disclosure.
    if (req.light && get().lightSuppressed && !req.hostingDisclosure) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      const entry = { ...req, resolve }
      // 队首空着就直接显；否则排队（根治：绝不覆盖已在等待的 resolve）。
      if (get().pending) set((state) => ({ queue: [...state.queue, entry] }))
      else set({ pending: entry })
    })
  },
  resolvePending: (ok, suppressLight, rememberHosting) => {
    const p = get().pending
    // 先决议当前队首，再从队列晋升下一个到显示位（空则 null）。
    set((state) => {
      const [next, ...rest] = state.queue
      return {
        pending: next ?? null,
        queue: rest,
        ...(ok && suppressLight ? { lightSuppressed: true } : {}),
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
  nodeIds: string[]
  title: string
  message: string
  confirmLabel?: string
  light?: boolean
  maxAttemptsPerNode?: number
  /** 本次要跑的节点（用来判「花不花额度」——本地 ComfyUI 不花就不弹卡）。 */
  nodes?: Array<{ meta?: Record<string, unknown> | null } | undefined>
  hostingDisclosure?: HostingDisclosure
}): Promise<string | null> {
  // nodes 传进来才判得出花不花钱；没传就照旧弹卡（保守：宁可多问一次）。
  const ok = await confirmGenerationSpend(opts.nodes ?? [undefined], {
    title: opts.title,
    message: opts.message,
    ...(opts.confirmLabel ? { confirmLabel: opts.confirmLabel } : {}),
    ...(opts.light ? { light: true } : {}),
    ...(opts.hostingDisclosure ? { hostingDisclosure: opts.hostingDisclosure } : {}),
  })
  if (!ok) return null
  return mintSpendGrant(opts.nodeIds, opts.maxAttemptsPerNode)
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

/** 付费确认（不花额度就直接放行，不弹卡）。返回 false = 用户取消。 */
export async function confirmGenerationSpend(
  nodes: Array<{ meta?: Record<string, unknown> | null } | undefined>,
  opts: { title: string; message: string; confirmLabel?: string; light?: boolean; hostingDisclosure?: HostingDisclosure },
): Promise<boolean> {
  if (!generationSpendsCredits(nodes)) return true
  return useSpendConfirmStore.getState().requestConfirm({
    title: opts.title,
    message: opts.message,
    ...(opts.confirmLabel ? { confirmLabel: opts.confirmLabel } : {}),
    ...(opts.light ? { light: true } : {}),
    ...(opts.hostingDisclosure ? { hostingDisclosure: opts.hostingDisclosure } : {}),
  })
}

export type GenerationCostKind = 'text' | 'image' | 'video' | 'audio' | 'model3d' | 'mixed'

export type GenerationCostContext = {
  vendorKey?: string
  modelKey?: string
  projectId?: string
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
  const projectId = context.projectId || getDesktopActiveProjectId()
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
  const sample = historicalEta(context, kind)
  const [lowSeconds, highSeconds] = sample
    ? [sample.p50Seconds * count, sample.p90Seconds * count]
    : kind === 'text' || kind === 'mixed' ? [0, 0] : COLD_START_SECONDS[kind].map((seconds) => seconds * count) as [number, number]
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
