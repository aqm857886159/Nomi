import { create } from 'zustand'
import { mintSpendGrant } from '../../api/taskApi'

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
}): Promise<string | null> {
  const ok = await useSpendConfirmStore.getState().requestConfirm({
    title: opts.title,
    message: opts.message,
    ...(opts.confirmLabel ? { confirmLabel: opts.confirmLabel } : {}),
    ...(opts.light ? { light: true } : {}),
  })
  if (!ok) return null
  return mintSpendGrant(opts.nodeIds, opts.maxAttemptsPerNode)
}

/** 人话出片预估（C1：只显件数 + 预计时长，不显金额——守卫不依赖金额）。 */
export function describeGenerationCost(count: number, kind: 'image' | 'video' | 'mixed' = 'image'): string {
  const perItemSec = kind === 'video' ? 40 : 12
  const mins = Math.max(1, Math.round((count * perItemSec) / 60))
  const unit = kind === 'video' ? '段视频' : kind === 'mixed' ? '个画面' : '张画面'
  return `将生成 ${count} ${unit} · 预计约 ${mins} 分钟 · 会消耗模型额度`
}
