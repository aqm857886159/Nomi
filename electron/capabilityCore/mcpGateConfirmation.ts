// 能力核 · MCP 生成门确认流（从 mcpProtocol.ts 提取，行为逐字节不变——壳到 800/800 的 headroom 提取，
// 同 mcpToolCatalog.ts / mcpSemanticGenerationFlow.ts 的拆法；覆盖：mcpGenerationConfirmation.test.ts）。
//
// 管「一张服务端签发的生成挑战 challenge → 恰好一个确认面」：客户端声明 elicitation 且连接经主进程
// 认证 → 弹在调用方（带 attestation 时走主进程强校验）；客户端问不了、Nomi 开着 → 落应用内兜底卡；
// 两边都没有 → 如实回 surface:'none'（绝不静默放行）。同一 challengeId 的并发确认共享一个 in-flight
// promise——客户端超时/重连铸不出第二张提示或 nonce。协议层只注入三样依赖（见依赖类型注释），
// 不 import electron，保持纯逻辑单测边界。
import type { AuthenticatedMcpClient } from './security'
import type { MultiShotGateProjection } from '../productionRun/shotPricing'
import { createConfirmationBinding } from './mcpConfirmationBinding'
import { HUMAN_DECISION_TIMEOUT_MS } from './mcpElicitation'

export type GenerationGateChallengeProjection = {
  challengeId: string
  nonce?: string
  projectName?: string
  shotSummary?: string
  model: string
  referenceCount?: number
  costScope: string
  /** 已知价那部分的合计。`null` = 这批**全部**算不出价——卡上写「价格未知」，绝不写 ¥0。 */
  maximumCost: number | null
  /** 这批里价格未知的镜数（2026-09-21 开闸）。> 0 时摘要里要如实说出来。 */
  unknownShotCount?: number
  currency?: string
  expiresAt: string
  confirmationText?: string
  /** P4 S3a — optional multi-shot projection: present → multi-shot card, absent → flat single-shot card (mcpProtocol). */
  shots?: MultiShotGateProjection
  /**
   * 2026-09-10：这次确认是不是「以后 ¥X 内别再逐镜问」（降到 budget_only）。present ⇒ 摘要里加那句话，
   * 并把标题换成信任降档的口吻——用户要一眼看出他答的是「这一次」还是「以后」。
   */
  trustGrant?: { currency: string; maximum: number }
  handoff?: Record<string, unknown> // Opaque server handoff data. It never belongs in user-facing copy.
}

export type GenerationGateConfirmation = {
  challengeId: string
  confirmed: boolean
  surface: 'client' | 'nomi' | 'none'
  nextAction: 'in_client' | 'in_nomi' | 'wait_for_reconciliation'
  receiptId?: string
  receiptToken?: string
  /**
   * 用户明确答了「不」（declined）或确认超时没人答（timeout）。缺省 = 还没有人答 / 没有确认面。
   * Agent 据此分清「被拒绝了，停下」与「还没确认」，不再反复催问（C-4）。
   */
  denial?: 'declined' | 'timeout'
  trialFirst?: boolean // P4 S4 「先试拍第 1 镜」(§6 T3): {confirmed:false,trialFirst:true} → backend narrows plan to shot 1 + re-gates. Never approval.
}

export type GenerationGateVerificationResult = Pick<GenerationGateConfirmation, 'confirmed' | 'receiptId' | 'receiptToken' | 'trialFirst'> & { declined?: boolean }

