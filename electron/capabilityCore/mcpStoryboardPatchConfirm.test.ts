import { describe, expect, it, vi } from 'vitest'

import { createMcpProtocol, type McpTransport } from './mcpProtocol'

type Frame = {
  id?: unknown
  method?: string
  params?: Record<string, unknown>
  result?: Record<string, unknown>
}

class StoryboardPatchHarness {
  readonly invoke = vi.fn(async () => ({
    applied: true,
    proposalId: 'proposal-canonical-patch',
    operation: 'patch_shots',
    changedShotIndexes: [2],
    changedFields: ['prompt', 'aspectRatio'],
    result: { changed: true },
    reconciliation: { ok: true, deviationCount: 0 },
  }))
  private readonly protocol
  private readonly queued: Frame[] = []
  private readonly waiters: Array<(frame: Frame) => void> = []

  constructor() {
    const transport: McpTransport = {
      send: (message) => {
        const frame = message as Frame
        const waiter = this.waiters.shift()
        if (waiter) waiter(frame)
        else this.queued.push(frame)
      },
      invoke: this.invoke,
      isAppOpen: () => true,
    }
    this.protocol = createMcpProtocol(transport)
  }

  send(frame: Frame & { jsonrpc?: string; method?: string }): void {
    this.protocol.handleIncoming(frame)
  }

  next(): Promise<Frame> {
    const queued = this.queued.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  async initialize(): Promise<void> {
    this.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: { elicitation: {} },
        clientInfo: { name: 'canonical-storyboard-test' },
      },
    })
    await this.next()
  }

  startPatch(): void {
    this.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'nomi_canvas_plan',
        arguments: {
          leaseHandle: 'lease-a',
          projectId: 'project-a',
          operation: 'patch_shots',
          select: { kind: 'indexes', indexes: [2] },
          patch: { promptAppend: '雨天' },
        },
      },
    })
  }
}

describe('canonical nomi_canvas_plan patch_shots approval boundary', () => {
  it('previews through elicitation, then invokes only after explicit approval', async () => {
    const harness = new StoryboardPatchHarness()
    await harness.initialize()
    harness.startPatch()

    const challenge = await harness.next()
    expect(challenge.method).toBe('elicitation/create')
    expect((challenge.params?.message as string)).toContain('storyboard')
    expect(harness.invoke).not.toHaveBeenCalled()

    harness.send({ jsonrpc: '2.0', id: challenge.id, result: { action: 'accept', content: { confirm: true } } })
    const response = await harness.next()
    expect(response.result?.isError).not.toBe(true)
    expect(response.result?.structuredContent).toMatchObject({
      applied: true,
      operation: 'patch_shots',
      changedShotIndexes: [2],
    })
    expect(harness.invoke).toHaveBeenCalledWith('canvas.write', expect.objectContaining({
      projectId: 'project-a',
      operation: 'patch_shots',
      select: { kind: 'indexes', indexes: [2] },
    }), { requestId: '2' })
  })

  it('denies before the production entry and leaves the write uninvoked', async () => {
    const harness = new StoryboardPatchHarness()
    await harness.initialize()
    harness.startPatch()

    const challenge = await harness.next()
    harness.send({ jsonrpc: '2.0', id: challenge.id, result: { action: 'decline' } })
    const response = await harness.next()
    expect(response.result?.isError).toBe(true)
    expect(response.result?.structuredContent).toMatchObject({
      nomiOutcome: { operation: 'patch_shots', applied: false, denied: true, reason: 'declined' },
    })
    expect(harness.invoke).not.toHaveBeenCalled()
  })

  it('returns a fail-closed tool error when the production transport reports a network failure', async () => {
    const harness = new StoryboardPatchHarness()
    await harness.initialize()
    harness.invoke.mockRejectedValueOnce(new Error('ECONNRESET'))
    harness.startPatch()

    const challenge = await harness.next()
    harness.send({ jsonrpc: '2.0', id: challenge.id, result: { action: 'accept', content: { confirm: true } } })
    const response = await harness.next()
    expect(response.result?.isError).toBe(true)
    expect(response.result?.structuredContent).toMatchObject({ nomiOutcome: { kind: 'error', tool: 'nomi_canvas_plan', message: 'ECONNRESET' } })
    expect(harness.invoke).toHaveBeenCalledTimes(1)
  })
})
