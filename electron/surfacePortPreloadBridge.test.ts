import { describe, expect, it, vi } from 'vitest'

import { createCanvasReadSurfacePreloadBridge } from './surfacePortPreloadBridge'

describe('Surface preload bridge', () => {
  it('uses only the four independent Surface channels and unwraps typed values', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel.endsWith('suspend')) return { ok: true, value: { suspension: { version: 1 } } }
      if (channel.endsWith('commitCanvasRead')) return { ok: true, value: { binding: { version: 1 } } }
      if (channel.endsWith('captureCanvasReadSnapshot')) {
        return { ok: true, value: { handle: { version: 1, handleId: 'handle-1', nonce: 'nonce-1' } } }
      }
      return { ok: true, value: { released: true } }
    })
    const bridge = createCanvasReadSurfacePreloadBridge(invoke)

    await expect(bridge.suspend({ surfaceInstanceId: 'surface-1' })).resolves.toEqual({ suspension: { version: 1 } })
    await expect(bridge.commitCanvasRead({ projectId: 'project-a', suspension: { version: 1 } as never }))
      .resolves.toEqual({ binding: { version: 1 } })
    await expect(bridge.captureCanvasReadSnapshot({
      binding: { version: 1 } as never,
      snapshot: { nodes: [], edges: [], groups: [], selectedNodeIds: [] },
    })).resolves.toEqual({ handle: { version: 1, handleId: 'handle-1', nonce: 'nonce-1' } })
    await expect(bridge.release({ authority: { version: 1 } as never })).resolves.toEqual({ released: true })
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'nomi:surface:suspend',
      'nomi:surface:commitCanvasRead',
      'nomi:surface:captureCanvasReadSnapshot',
      'nomi:surface:release',
    ])
  })

  it('keeps the renderer-facing suspension and nested binding immutable', async () => {
    const suspension = {
      version: 1 as const,
      suspensionId: 'suspension-1',
      surfaceInstanceId: 'surface-1',
      portRevision: 1,
      nonce: 'suspension-nonce',
    }
    const binding = {
      version: 1 as const,
      bindingId: 'binding-1',
      binding: {
        projectId: 'project-a',
        immutableProjectUuid: '00000000-0000-4000-8000-000000000001',
        projectGeneration: 1,
      },
      webContentsId: 1,
      processId: 2,
      frameRoutingId: 3,
      origin: 'file://',
      surfaceInstanceId: 'surface-1',
      portRevision: 1,
      nonce: 'binding-nonce',
    }
    const bridge = createCanvasReadSurfacePreloadBridge(vi.fn(async (channel: string) => (
      channel.endsWith('suspend')
        ? { ok: true, value: { suspension } }
        : { ok: true, value: { binding } }
    )))

    const suspended = await bridge.suspend({ surfaceInstanceId: 'surface-1' })
    const committed = await bridge.commitCanvasRead({ projectId: 'project-a', suspension })

    expect(Object.isFrozen(suspended)).toBe(true)
    expect(Object.isFrozen(suspended.suspension)).toBe(true)
    expect(Object.isFrozen(committed)).toBe(true)
    expect(Object.isFrozen(committed.binding)).toBe(true)
    expect(Object.isFrozen(committed.binding.binding)).toBe(true)
  })

  it('reconstructs a typed Surface error instead of depending on Electron Error serialization', async () => {
    const bridge = createCanvasReadSurfacePreloadBridge(vi.fn(async () => ({
      ok: false,
      error: { code: 'surface_port_stale' },
    })))

    await expect(bridge.suspend({ surfaceInstanceId: 'surface-1' })).rejects.toMatchObject({
      name: 'SurfacePortWireError',
      code: 'surface_port_stale',
    })
  })

  it('serves the dedicated read-only Surface channel and echoes the exact request binding', async () => {
    let receive: ((payload: unknown) => void) | undefined
    const send = vi.fn()
    const unsubscribe = vi.fn()
    const bridge = createCanvasReadSurfacePreloadBridge(
      vi.fn(async () => ({ ok: true, value: { released: true } })),
      {
        subscribe: vi.fn((_channel, listener) => {
          receive = listener
          return unsubscribe
        }),
        send,
      },
    )
    const binding = {
      version: 1 as const,
      bindingId: 'binding-1',
      binding: {
        projectId: 'project-a',
        immutableProjectUuid: '00000000-0000-4000-8000-000000000001',
        projectGeneration: 1,
      },
      webContentsId: 1,
      processId: 2,
      frameRoutingId: 3,
      origin: 'file://',
      surfaceInstanceId: 'surface-1',
      portRevision: 1,
      nonce: 'nonce-1',
    }
    const stop = bridge.onCanvasRead(async ({ binding: receivedBinding }) => ({
      selectedNodeIds: [],
      bindingWasExact: receivedBinding === binding,
    }))

    receive?.({ requestId: 'request-1', binding })
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('nomi:surface:canvasRead:reply', {
      requestId: 'request-1',
      binding,
      result: { selectedNodeIds: [], bindingWasExact: true },
    }))
    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('never sends a raw renderer cause on the read-only reply channel', async () => {
    let receive: ((payload: unknown) => void) | undefined
    const send = vi.fn()
    const bridge = createCanvasReadSurfacePreloadBridge(
      vi.fn(async () => ({ ok: true, value: { released: true } })),
      {
        subscribe: (_channel, listener) => {
          receive = listener
          return () => undefined
        },
        send,
      },
    )
    bridge.onCanvasRead(async () => {
      throw new Error('/private/project/provider-token')
    })

    receive?.({ requestId: 'request-2', binding: { version: 1 } })
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('nomi:surface:canvasRead:reply', {
      requestId: 'request-2',
      binding: { version: 1 },
      error: { code: 'surface_port_unavailable' },
    }))
    expect(JSON.stringify(send.mock.calls)).not.toContain('private')
  })

  it('keeps Canvas write evidence capture and execution on strict independent channels', async () => {
    const receivers = new Map<string, (payload: unknown) => void>()
    const send = vi.fn()
    const bridge = createCanvasReadSurfacePreloadBridge(
      vi.fn(async () => ({ ok: true, value: { released: true } })),
      {
        subscribe: (channel, listener) => {
          receivers.set(channel, listener)
          return () => receivers.delete(channel)
        },
        send,
      },
    )
    const binding = { version: 1, bindingId: 'binding-a' } as never
    const capture = vi.fn(() => ({ node: { id: 'node-real' }, groups: [] }))
    const execute = vi.fn(() => ({ applied: true, proposalId: 'receipt-a' }))
    bridge.onCanvasWriteCapture(capture)
    bridge.onCanvasWriteExecute(execute)

    receivers.get('nomi:surface:canvasWrite:capture:request')?.({
      requestId: 'capture-a', binding, operation: 'set_node_prompt', nodeId: 'node-alias',
    })
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('nomi:surface:canvasWrite:capture:reply', {
      requestId: 'capture-a', binding, result: { node: { id: 'node-real' }, groups: [] },
    }))
    expect(capture).toHaveBeenCalledWith({ binding, operation: 'set_node_prompt', nodeId: 'node-alias' })

    receivers.get('nomi:surface:canvasWrite:execute:request')?.({
      requestId: 'execute-a', binding,
      input: { operation: 'set_node_prompt', nodeId: 'node-alias', prompt: 'new prompt' },
      target: { kind: 'canvas', nodeIds: ['node-real'] },
      preconditions: { nodes: [{ nodeId: 'node-real', contentHash: 'hash-a' }] },
      receiptProposalId: 'receipt-a', approvalId: 'approval-a', actionHash: 'action-a',
    })
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('nomi:surface:canvasWrite:execute:reply', {
      requestId: 'execute-a', binding, result: { applied: true, proposalId: 'receipt-a' },
    }))
    expect(execute).toHaveBeenCalledWith({
      binding,
      input: { operation: 'set_node_prompt', nodeId: 'node-alias', prompt: 'new prompt' },
      target: { kind: 'canvas', nodeIds: ['node-real'] },
      preconditions: { nodes: [{ nodeId: 'node-real', contentHash: 'hash-a' }] },
      receiptProposalId: 'receipt-a', approvalId: 'approval-a', actionHash: 'action-a',
      signal: expect.any(AbortSignal),
    })

    receivers.get('nomi:surface:canvasWrite:capture:request')?.({
      requestId: 'malformed', binding, operation: 'delete_canvas_nodes', nodeId: 'node-real',
    })
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('validates Timeline requests and preserves exact Host approval evidence in replies', async () => {
    const receivers = new Map<string, (payload: unknown) => void>()
    const send = vi.fn()
    const bridge = createCanvasReadSurfacePreloadBridge(
      vi.fn(async () => ({ ok: true, value: { released: true } })),
      {
        subscribe: (channel, listener) => {
          receivers.set(channel, listener)
          return () => receivers.delete(channel)
        },
        send,
      },
    )
    const binding = { version: 1, bindingId: 'binding-a' } as never
    const target = { kind: 'timeline', clipIds: ['clip-a'] }
    const preconditions = { timeline: { revision: 'revision-a' } }
    const read = vi.fn(() => ({ operation: 'read_timeline', revision: 'revision-a' }))
    const write = vi.fn(() => ({ operation: 'undo_timeline_edit', ok: true, undone: true }))
    bridge.onTimelineRead(read)
    bridge.onTimelineWrite(write)

    receivers.get('nomi:surface:timelineRead:request')?.({
      requestId: 'read-a', binding, input: { operation: 'read_timeline' }, target, preconditions,
    })
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('nomi:surface:timelineRead:reply', {
      requestId: 'read-a', binding, result: { operation: 'read_timeline', revision: 'revision-a' },
    }))
    expect(read).toHaveBeenCalledWith({ binding, input: { operation: 'read_timeline' }, target, preconditions })

    const input = {
      operation: 'undo_timeline_edit',
      undoToken: 'timeline-undo:v1:receipt-a',
      expectedRevision: 'revision-a',
    }
    receivers.get('nomi:surface:timelineWrite:request')?.({
      requestId: 'write-a', binding, input, target, preconditions,
      receiptProposalId: 'receipt-a', approvalId: 'approval-a', actionHash: 'action-a',
    })
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('nomi:surface:timelineWrite:reply', {
      requestId: 'write-a', binding,
      result: { operation: 'undo_timeline_edit', ok: true, undone: true },
    }))
    expect(write).toHaveBeenCalledWith({
      binding, input, target, preconditions,
      receiptProposalId: 'receipt-a', approvalId: 'approval-a', actionHash: 'action-a',
      signal: expect.any(AbortSignal),
    })

    receivers.get('nomi:surface:timelineWrite:request')?.({
      requestId: 'malformed', binding, input, target, preconditions,
      receiptProposalId: 'receipt-a', approvalId: '', actionHash: 'action-a',
    })
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('aborts only the exact request and Surface authority, then returns a typed cancellation', async () => {
    const receivers = new Map<string, (payload: unknown) => void>()
    const send = vi.fn()
    const bridge = createCanvasReadSurfacePreloadBridge(
      vi.fn(async () => ({ ok: true, value: { released: true } })),
      {
        subscribe: (channel, listener) => {
          receivers.set(channel, listener)
          return () => receivers.delete(channel)
        },
        send,
      },
    )
    const binding = {
      version: 1 as const,
      bindingId: 'binding-a',
      binding: {
        projectId: 'project-a',
        immutableProjectUuid: '00000000-0000-4000-8000-000000000001',
        projectGeneration: 1,
      },
      webContentsId: 1,
      processId: 2,
      frameRoutingId: 3,
      origin: 'file://',
      surfaceInstanceId: 'surface-a',
      portRevision: 4,
      nonce: 'nonce-a',
    }
    let signal: AbortSignal | undefined
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    bridge.onCanvasWriteExecute((request) => {
      signal = request.signal
      return pending
    })
    receivers.get('nomi:surface:canvasWrite:execute:request')?.({
      requestId: 'execute-a',
      binding,
      input: { operation: 'set_node_prompt', nodeId: 'node-a', prompt: 'new' },
      target: { kind: 'canvas', nodeIds: ['node-a'] },
      preconditions: {},
      receiptProposalId: 'receipt-a',
      approvalId: 'approval-a',
      actionHash: 'action-a',
    })
    expect(signal?.aborted).toBe(false)

    receivers.get('nomi:surface:request:cancel')?.({
      requestId: 'execute-a',
      binding: { ...structuredClone(binding), nonce: 'forged' },
    })
    receivers.get('nomi:surface:request:cancel')?.({ requestId: 'other-request', binding })
    receivers.get('nomi:surface:request:cancel')?.({ requestId: 'execute-a', binding: {} })
    expect(signal?.aborted).toBe(false)

    receivers.get('nomi:surface:request:cancel')?.({
      requestId: 'execute-a',
      binding: structuredClone(binding),
    })
    expect(signal?.aborted).toBe(true)
    finish()
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('nomi:surface:canvasWrite:execute:reply', {
      requestId: 'execute-a',
      binding,
      error: { code: 'capability_cancelled' },
    }))
  })
})
