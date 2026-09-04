import { describe, expect, it, vi } from 'vitest'

import { executeProductionApproval } from './projectAgentApprovalHelpers'

describe('canonical storyboard approval decision', () => {
  it('does not persist or execute when the user denies nomi_canvas_plan patch_shots', async () => {
    const execute = vi.fn()
    const persist = vi.fn()
    const remember = vi.fn((code: string | undefined, fallback: string, denied?: boolean) => ({
      ok: false as const,
      code: code ?? fallback,
      denied,
    }))
    const call = {
      toolCallId: 'tool-patch-denied',
      toolName: 'nomi_canvas_plan',
      args: {
        operation: 'patch_shots',
        select: { kind: 'indexes', indexes: [2] },
        patch: { promptAppend: '雨天' },
      },
    }

    const result = await executeProductionApproval({
      adapter: {
        async prepare(preparedCall) {
          expect(preparedCall.toolName).toBe('nomi_canvas_plan')
          expect(preparedCall.args).toEqual(call.args)
          return { invocation: 'captured-canonical-patch' }
        },
        async execute() {
          execute()
          return { ok: true as const }
        },
      },
      call,
      signal: new AbortController().signal,
      awaitDecision: async () => ({ ok: false as const, denied: true, code: 'user_denied' }),
      persist,
      remember,
      settle: vi.fn(),
    })

    expect(result).toEqual({ ok: false, code: 'user_denied', denied: true })
    expect(persist).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(remember).toHaveBeenCalledWith('user_denied', 'capability_target_stale', true)
  })
})
