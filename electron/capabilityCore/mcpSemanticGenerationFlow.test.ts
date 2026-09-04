import { describe, expect, it, vi, type MockedFunction } from 'vitest'

import { handleSemanticGenerationGate } from './mcpSemanticGenerationFlow'
import type { SemanticGenerationFlowDependencies } from './mcpSemanticGenerationFlow'
import type { GenerationGateChallengeProjection, GenerationGateConfirmation } from './mcpProtocol'

const challenge: GenerationGateChallengeProjection = {
  challengeId: 'challenge-1',
  model: 'fixture-model',
  costScope: 'generation_submit',
  maximumCost: 6,
  currency: 'CNY',
  expiresAt: '2026-09-04T00:10:00.000Z',
  handoff: { contractHash: 'digest-1', challengeToken: 'opaque-token' },
}

const confirmation: GenerationGateConfirmation = {
  challengeId: challenge.challengeId,
  confirmed: true,
  surface: 'client',
  nextAction: 'in_client',
  receiptId: 'receipt-1',
  receiptToken: 'receipt-token-1',
}

type InvokeMock = MockedFunction<SemanticGenerationFlowDependencies['invoke']>

function dependencies(overrides: Partial<{
  invoke: InvokeMock
  requestConfirmation: (received: GenerationGateChallengeProjection, signal?: AbortSignal) => Promise<GenerationGateConfirmation>
  locale: () => 'zh-CN' | 'en'
}> = {}) {
  const invoke = vi.fn<SemanticGenerationFlowDependencies['invoke']>(async (method, _params, _signal) => {
    if (method === 'nomi_request_generation_gate') return challenge
    if (method === 'nomi_decide_generation_gate') return { operationId: 'op-1', leaseHandle: 'lease-submit' }
    return { operationId: 'op-1', nextAction: 'observe' }
  })
  const requestConfirmation = vi.fn(async () => confirmation)
  const reply = vi.fn()
  const activeInvoke = overrides.invoke ?? invoke
  const activeRequestConfirmation = overrides.requestConfirmation ?? requestConfirmation
  return {
    invoke: activeInvoke,
    requestConfirmation: activeRequestConfirmation,
    buildResult: vi.fn((_toolName: string, _args: Record<string, unknown>, result: unknown) => result as Record<string, unknown>),
    reply,
    locale: overrides.locale ?? (() => 'en' as const),
    invokeSpy: activeInvoke,
    requestConfirmationSpy: activeRequestConfirmation,
  }
}

