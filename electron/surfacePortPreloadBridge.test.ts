import { describe, expect, it, vi } from 'vitest'

import { settleSurfacePortHandler, type SurfacePortHandlerResult } from './shared/surfacePortBinding'

function wireHandler<T>(handler: (request: T) => unknown): (request: T) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult> {
  return (request) => settleSurfacePortHandler(() => handler(request))
}

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
    const stop = bridge.onCanvasRead(wireHandler(async ({ binding: receivedBinding }) => ({
      selectedNodeIds: [],
      bindingWasExact: receivedBinding === binding,
    })))

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
    bridge.onCanvasRead(wireHandler(async () => {
      throw new Error('/private/project/provider-token')
    }))

    receive?.({ requestId: 'request-2', binding: { version: 1 } })
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('nomi:surface:canvasRead:reply', {
      requestId: 'request-2',
      binding: { version: 1 },
      error: { code: 'capability_execution_failed' },
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
    bridge.onCanvasWriteCapture(wireHandler(capture))
    bridge.onCanvasWriteExecute(wireHandler(execute))

    receivers.get('nomi:surface:canvasWrite:capture:request')?.({
      requestId: 'capture-a', binding, operation: 'set_node_prompt', nodeId: 'node-alias',
    })
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('nomi:surface:canvasWrite:capture:reply', {
      requestId: 'capture-a', binding, result: { node: { id: 'node-real' }, groups: [] },
    }))
    expect(capture).toHaveBeenCalledWith({ binding, operation: 'set_node_prompt', nodeId: 'node-alias' })

    receivers.get('nomi:surface:canvasWrite:capture:request')?.({
      requestId: 'capture-patch', binding, operation: 'patch_shots',
      input: { operation: 'patch_shots', select: { kind: 'indexes', indexes: [2] }, patch: { promptAppend: '雨天' } },
    })
    await vi.waitFor(() => expect(capture).toHaveBeenCalledWith({
      binding,
      operation: 'patch_shots',
      input: { operation: 'patch_shots', select: { kind: 'indexes', indexes: [2] }, patch: { promptAppend: '雨天' } },
    }))

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
    expect(capture).toHaveBeenCalledTimes(2)
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
    bridge.onTimelineRead(wireHandler(read))
    bridge.onTimelineWrite(wireHandler(write))

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
    bridge.onCanvasWriteExecute(wireHandler((request) => {
      signal = request.signal
      return pending
    }))
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

it.each([
  ['onCanvasRead', 'canvasRead', {}],
  ['onDocumentRead', 'documentRead', { documentId: 'doc', scope: 'full' }],
  ['onDocumentWrite', 'documentWrite', { documentId: 'doc', operation: 'append', content: 'text' }],
  ['onCanvasWriteCapture', 'canvasWrite:capture', { operation: 'set_node_prompt', nodeId: 'node' }],
  ['onCanvasWriteExecute', 'canvasWrite:execute', { input: {} }],
  ['onTimelineRead', 'timelineRead', { input: { operation: 'read_timeline' } }],
  ['onTimelineWrite', 'timelineWrite', { input: { operation: 'undo_timeline_edit', undoToken: 'undo', expectedRevision: 'rev' } }],
  ['onAssetRead', 'assetRead', { input: { operation: 'get_media', assetId: 'asset' } }],
  ['onExportRead', 'exportRead', { input: { operation: 'inspect_export_job', jobId: 'job' } }],
  ['onExportWrite', 'exportWrite', { input: { operation: 'cancel_export_job', jobId: 'job' } }],
] as const)('%s accepts only structured renderer callback replies', async (method, channel, fields) => {
  const receivers = new Map<string, (payload: unknown) => void>()
  const send = vi.fn()
  const bridge = createCanvasReadSurfacePreloadBridge(vi.fn(), {
    subscribe(name, callback) { receivers.set(name, callback); return () => receivers.delete(name) },
    send,
  })
  let reply: unknown = JSON.parse(JSON.stringify({
    ok: false, error: { code: 'capability_execution_failed', reason: 'no-disk-space', raw: '/private/token' },
  }))
  // Deliberately bypass TypeScript to exercise rejection of a malformed renderer.
  const register = bridge[method] as (handler: () => SurfacePortHandlerResult) => () => void
  register(() => reply as SurfacePortHandlerResult)
  const binding = { version: 1 }
  const request = { requestId: 'request', binding, target: {}, preconditions: {},
    receiptProposalId: 'receipt', approvalId: 'approval', actionHash: 'hash', ...fields }
  receivers.get(`nomi:surface:${channel}:request`)?.(request)
  await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith(`nomi:surface:${channel}:reply`, {
    requestId: 'request', binding,
    error: { code: 'capability_execution_failed', reason: 'no-disk-space' },
  }))
  reply = { applied: true }
  receivers.get(`nomi:surface:${channel}:request`)?.(request)
  await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith(`nomi:surface:${channel}:reply`, {
    requestId: 'request', binding, error: { code: 'surface_port_unavailable' },
  }))
})

it('delivers an asset read cancellation only to the matching renderer request', async () => {
  const receivers = new Map<string, (payload: unknown) => void>()
  const send = vi.fn()
  const bridge = createCanvasReadSurfacePreloadBridge(vi.fn(), {
    subscribe(name, callback) { receivers.set(name, callback); return () => receivers.delete(name) },
    send,
  })
  const binding = {
    version: 1, bindingId: 'binding-a',
    binding: { projectId: 'project-a', immutableProjectUuid: '00000000-0000-4000-8000-000000000001', projectGeneration: 1 },
    webContentsId: 1, processId: 2, frameRoutingId: 3, origin: 'file://',
    surfaceInstanceId: 'surface-a', portRevision: 4, nonce: 'nonce-a',
  }
  const controller = new AbortController()
  const readWasCancelled = vi.fn()
  controller.signal.addEventListener('abort', readWasCancelled, { once: true })
  let finish!: () => void
  bridge.onAssetRead(wireHandler(async (request: { onCancel: (cancel: () => void) => () => void }) => {
    const unsubscribe = request.onCancel(() => controller.abort())
    try {
      await new Promise<void>((resolve) => { finish = resolve })
      return { operation: 'get_media' }
    } finally {
      unsubscribe()
    }
  }))
  receivers.get('nomi:surface:assetRead:request')?.({
    requestId: 'asset-read-a', binding, input: { operation: 'get_media', assetId: 'asset-a' },
    target: {}, preconditions: {},
  })
  const cancelChannel = 'nomi:surface:request:cancel'
  const cancel = receivers.get(cancelChannel)!
  cancel({ requestId: 'other', binding })
  expect(readWasCancelled).not.toHaveBeenCalled()
  cancel({ requestId: 'asset-read-a', binding: { ...binding, bindingId: 'other' } })
  expect(readWasCancelled).not.toHaveBeenCalled()
  cancel({ requestId: 'asset-read-a', binding })
  expect(readWasCancelled).toHaveBeenCalledOnce()
  finish()
  await vi.waitFor(() => expect(send).toHaveBeenCalledWith('nomi:surface:assetRead:reply', {
    requestId: 'asset-read-a', binding, error: { code: 'capability_cancelled' },
  }))
  expect(receivers.has(cancelChannel)).toBe(false)
})
