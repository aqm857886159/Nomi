import { isComfyuiVendorKey } from '../runner/comfyuiTaskControl'
import { create } from 'zustand'
import { mintSpendGrant } from '../../api/taskApi'
import type { ProductionContractView } from './productionContractView'

// 付费生成确认 + 铸令牌（渲染层单一收口）。
// 方案：docs/plan/2026-06-21-spend-confirmation-gate.md（务实纵深 A1：用户直发轻确认、agent 强确认）。
//
// 铸令牌只发生在「真人点击确认」的 onClick → resolve(true) → mintSpendGrant 这条链上。
// AI 只能发 tool-call / 文本，够不到这里；agent 受理走同一确认（不可 light 抑制）。

export type SpendConfirmRequest = {
  title: string
  message: string
  confirmLabel?: string
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
  kind?: 'generation' | 'reference' | 'plan' | 'contract'
  /** Durable production summary shown inside the existing confirmation shell. */
  contract?: ProductionContractView
  /** Recovery for an incomplete contract. Closing through this action is not a rejection. */
  onOpenBudgetSettings?: () => void
  /** 明细行（节点 / 模型 / 预估），让用户一眼看懂谁要花钱、花在哪。 */
  details?: Array<{ label: string; value: string }>
  /**
   * 倒计时（毫秒）：设了即显进度条 + 「N 秒后自动忽略」，到点自动按「未确认」返回（不死等）。
   * 给 MCP/agent 驱动的确认用——外部调用方那头在等，超时必须给个干净返回。
   */
  countdownMs?: number
}

type Pending = SpendConfirmRequest & { resolve: (ok: boolean) => void }

type SpendConfirmState = {
  pending: Pending | null
  lightSuppressed: boolean
  /** 弹确认；resolve true/false。light 且本会话已抑制 → 直接 true 不弹。 */
  requestConfirm: (req: SpendConfirmRequest) => Promise<boolean>
  /** 对话框按钮回调：ok=确认；suppressLight=勾了「本会话不再提示」。 */
  resolvePending: (ok: boolean, suppressLight?: boolean) => void
}

export const useSpendConfirmStore = create<SpendConfirmState>()((set, get) => ({
  pending: null,
  lightSuppressed: false,
  requestConfirm: (req) => {
    if (req.light && get().lightSuppressed) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => set({ pending: { ...req, resolve } }))
  },
  resolvePending: (ok, suppressLight) => {
    const p = get().pending
    set({ pending: null, ...(ok && suppressLight ? { lightSuppressed: true } : {}) })
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
}): Promise<string | null> {
  // nodes 传进来才判得出花不花钱；没传就照旧弹卡（保守：宁可多问一次）。
  const ok = await confirmGenerationSpend(opts.nodes ?? [undefined], {
    title: opts.title,
    message: opts.message,
    ...(opts.confirmLabel ? { confirmLabel: opts.confirmLabel } : {}),
    ...(opts.light ? { light: true } : {}),
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
  opts: { title: string; message: string; confirmLabel?: string; light?: boolean },
): Promise<boolean> {
  if (!generationSpendsCredits(nodes)) return true
  return useSpendConfirmStore.getState().requestConfirm({
    title: opts.title,
    message: opts.message,
    ...(opts.confirmLabel ? { confirmLabel: opts.confirmLabel } : {}),
    ...(opts.light ? { light: true } : {}),
  })
}

/** 人话出片预估（C1：只显件数 + 预计时长，不显金额——守卫不依赖金额）。 */
export function describeGenerationCost(count: number, kind: 'image' | 'video' | 'audio' | 'mixed' = 'image'): string {
  const perItemSec = kind === 'video' ? 40 : kind === 'audio' ? 20 : 12
  const mins = Math.max(1, Math.round((count * perItemSec) / 60))
  const unit = kind === 'video' ? '段视频' : kind === 'audio' ? '段配音' : kind === 'mixed' ? '个素材' : '张画面'
  return `将生成 ${count} ${unit} · 预计约 ${mins} 分钟 · 会消耗模型额度`
}
