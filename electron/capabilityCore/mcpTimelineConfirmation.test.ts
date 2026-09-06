import { describe, expect, it, vi } from 'vitest'

import { handleTimelineEditConfirmation } from './mcpTimelineConfirmation'

type Confirmation = Awaited<ReturnType<Parameters<typeof handleTimelineEditConfirmation>[1]['elicitBooleanConfirm']>>

function harness(confirmation: Confirmation) {
  const replies: unknown[] = []
  const invocations: { method: string; params: Record<string, unknown>; options?: { planConfirmed?: boolean } }[] = []
  const dependencies = {
    elicitBooleanConfirm: vi.fn(async () => confirmation),
    invokeForRequest: vi.fn(async (method: string, params: Record<string, unknown>, options?: { planConfirmed?: boolean }) => {
      invocations.push({ method, params, options })
      return { ok: true, revision: 'rev-2' }
    }),
    reply: (_id: unknown, result: unknown) => { replies.push(result) },
    buildToolResultPayload: (toolName: string, _args: Record<string, unknown>, result: unknown) => ({ toolName, result }),
    locale: () => 'zh-CN' as const,
  }
  return { dependencies, replies, invocations }
}

const applyRequest = {
  id: 1,
  toolName: 'nomi_timeline_edit',
  args: { operation: 'apply' },
  routedMethod: 'timeline.write',
  built: { operation: 'apply', leaseHandle: 'lease-a', plan: { operations: [] } },
} as const

describe('capabilityCore/mcpTimelineConfirmation', () => {
  it('mints planConfirmed only after a human accepts, which is the flag rpcServer requires', async () => {
    const { dependencies, invocations, replies } = harness({ supported: true, confirmed: true, action: 'accept' })

    const handled = await handleTimelineEditConfirmation(applyRequest, dependencies)

    expect(handled).toBe(true)
    expect(invocations).toEqual([{
      method: 'timeline.write',
      params: applyRequest.built,
      options: { planConfirmed: true },
    }])
    expect(replies).toEqual([{ toolName: 'nomi_timeline_edit', result: { ok: true, revision: 'rev-2' } }])
  })

  it('leaves the timeline untouched when the human declines', async () => {
    const { dependencies, invocations, replies } = harness({ supported: true, confirmed: false, action: 'decline' })

    expect(await handleTimelineEditConfirmation(applyRequest, dependencies)).toBe(true)
    expect(invocations).toEqual([])
    expect(replies[0]).toMatchObject({
      isError: true,
      structuredContent: { nomiOutcome: { operation: 'timeline.apply', applied: false, denied: true, reason: 'declined' } },
    })
  })

  it('says who cannot ask, rather than a bare permission error, when the client cannot elicit', async () => {
    // Before this gate existed the same situation produced `Host approval is required before applying
    // a timeline edit` from rpcServer with no way for anyone to supply that approval.
    const { dependencies, invocations, replies } = harness({ supported: false })

    expect(await handleTimelineEditConfirmation(applyRequest, dependencies)).toBe(true)
    expect(invocations).toEqual([])
    expect(replies[0]).toMatchObject({
      structuredContent: { nomiOutcome: { reason: 'client_cannot_confirm' } },
    })
    expect(String((replies[0] as { content: { text: string }[] }).content[0].text)).toContain('没法向你征求确认')
  })

  it('reports a cancelled elicitation as a timeout rather than a decline', async () => {
    const { dependencies, replies } = harness({ supported: true, confirmed: false, action: 'timeout' })

    await handleTimelineEditConfirmation(applyRequest, dependencies)
    expect(replies[0]).toMatchObject({ structuredContent: { nomiOutcome: { reason: 'timeout' } } })
  })

  it('gates undo as well as apply, since both change the timeline', async () => {
    const { dependencies, invocations } = harness({ supported: true, confirmed: true, action: 'accept' })

    const handled = await handleTimelineEditConfirmation({
      ...applyRequest,
      args: { operation: 'undo' },
      built: { operation: 'undo', leaseHandle: 'lease-a', undoToken: 'undo-1' },
    }, dependencies)

    expect(handled).toBe(true)
    expect(invocations[0]?.options).toEqual({ planConfirmed: true })
  })

  it('does not gate preview, and does not gate other tools', async () => {
    const { dependencies, replies, invocations } = harness({ supported: true, confirmed: true, action: 'accept' })

    expect(await handleTimelineEditConfirmation({
      ...applyRequest, args: { operation: 'preview' }, built: { operation: 'preview', leaseHandle: 'lease-a' },
    }, dependencies)).toBe(false)
    expect(await handleTimelineEditConfirmation({
      ...applyRequest, toolName: 'nomi_timeline_read', built: { operation: 'apply' },
    }, dependencies)).toBe(false)
    expect(dependencies.elicitBooleanConfirm).not.toHaveBeenCalled()
    expect(replies).toEqual([])
    expect(invocations).toEqual([])
  })
})