describe('semantic generation flow', () => {
  it('requests, confirms, decides, and starts the same operation with the receipt', async () => {
    const deps = dependencies()
    const signal = new AbortController().signal

    await handleSemanticGenerationGate('call-1', 'nomi_operation_gate', { phase: 'request' }, { operationId: 'op-1', leaseHandle: 'lease-gate' }, deps, signal)

    expect(deps.invokeSpy.mock.calls.map(([method]) => method)).toEqual([
      'nomi_request_generation_gate',
      'nomi_decide_generation_gate',
      'nomi_start_generation',
    ])
    expect(deps.requestConfirmationSpy).toHaveBeenCalledWith(challenge, signal)
    expect(deps.invokeSpy.mock.calls[1]?.[1]).toMatchObject({
      operationId: 'op-1',
      contractHash: 'digest-1',
      receiptId: 'receipt-1',
      receiptToken: 'receipt-token-1',
    })
    expect(deps.invokeSpy.mock.calls[2]?.[1]).toMatchObject({
      operationId: 'op-1',
      leaseHandle: 'lease-submit',
      receiptId: 'receipt-1',
      receiptToken: 'receipt-token-1',
    })
    expect(deps.reply).toHaveBeenCalledTimes(1)
  })

  it('does not decide or start after a decline without a receipt', async () => {
    const deps = dependencies({
      requestConfirmation: vi.fn(async () => ({ ...confirmation, confirmed: false, receiptId: undefined, receiptToken: undefined })),
    })

    await handleSemanticGenerationGate('call-2', 'nomi_operation_gate', { phase: 'request' }, { operationId: 'op-1' }, deps)

    expect(deps.invokeSpy).toHaveBeenCalledTimes(1)
    expect(deps.reply).toHaveBeenCalledWith('call-2', expect.objectContaining({
      isError: true,
      structuredContent: { nomiOutcome: expect.objectContaining({ errorCode: 'human_approval_required' }) },
    }))
  })

  it('uses the semantic public-challenge fallback while keeping the sealed handoff private', async () => {
    const invoke = vi.fn<SemanticGenerationFlowDependencies['invoke']>(async (method) => {
      if (method === 'nomi_request_generation_gate') return challenge
      if (method === 'nomi_decide_generation_gate') return { operationId: 'op-1' }
      return { operationId: 'op-1', nextAction: 'observe' }
    })
    const deps = dependencies({ invoke })

    await handleSemanticGenerationGate('call-public-fallback', 'nomi_operation_gate', { phase: 'request' }, { operationId: 'op-1', leaseHandle: 'lease-gate' }, deps)

    expect(invoke).toHaveBeenCalledTimes(3)
    expect(invoke.mock.calls[1]?.[1]).toMatchObject({ contractHash: 'digest-1' })
    expect(invoke.mock.calls[2]?.[1]).toMatchObject({ leaseHandle: 'lease-gate' })
    const result = deps.reply.mock.calls[0]?.[1] as { challenge?: Record<string, unknown> }
    expect(result.challenge).toMatchObject({ challengeId: 'challenge-1', model: 'fixture-model' })
    expect(result.challenge).not.toHaveProperty('handoff')
  })

  it('does not invent a contract hash when a public challenge has no handoff', async () => {
    const invoke = vi.fn<SemanticGenerationFlowDependencies['invoke']>(async (method) => {
      if (method === 'nomi_request_generation_gate') return { ...challenge, handoff: undefined }
      if (method === 'nomi_decide_generation_gate') return { operationId: 'op-1' }
      return { operationId: 'op-1', nextAction: 'observe' }
    })
    const deps = dependencies({ invoke })

    await handleSemanticGenerationGate('call-no-handoff', 'nomi_operation_gate', { phase: 'request' }, { operationId: 'op-1' }, deps)

    expect(invoke.mock.calls[1]?.[1]).toMatchObject({ contractHash: undefined })
    expect(deps.reply).toHaveBeenCalledTimes(1)
  })

  it('uses the localized boundary response for an unconfirmed semantic challenge', async () => {
    const deps = dependencies({
      locale: () => 'zh-CN',
      requestConfirmation: vi.fn(async () => ({ ...confirmation, confirmed: false, receiptId: undefined, receiptToken: undefined })),
    })

    await handleSemanticGenerationGate('call-zh-boundary', 'nomi_operation_gate', { phase: 'request' }, { operationId: 'op-1' }, deps)

    expect(deps.reply).toHaveBeenCalledWith('call-zh-boundary', expect.objectContaining({
      content: [{ type: 'text', text: '未开始：请在当前客户端确认这次生成，或在唯一的 Nomi 兜底卡中确认。' }],
      isError: true,
    }))
  })

  it('does not decide or start when a confirmed client returns no receipt', async () => {
    const deps = dependencies({
      requestConfirmation: vi.fn(async () => ({ ...confirmation, receiptId: undefined, receiptToken: undefined })),
    })

    await handleSemanticGenerationGate('call-boundary', 'nomi_operation_gate', { phase: 'request' }, { operationId: 'op-1' }, deps)

    expect(deps.invokeSpy).toHaveBeenCalledTimes(1)
    expect(deps.reply).toHaveBeenCalledWith('call-boundary', expect.objectContaining({
      isError: true,
      structuredContent: { nomiOutcome: expect.objectContaining({ errorCode: 'human_approval_required' }) },
    }))
  })

  it('surfaces a downstream receipt_invalid error and never starts the provider task', async () => {
    const invoke = vi.fn<SemanticGenerationFlowDependencies['invoke']>(async (method) => {
      if (method === 'nomi_request_generation_gate') return challenge
      if (method === 'nomi_decide_generation_gate') {
        throw Object.assign(new Error('Approval receipt project revision does not match the current project'), { code: 'receipt_invalid' })
      }
      return { operationId: 'op-1', nextAction: 'observe' }
    })
    const deps = dependencies({ invoke })

    await expect(handleSemanticGenerationGate('call-receipt-invalid', 'nomi_operation_gate', { phase: 'request' }, { operationId: 'op-1' }, deps))
      .rejects.toMatchObject({ code: 'receipt_invalid' })
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke).not.toHaveBeenCalledWith('nomi_start_generation', expect.anything(), expect.anything())
  })

  it.each([
    ['cancel', Object.assign(new Error('request cancelled'), { name: 'AbortError' }), 'confirmation'],
    ['timeout', new Error('confirmation timeout'), 'confirmation'],
    ['network', new Error('loopback network unavailable'), 'request'],
  ])('does not start on %s failure', async (_label, failure, phase) => {
    const deps = phase === 'request'
      ? dependencies({ invoke: vi.fn(async () => { throw failure }) })
      : dependencies({ requestConfirmation: vi.fn(async () => { throw failure }) })

    await expect(handleSemanticGenerationGate('call-failure', 'nomi_operation_gate', { phase: 'request' }, { operationId: 'op-1' }, deps))
      .rejects.toThrow(failure.message)
    expect(deps.invokeSpy).toHaveBeenCalledTimes(phase === 'request' ? 1 : 1)
    expect(deps.requestConfirmationSpy).toHaveBeenCalledTimes(phase === 'confirmation' ? 1 : 0)
  })
})
