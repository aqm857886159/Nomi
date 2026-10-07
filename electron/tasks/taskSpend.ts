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

/** 令牌路：只剩附属付费口（试跑、认证、视频拆解、新手试生成、提示词提取；登记的例外，到期 2026-11-15）——核销内存令牌。 */
export const TOKEN_ADMISSION: TaskAdmission = { spendGate: consumeTaskSpend }

/**
 * 单镜 Run 路（画布单节点 ↑）：批准已经住在 Run 的门上（主进程手势收据），在途与认领在准入口
 * （appIntegrationCanvasShot）做完——这里只执行同一段传输，不核令牌、不认领。唯一调用方 canvasTransportProvider。
 */
export const RUN_APPROVED_ADMISSION: TaskAdmission = { spendGate: async () => undefined }