export type GenerationGateConfirmationDependencies = {
  /** McpTransport 的结构子集——只取本流用到的四项，不 import 回 mcpProtocol（免类型环）。 */
  transport: {
    isAppOpen(): boolean
    getAuthenticatedClient?(): AuthenticatedMcpClient | null
    /**
     * 把人在客户端里答的原话交给主进程；主进程判成「是」才签收据（结果见 GenerationGateVerificationResult）。
     * 返回别的形状（不是对象、没有 confirmed: true）一律算没批准。
     */
    verifyClientGenerationConfirmation?(challenge: GenerationGateChallengeProjection, answer: unknown): Promise<unknown>
    /** 落 Nomi 兜底卡。`signal`：这次调用被取消时主进程不再等卡、晚到的点击不签。 */
    confirmGenerationInNomi?(challenge: GenerationGateChallengeProjection, signal?: AbortSignal): Promise<unknown>
  }
  /** 客户端 initialize 时声明过 elicitation 没——随握手改变，所以是 getter 不是快照。 */
  clientSupportsElicitation: () => boolean
  /** 协议层的 elicitation/create 弹框（boolean 确认 + 人的原话）。 */
  elicitBooleanConfirm: (input: { message: string; title: string; description: string; timeoutMs?: number }, signal?: AbortSignal) => Promise<{
    supported: boolean
    confirmed?: boolean
    action?: 'accept' | 'decline' | 'cancel' | 'timeout'
    answer?: { action: string; confirm?: unknown }
  }>
}

/** 主进程回来的结论只读不判：不是对象就当没批准。 */
function verdictOf(value: unknown): GenerationGateVerificationResult {
  if (!value || typeof value !== 'object') return { confirmed: false }
  const typed = value as Record<string, unknown>
  return {
    confirmed: typed.confirmed === true,
    ...(typeof typed.receiptId === 'string' && typed.receiptId ? { receiptId: typed.receiptId } : {}),
    ...(typeof typed.receiptToken === 'string' && typed.receiptToken ? { receiptToken: typed.receiptToken } : {}),
    ...(typed.trialFirst === true ? { trialFirst: true } : {}),
    ...(typed.declined === true ? { declined: true } : {}),
  }
}

/** 一镜一行：镜号 · 模型 · 价格。价格算不出就如实写「价格未知」，绝不写 ¥0（shotPricing.ts 的同一条诚实规则）。 */
function shotPriceLines(projection: MultiShotGateProjection): string[] {
  const currency = projection.currency || ''
  return projection.shots.map((shot) => {
    const price = shot.price.known ? `${currency}${shot.price.amount}` : '价格未知'
    return `#${shot.index} ${shot.sceneOneLiner || shot.shotId} · ${shot.providerModelText} · ${price}`
  })
}

/**
 * 付费确认的摘要正文（R2：用户要能一眼看清「花在哪几镜、每镜多少、一共多少」）。
 *
 * 为什么摊开逐镜而不是只报一个总数：外部 MCP 客户端里没有 Nomi 的确认卡，这段文字**就是**那张卡。
 * 只给「最多花费 ¥X」等于让用户闭着眼签字。逐镜价目 + 合计是把不可见的花费变可见的最小充分披露。
 */
export function spendConfirmationMessage(challenge: GenerationGateChallengeProjection): string {
  const currency = challenge.currency || ''
  const unknown = challenge.unknownShotCount ?? 0
  // 三种说法，对应三种**不同的事实**——混成一句就一定有一句是假的：
  //   · 全部算不出价 → 根本没有合计可报；
  //   · 一部分算不出 → 报已知那部分的合计，并明说另外几镜花多少事后才知道；
  //   · 全部已知 → 就是那个合计。
  const total = challenge.maximumCost === null
    ? `这批镜头目录里都没有标价，花多少事后才知道`
    : unknown > 0
      ? `已知的部分合计最多 ${currency}${challenge.maximumCost}；另有 ${unknown} 镜目录未标价，花多少事后才知道`
      : `合计最多 ${currency}${challenge.maximumCost}`
  const head = challenge.trustGrant
    ? `以后在${challenge.projectName ? `项目《${challenge.projectName}》` : '当前项目'}的这个制作里，${currency}${challenge.trustGrant.maximum} 以内不再逐镜问你。这批镜头是：`
    : `允许 Nomi 在${challenge.projectName ? `项目《${challenge.projectName}》` : '当前项目'}使用模型 ${challenge.model}，${challenge.shotSummary || '生成这一镜'}：`
  const lines = challenge.shots?.shots.length ? shotPriceLines(challenge.shots) : [`· ${challenge.model}`]
  const tail = challenge.trustGrant
    ? `${total}。批准后这批镜头直接跑完，${currency}${challenge.trustGrant.maximum} 内不再逐镜问；超出这个数仍会重新问你。`
    : unknown > 0
      ? `${total}。要继续就得接受「花多少事后才知道」。`
      : `${total}。`
  return [head, ...lines, tail].join('\n')
}

