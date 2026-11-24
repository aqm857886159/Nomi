import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createInternalDocumentReadVerifiedInvocationFactory } from '../capabilityCore/verifiedCapabilityInvocation'
import { createMainCapabilityExecutorRegistry } from '../capabilityCore/capabilityExecutorRegistry'
import { logWarn } from '../logging/logger'
import { MODEL_TOOL_READ_TIMEOUT_MS_VALUE, MODEL_TOOL_WRITE_TIMEOUT_MS_VALUE } from '../shared/agentCapabilities/verbDeclaration'
import type { LaneToolDescriptor } from './laneRuntimePort'
import { createLaneTools, takeLaneToolFailure } from './laneTools.mts'

vi.mock('../logging/logger', () => ({ logWarn: vi.fn() }))

const never = () => new Promise<never>(() => undefined)

function callTool(
  execute: LaneToolDescriptor['execute'],
  signal?: AbortSignal,
  timeoutMs = MODEL_TOOL_READ_TIMEOUT_MS_VALUE,
  effect: LaneToolDescriptor['effect'] = 'read',
) {
  const [tool] = createLaneTools([{
    contractId: 'document.read', name: 'read_script', description: 'Read the script.',
    describe: { does: '', useWhen: '', notWhen: '', params: '' },
    examples: [], nextAction: 'none', effect, schema: z.object({}),
    execution: { timeoutMs }, execute,
  }])
  return tool.execute('call', {}, () => undefined, undefined, {} as never, { ...BACKGROUND_CONTEXT, abortSignal: signal })
}

beforeEach(() => {
  vi.useFakeTimers()
  // Node's native AbortSignal.timeout uses an internal clock outside Vitest's fake timers.
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(new DOMException('Deadline expired', 'TimeoutError')), ms)
    return controller.signal
  })
  vi.mocked(logWarn).mockClear()
})

afterEach(() => {
  takeLaneToolFailure('call')
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('lets the real capability executor report its deadline before the lane safety guard', async () => {
  const invocation = await createInternalDocumentReadVerifiedInvocationFactory({
    verifyBearer: async () => true,
    resolveProjectIdentity: async () => ({
      projectId: 'project-a', immutableProjectUuid: '00000000-0000-4000-8000-000000000041',
      projectGeneration: 1, canonicalRootPath: '/fixture/project-a', canonicalRootDigest: 'fixture',
    }),
    randomId: () => 'document-operation',
  }).mint({ bearer: 'fixture', requestBody: { projectId: 'project-a', documentId: 'doc', scope: 'selection' } })
  const registry = createMainCapabilityExecutorRegistry({
    resolveCanvasReadPort: () => ({ read: never }),
    resolveDocumentReadPort: () => ({ read: never }),
  })
  const result = callTool((_params, { signal }) => registry.execute(invocation, { signal }).then(() => ({
    ok: true, text: 'read completed',
  }))).catch((error: unknown) => error)

  await vi.advanceTimersByTimeAsync(MODEL_TOOL_READ_TIMEOUT_MS_VALUE)
  await expect(result).resolves.toMatchObject({ code: 'capability_timeout' })
  await vi.advanceTimersByTimeAsync(5_000)
  expect(logWarn).not.toHaveBeenCalledWith('agent', 'tool_timed_out', expect.anything())
  expect(takeLaneToolFailure('call')).toBeUndefined()
})

it.each([
  ['read', MODEL_TOOL_READ_TIMEOUT_MS_VALUE],
  ['reversible_local', MODEL_TOOL_WRITE_TIMEOUT_MS_VALUE],
] as const)('arms the %s safety guard only after the capability budget', async (effect, timeoutMs) => {
  const settled = vi.fn()
  const result = callTool(never, undefined, timeoutMs, effect).catch(settled)
  await vi.advanceTimersByTimeAsync(timeoutMs + 4_999)
  expect(settled).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(settled).toHaveBeenCalledOnce()
  expect(takeLaneToolFailure('call')).toEqual({ code: 'tool_timed_out' })
  expect(logWarn).toHaveBeenCalledWith('agent', 'tool_timed_out', {
    toolName: 'read_script', subOperation: 'descriptor.execute', elapsedMs: timeoutMs + 5_000, timeoutMs: timeoutMs + 5_000,
  })
  await result
})

it('stops a still-pending descriptor immediately on user abort and removes the guard listener', async () => {
  const parent = new AbortController()
  const started = vi.fn()
  const settled = vi.fn()
  const result = callTool((_params, { signal }) => {
    started(signal)
    return never()
  }, parent.signal).catch(settled)
  await vi.advanceTimersByTimeAsync(0)
  parent.abort()
  expect(started.mock.calls[0][0].aborted).toBe(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).toHaveBeenCalledWith(parent.signal.reason)
  await vi.advanceTimersByTimeAsync(MODEL_TOOL_READ_TIMEOUT_MS_VALUE + 5_000)
  expect(takeLaneToolFailure('call')).toBeUndefined()
  expect(logWarn).not.toHaveBeenCalled()
  await result
})
