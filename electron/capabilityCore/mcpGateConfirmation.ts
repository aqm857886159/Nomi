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

export type GenerationGateChallengeProjection = {
  challengeId: string
  nonce?: string
  projectName?: string
  shotSummary?: string
  model: string
  referenceCount?: number
  costScope: string
  maximumCost: number
  currency?: string
  expiresAt: string
  confirmationText?: string
  /** P4 S3a — optional multi-shot projection: present → multi-shot card, absent → flat single-shot card (mcpProtocol). */
  shots?: MultiShotGateProjection
  handoff?: Record<string, unknown> // Opaque server handoff data. It never belongs in user-facing copy.
}

export type GenerationGateConfirmation = {
  challengeId: string
  confirmed: boolean
  surface: 'client' | 'nomi' | 'none'
  nextAction: 'in_client' | 'in_nomi' | 'wait_for_reconciliation'
  receiptId?: string
  receiptToken?: string
  trialFirst?: boolean // P4 S4 「先试拍第 1 镜」(§6 T3): {confirmed:false,trialFirst:true} → backend narrows plan to shot 1 + re-gates. Never approval.
}

export type GenerationGateVerificationResult = Pick<GenerationGateConfirmation, 'confirmed' | 'receiptId' | 'receiptToken' | 'trialFirst'>

export type GenerationGateConfirmationDependencies = {
  /** McpTransport 的结构子集——只取本流用到的四项，不 import 回 mcpProtocol（免类型环）。 */
  transport: {
    isAppOpen(): boolean
    getAuthenticatedClient?(): AuthenticatedMcpClient | null
    verifyClientGenerationConfirmation?(challenge: GenerationGateChallengeProjection, attestation: unknown): Promise<boolean | GenerationGateVerificationResult>
    confirmGenerationInNomi?(challenge: GenerationGateChallengeProjection): Promise<boolean | GenerationGateVerificationResult>
  }
  /** 客户端 initialize 时声明过 elicitation 没——随握手改变，所以是 getter 不是快照。 */
  clientSupportsElicitation: () => boolean
  /** 协议层的 elicitation/create 弹框（boolean 确认 + 可选 attestation）。 */
  elicitBooleanConfirm: (input: { message: string; title: string; description: string }, signal?: AbortSignal) => Promise<{
    supported: boolean
    confirmed?: boolean
    action?: 'accept' | 'decline' | 'cancel' | 'timeout'
    attestation?: unknown
  }>
}

export function createGenerationGateConfirmation({ transport, clientSupportsElicitation, elicitBooleanConfirm }: GenerationGateConfirmationDependencies) {
  // 同 challengeId 的并发确认共享一个 in-flight promise（客户端超时/重连铸不出第二张提示或 nonce）。
  // 实现住 mcpConfirmationBinding.ts，确认去重与生成门保持单一语义。
  const confirmationBinding = createConfirmationBinding<GenerationGateConfirmation>({
    isConfirmed: (result) => result.confirmed,
  })

  /**
   * Answer one server-owned generation challenge on exactly one surface. The
   * challenge is deliberately passed unchanged to the GUI fallback so a
   * client timeout/reconnect cannot mint a second prompt or nonce.
   */
  async function resolveGenerationConfirmation(
    challenge: GenerationGateChallengeProjection,
    signal?: AbortSignal,
  ): Promise<GenerationGateConfirmation> {
    if (!challenge.challengeId || !challenge.model || !challenge.costScope || !Number.isFinite(challenge.maximumCost)
      || !challenge.expiresAt) throw new Error('Invalid generation gate challenge')
    const authenticatedClient = transport.getAuthenticatedClient?.() ?? null
    if (clientSupportsElicitation() && authenticatedClient) {
      const elicited = await elicitBooleanConfirm({
        message: challenge.confirmationText || [
          `允许 Nomi 在${challenge.projectName ? `项目《${challenge.projectName}》` : '当前项目'}使用模型 ${challenge.model}`,
          `最多花费 ${challenge.currency || ''}${challenge.maximumCost}，${challenge.shotSummary || '生成这一镜'}吗？`,
        ].join('，'),
        title: '确认这次生成',
        description: [
          challenge.referenceCount === undefined ? '' : `参考图 ${challenge.referenceCount} 张`,
          `有效期至 ${challenge.expiresAt}`,
        ].filter(Boolean).join(' · '),
      }, signal)
      if (!elicited.confirmed) {
        return {
          challengeId: challenge.challengeId,
          confirmed: false,
          surface: 'client',
          nextAction: 'wait_for_reconciliation',
        }
      }
      if (elicited.attestation != null && typeof transport.verifyClientGenerationConfirmation === 'function') {
        const verified = await transport.verifyClientGenerationConfirmation(challenge, elicited.attestation)
        const result = typeof verified === 'boolean' ? { confirmed: verified } : verified
        if (result.confirmed === true) {
          return {
            challengeId: challenge.challengeId,
            confirmed: true,
            surface: 'client',
            nextAction: 'in_client',
            ...(result.receiptId ? { receiptId: result.receiptId } : {}),
            ...(result.receiptToken ? { receiptToken: result.receiptToken } : {}),
          }
        }
      } else if (elicited.attestation == null && challenge.handoff?.clientAttestation !== true) {
        return {
          challengeId: challenge.challengeId,
          confirmed: true,
          surface: 'client',
          nextAction: 'in_client',
        }
      }
    }
    if (typeof transport.confirmGenerationInNomi === 'function' && transport.isAppOpen()) {
      const fallback = await transport.confirmGenerationInNomi(challenge)
      const confirmed = typeof fallback === 'boolean' ? fallback : fallback.confirmed === true
      return {
        challengeId: challenge.challengeId,
        confirmed,
        surface: 'nomi',
        nextAction: confirmed ? 'in_nomi' : 'wait_for_reconciliation',
        ...(typeof fallback === 'object' ? {
          ...(fallback.receiptId ? { receiptId: fallback.receiptId } : {}),
          ...(fallback.receiptToken ? { receiptToken: fallback.receiptToken } : {}),
          ...(fallback.trialFirst === true ? { trialFirst: true } : {}), // P4 S4: carry trial-first so the caller shrinks the plan + re-gates
        } : {}),
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