export function createGenerationGateConfirmation({ transport, clientSupportsElicitation, elicitBooleanConfirm }: GenerationGateConfirmationDependencies) {
  // 同 challengeId 的并发确认共享一个 in-flight promise（客户端超时/重连铸不出第二张提示或 nonce）。
  // 实现住 mcpConfirmationBinding.ts，确认去重与生成门保持单一语义。
  const confirmationBinding = createConfirmationBinding<GenerationGateConfirmation>()

  /**
   * Answer one server-owned generation challenge on exactly one surface. The
   * challenge is deliberately passed unchanged to the GUI fallback so a
   * client timeout/reconnect cannot mint a second prompt or nonce.
   */
  async function resolveGenerationConfirmation(
    challenge: GenerationGateChallengeProjection,
    signal?: AbortSignal,
  ): Promise<GenerationGateConfirmation> {
    if (!challenge.challengeId || !challenge.model || !challenge.costScope
      || (challenge.maximumCost !== null && !Number.isFinite(challenge.maximumCost))
      || !challenge.expiresAt) throw new Error('Invalid generation gate challenge')
    // 永不把「算不出」当 ¥0 摆给用户看——但也**不因此不弹**（2026-09-21 用户拍板）。
    //
    // 从前这里对「一批镜头全部定不出价」直接回 `surface:'none'`，理由是「那个总数没有含义」。
    // 总数确实没有含义，但结论下错了一半：外部 MCP 那条路上这段文字**就是**那张卡，回 none
    // 等于用户连拒绝的机会都没有，而内置 204 个模型一条价都没填 —— 这条分支把整条路堵死了。
    // 正解是把「没有总数」如实说出来（见 spendConfirmationMessage 的三种说法），让人自己决定。
    //
    // 仍然 fail-closed 的只剩一条：**信任降档**（以后 ¥X 内不再问）给不出正数 X。
    // 那条闸的全部意义就是那个 X，没有 X 就没有可授权的范围——它和「这一次花多少」不是一回事。
    // 注意 `amount === 0` **不是**未知：本地 ComfyUI 这类模型真就免费，把它一并拒掉是另一种谎。
    // 未知与免费的区别由 shotPricing.ts 的 `price.known` 承载，这里只是读它。
    if (challenge.trustGrant && !(challenge.trustGrant.maximum > 0)) {
      return { challengeId: challenge.challengeId, confirmed: false, surface: 'none', nextAction: 'in_nomi' }
    }
    const authenticatedClient = transport.getAuthenticatedClient?.() ?? null
    if (clientSupportsElicitation() && authenticatedClient) {
      const elicited = await elicitBooleanConfirm({
        message: challenge.confirmationText || spendConfirmationMessage(challenge),
        title: challenge.trustGrant ? '确认以后不再逐镜问' : '确认这次生成',
        description: [
          challenge.referenceCount === undefined ? '' : `参考图 ${challenge.referenceCount} 张`,
          `有效期至 ${challenge.expiresAt}`,
        ].filter(Boolean).join(' · '),
        // 花钱这一问在等人，不替人答「否」（和 Nomi 里的卡同一条：2026-09-11 拍板没有墙钟期限）。
        timeoutMs: HUMAN_DECISION_TIMEOUT_MS,
      }, signal)
      if (!elicited.confirmed) {
        return {
          challengeId: challenge.challengeId,
          confirmed: false,
          surface: 'client',
          nextAction: 'wait_for_reconciliation',
          denial: elicited.action === 'timeout' ? 'timeout' : 'declined',
        }
      }
      // 客户端明确点了「是」。**但光有「是」不够——花钱必须有主进程铸的收据**：人的原话交给主进程，
      // 由生成门主人判、由它签（mcpSemanticGenerationFlow / generationDispatcher 都只认收据）。
      // 没有验证器、或主进程没签，就落 Nomi 兜底卡或回「没有确认面」，不在这里就地算数。
      if (typeof transport.verifyClientGenerationConfirmation === 'function') {
        const result = verdictOf(await transport.verifyClientGenerationConfirmation(challenge, elicited.answer))
        if (result.confirmed) {
          return {
            challengeId: challenge.challengeId,
            confirmed: result.confirmed,
            surface: 'client',
            nextAction: 'in_client',
            ...(result.receiptId ? { receiptId: result.receiptId } : {}),
            ...(result.receiptToken ? { receiptToken: result.receiptToken } : {}),
          }
        }
      }
    }
    if (typeof transport.confirmGenerationInNomi === 'function' && transport.isAppOpen()) {
      const fallback = verdictOf(await transport.confirmGenerationInNomi(challenge, signal))
      const { confirmed } = fallback
      return {
        challengeId: challenge.challengeId,
        confirmed,
        surface: 'nomi',
        nextAction: confirmed ? 'in_nomi' : 'wait_for_reconciliation',
        ...(!confirmed && fallback.declined === true ? { denial: 'declined' as const } : {}),
        ...(fallback.receiptId ? { receiptId: fallback.receiptId } : {}),
        ...(fallback.receiptToken ? { receiptToken: fallback.receiptToken } : {}),
        ...(fallback.trialFirst === true ? { trialFirst: true } : {}), // P4 S4: carry trial-first so the caller shrinks the plan + re-gates
      }
    }
    return {
      challengeId: challenge.challengeId,
      confirmed: false,
      surface: 'none',
      nextAction: 'in_nomi',
    }
  }

  async function requestGenerationConfirmation(
    challenge: GenerationGateChallengeProjection,
    signal?: AbortSignal,
  ): Promise<GenerationGateConfirmation> {
    return confirmationBinding.run(challenge.challengeId, () => resolveGenerationConfirmation(challenge, signal))
  }

  return { requestGenerationConfirmation }
}

