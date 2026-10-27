import { isComfyuiVendor } from '../catalog/types'
import { assertAndConsumeQuotedSpend } from '../spendGrant'
import { quoteSpendLine } from '../spendQuote'
import { requestRendererDecision } from '../capabilityCore/rendererBridge'
import type { SpendQuoteInput } from '../shared/contracts/spendQuote'

/** Last paid-submit boundary, shared by mapped, custom, audio and fallback runners. */
export async function consumeTaskSpend(input: SpendQuoteInput & {
  grantId?: string
  nodeId?: string
  projectId?: string
}): Promise<void> {
  // 本地 ComfyUI 跑在用户自己的显卡上、一分钱不花：没有要守的钱，不核令牌（发动机收敛第一刀第 3–4 步：画布不再铸令牌，
  // 本地 ComfyUI 节点照常从画布直接跑）。附属付费口铸给它的令牌在这里不再被消费，这是有意的。
  if (isComfyuiVendor({ key: input.vendorKey })) return
  const charge = quoteSpendLine(input)
  await assertAndConsumeQuotedSpend(input.grantId, input.nodeId, charge, async (quote) => {
    // 等的是人，不是渲染层：没有墙钟期限（2026-09-11 拍板，审批卡永不因空闲超时）。
    const reply = await requestRendererDecision('spend.confirm', {
      projectId: input.projectId,
      nodeId: input.nodeId,
      vendor: input.vendorKey,
      modelKey: input.modelKey,
      quote,
      intent: 'generation',
    }) as { confirmed?: boolean } | null
    return reply?.confirmed === true
  })
}

/** 一次任务在发出去之前要过的那一道付费闸。「这一镜归谁」的认领只在画布付费口的准入里做（appIntegrationCanvasShot）。 */
export type TaskAdmission = { spendGate: typeof consumeTaskSpend }

/** 令牌路：只剩登记的附属付费口（试跑、认证、视频拆解；例外到期 2026-12-15）——核销内存令牌。 */
export const TOKEN_ADMISSION: TaskAdmission = { spendGate: consumeTaskSpend }

/**
 * 单镜 Run 路（画布单节点 ↑）：批准已经住在 Run 的门上（主进程手势收据），在途与认领在准入口
 * （appIntegrationCanvasShot）做完——这里只执行同一段传输，不核令牌、不认领。唯一调用方 canvasTransportProvider。
 */
export const RUN_APPROVED_ADMISSION: TaskAdmission = { spendGate: async () => undefined }

/**
 * 付费闸外层的「停」（2026-10-27 拆解取消第一刀）：已取消就不进闸——不核令牌、不扣钱；闸里等人确认回来时
 * 已取消，也不放行。runtime 的每条付费出口发请求之前都先调 `admission.spendGate`，所以包在这一层，
 * 所有 runner 一处判、共用。闸里面（consumeTaskSpend / 令牌 / 确认）一行不改。
 * 过了闸的那一次照常发出、照常结算：在途请求不在这里断（第二刀才给 runner 接 signal）。
 * `onAdmitted` 在放行那一刻记一笔，调用方据此报「已过付费闸（已发或未知）」的次数。
 */
export function stoppableAdmission(signal: AbortSignal, admission: TaskAdmission, onAdmitted?: () => void): TaskAdmission {
  return {
    spendGate: async (input) => {
      signal.throwIfAborted()
      await admission.spendGate(input)
      signal.throwIfAborted()
      onAdmitted?.()
    },
  }
}
