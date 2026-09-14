// 「问一次人 → 铸一颗令牌」的**唯一那条链**（2026-09-12 抽出）。
//
// ── 它在解决哪个真实摩擦 ──
//
// 主进程里有两种动作会花钱：外部 agent 驱动的生成（`capabilityCore/gateway.ts`），和用户在画布上
// 点一下就跑起来的一整批调用（视频拆解）。两者后面那一段本来就必须一模一样：
//
//   prepareSpendQuote（把这次会真正发出的**每一次**调用摆成一行）
//     → 弹卡问人（`spend.confirm`，卡永不因空闲超时）
//     → takeSpendQuote（同一张报价再也铸不出第二颗令牌）
//     → mintSpendGrant（令牌只在主进程铸，渲染层只拿到不透明 id）
//
// 让第二个调用方自己再写一遍，两条链就会各自漂移，而漂移的地方是**钱**。所以这里只有一个函数。
//
// ── 批量语义（2026-09-12 用户拍板「确认一次，这一批跑完」）──
//
// `lines` 是**这次动作会发出的每一次付费调用**，一行一次：拆解 12 镜 = 12 行画面 + 1 行转写。
// 用户看到的是**这一批的总价**，点一次；`assertAndConsumeQuotedSpend` 随后逐次扣减，
// 扣完为止——不会为第 2 镜再弹一张卡，也不会让第 14 次调用白跑。
import { mintSpendGrant } from './spendGrant'
import { prepareSpendQuote, takeSpendQuote } from './spendQuote'
import { requestRendererDecision } from './capabilityCore/rendererBridge'
import type { SpendQuoteInput } from './shared/contracts/spendQuote'

export type SpendConfirmationRequest = {
  /** 这次付费挂在哪个节点上（令牌按节点记预算，防「批准 A 借令牌生成 B」）。 */
  nodeId: string
  projectId?: string
  projectName?: string
  /** 卡上那句「要生成什么」（`image`/`video`/`audio`/`text`/`deconstruct`）。 */
  intent: string
  /** 卡上「模型」那行显示谁（批量取第一行即可，同一批本来就同源）。 */
  vendor: string
  modelKey: string
  prompt?: string
  /** 这次动作会真正发出的每一次付费调用，一行一次。 */
  lines: SpendQuoteInput[]
  /**
   * 每个节点允许发起几次 vendor 请求。缺省 = `spendGrant` 的默认（1 首发 + 2 自动重试），
   * 审片环的重生就吃这份余量。**批量调用方必须显式给 `lines.length`**：一行一次，
   * 报价里没有的那一次不该有预算。
   */
  maxAttemptsPerNode?: number
}

/**
 * 弹卡问人，点了确认就铸一颗覆盖 `lines` 全部调用的令牌；没点/窗口没了 → `null`（fail-closed）。
 * **不吞错**：渲染层不可用会抛 `RendererUnavailableError`，由调用方决定是拒发还是报给用户。
 */
export async function confirmSpendAndMintGrant(request: SpendConfirmationRequest): Promise<string | null> {
  if (!request.lines.length) throw new Error('confirmSpendAndMintGrant: lines is empty（没有要花的钱就不该铸令牌）')
  const quote = prepareSpendQuote(request.lines)
  const reply = (await requestRendererDecision('spend.confirm', {
    projectId: request.projectId,
    projectName: request.projectName,
    nodeId: request.nodeId,
    intent: request.intent,
    vendor: request.vendor,
    modelKey: request.modelKey,
    prompt: request.prompt ?? '',
    quote,
    // 这张卡覆盖几次调用。批量确认的卡必须说出这个数——用户点的是「这一批」，
    // 而卡上只有一个总价时，他无从知道这一下批掉了 1 次还是 13 次。
    callCount: quote.lines.length,
  })) as { confirmed?: boolean } | null
  if (reply?.confirmed !== true) return null
  // 真人点确认才到这里；消费仍在 runTask 的硬闸（信任边界不破）。
  return mintSpendGrant({
    nodeIds: [request.nodeId],
    ...(request.maxAttemptsPerNode ? { maxAttemptsPerNode: request.maxAttemptsPerNode } : {}),
    quote: takeSpendQuote(quote.quoteId),
  })
}