/**
 * 「被拒绝 / 超时」翻成给 Agent 的终态说明（生成门与降档共用这一份，免得两个入口各说各的）。
 * 结构化的 nextAction：`stop` = 用户说不，结束这次、等新指令、别再发确认；`ask_user` = 没人答，先问用户本人。
 */
export function generationDenialOutcome(denial: NonNullable<GenerationGateConfirmation['denial']>, locale: 'zh-CN' | 'en'): { text: string; structuredContent: Record<string, unknown> } {
  const declined = denial === 'declined'
  const text = locale === 'en'
    ? declined
      ? 'Not started: the user declined this request. Nothing was spent. Stop this generation and wait for new instructions from the user; do not ask for confirmation again.'
      : 'Not started: nobody answered the confirmation in time. Nothing was spent. Ask the user whether they still want this before requesting confirmation again.'
    : declined
      ? '未开始：用户拒绝了这次请求，没有花费。请结束这次生成，等用户的新指令；不要再次发起确认。'
      : '未开始：确认超时没有人答复，没有花费。请先问用户是否还要做，再决定要不要重新发起确认。'
  return {
    text,
    structuredContent: { nomiOutcome: { denied: true, applied: false, reason: denial, nextAction: declined ? 'stop' : 'ask_user' } },
  }
}
