import { describe, expect, it, vi } from 'vitest'

import { handleTrustDowngrade } from './mcpTrustDowngrade'
import type { GenerationGateChallengeProjection, GenerationGateConfirmation } from './mcpGateConfirmation'

/**
 * 「以后 ¥X 内别再逐镜问」在**调用方客户端**里问（2026-09-10 21:00 拍板）。这一层钉三件事：
 *  · 问了真人、拿到收据，才轮到改档（收据随 production.control 走）；
 *  · 没答应 / 没人可问 → 一个字都不改，且说清是谁没能问；
 *  · 上限算不出 → 连问都不问（永不拿 ¥0 骗签字）。
 */
function harness(confirmation: Partial<GenerationGateConfirmation>, challengeError?: unknown) {
  const replies: { id: unknown; result: unknown }[] = []
  const invocations: { method: string; params: Record<string, unknown> }[] = []
  const requestGenerationConfirmation = vi.fn(async () => ({
    challengeId: 'challenge-trust', confirmed: true, surface: 'client', nextAction: 'in_client', ...confirmation,
  }) as GenerationGateConfirmation)
  const dependencies = {
    invokeForRequest: vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'production.trust-challenge' && challengeError) throw challengeError
      invocations.push({ method, params })
      return method === 'production.trust-challenge'
        ? { challengeId: 'challenge-trust', model: 'apimart · kling-v2（i2v）', costScope: 'trust.budget-only:run-1:CNY:9', maximumCost: 9, currency: 'CNY', expiresAt: '2026-08-24T00:00:00.000Z', trustGrant: { currency: 'CNY', maximum: 9 } } as GenerationGateChallengeProjection
        : { runId: 'run-1', revision: 3 }
    }),
    requestGenerationConfirmation,
    reply: (id: unknown, result: unknown) => { replies.push({ id, result }) },
    buildToolResultPayload: (toolName: string, _args: Record<string, unknown>, result: unknown) => ({ toolName, result }),
    locale: () => 'zh-CN' as const,
  }
  return { dependencies, replies, invocations, requestGenerationConfirmation }
}

const request = {
  id: 7,
  toolName: 'nomi_run_control',
  args: { action: 'set_trust', trustLevel: 'budget_only' },
  routedMethod: 'production.control',
  built: { projectId: 'project-1', runId: 'run-1', action: 'set_trust', trustLevel: 'budget_only' },
} as const

function errorText(result: unknown): string {
  return String((result as { content: { text: string }[] }).content[0]?.text ?? '')
}

describe('capabilityCore/mcpTrustDowngrade', () => {
  it('carries the client-minted receipt into production.control, which is what the command boundary verifies', async () => {
    const { dependencies, replies, invocations } = harness({ receiptId: 'receipt-1', receiptToken: 'token-1' })

    expect(await handleTrustDowngrade(request, dependencies)).toBe(true)
    expect(invocations.map((call) => call.method)).toEqual(['production.trust-challenge', 'production.control'])
    expect(invocations[1]?.params).toMatchObject({ ...request.built, receiptId: 'receipt-1', receiptToken: 'token-1' })
    expect(replies[0]?.result).toEqual({ toolName: 'nomi_run_control', result: { runId: 'run-1', revision: 3 } })
  })

  it('changes nothing when the human declines, and says who could not ask when nobody could', async () => {
    const declined = harness({ confirmed: false, surface: 'client' })
    expect(await handleTrustDowngrade(request, declined.dependencies)).toBe(true)
    expect(declined.invocations.map((call) => call.method)).toEqual(['production.trust-challenge'])
    expect(declined.replies[0]?.result).toMatchObject({ isError: true })
    expect(errorText(declined.replies[0]?.result)).toContain('你没有批准')

    // 「没人可问」和「问了被拒」是两件事：前者是能力缺口，后者是用户的答案。文案不许混。
    const unaskable = harness({ confirmed: false, surface: 'none' })
    await handleTrustDowngrade(request, unaskable.dependencies)
    expect(errorText(unaskable.replies[0]?.result)).toContain('都没能向你征求')
  })

  it('never prompts for a ceiling it cannot state, and never launders a real failure into a decline', async () => {
    const unpriced = harness({}, Object.assign(new Error('no sealed authorization'), { code: 'human_approval_required' }))
    expect(await handleTrustDowngrade(request, unpriced.dependencies)).toBe(true)
    expect(unpriced.requestGenerationConfirmation).not.toHaveBeenCalled()
    expect(errorText(unpriced.replies[0]?.result)).toContain('算不出确切的上限')

    const broken = harness({}, new Error('transport is down'))
    await expect(handleTrustDowngrade(request, broken.dependencies)).rejects.toThrowError('transport is down')
    expect(broken.replies).toEqual([])
  })

  it('only intercepts the downgrade that removes a paid confirmation', async () => {
    const { dependencies, invocations } = harness({})
    for (const args of [
      { action: 'cancel' },
      { action: 'set_trust', trustLevel: 'confirm_all' },
      { action: 'set_trust', trustLevel: 'key_confirm' },
    ]) {
      expect(await handleTrustDowngrade({ ...request, args }, dependencies)).toBe(false)
    }
    expect(await handleTrustDowngrade({ ...request, toolName: 'nomi_run_gate' }, dependencies)).toBe(false)
    expect(invocations).toEqual([])
  })
})
