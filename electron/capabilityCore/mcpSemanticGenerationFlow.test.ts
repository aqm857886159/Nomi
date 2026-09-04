import { describe, expect, it, vi } from 'vitest'

import { handleSemanticGenerationGate } from './mcpSemanticGenerationFlow'
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

function dependencies(overrides: Partial<{
  invoke: (method: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>
  requestConfirmation: (received: GenerationGateChallengeProjection, signal?: AbortSignal) => Promise<GenerationGateConfirmation>
}> = {}) {
  const invoke = vi.fn(async (method: string, _params: Record<string, unknown>, _signal?: AbortSignal) => {
    if (method === 'nomi_request_generation_gate') return challenge
    if (method === 'nomi_decide_generation_gate') return { operationId: 'op-1', leaseHandle: 'lease-submit' }
    return { operationId: 'op-1', nextAction: 'observe' }
  })
  const requestConfirmation = vi.fn(async () => confirmation)
  const reply = vi.fn()
  return {
    invoke: overrides.invoke ?? invoke,
    requestConfirmation: overrides.requestConfirmation ?? requestConfirmation,
    buildResult: vi.fn((_toolName: string, _args: Record<string, unknown>, result: unknown) => result as Record<string, unknown>),
    reply,
    locale: () => 'en' as const,
    invokeSpy: invoke,
    requestConfirmationSpy: requestConfirmation,
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
    const invoke = vi.fn(async (method: string) => {
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
    expect(deps.invokeSpy).toHaveBeenCalledTimes(phase === 'request' ? 0 : 1)
  })
})
