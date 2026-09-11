import { isComfyuiVendor } from '../catalog/types'
import { assertAndConsumeSpendGrant, assertAndConsumeQuotedSpend } from '../spendGrant'
import { quoteSpendLine } from '../spendQuote'
import { requestRendererDecision } from '../capabilityCore/rendererBridge'
import type { SpendQuoteInput } from '../shared/contracts/spendQuote'

/** Last paid-submit boundary, shared by mapped, custom, audio and fallback runners. */
export async function consumeTaskSpend(input: SpendQuoteInput & {
  grantId?: string
  nodeId?: string
  projectId?: string
}): Promise<void> {
  if (isComfyuiVendor({ key: input.vendorKey })) {
    assertAndConsumeSpendGrant(input.grantId, input.nodeId)
    return
  }
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
