import { describe, expect, it, vi } from 'vitest'

import {
  ProjectHydrationSupersededError,
  captureCurrentProjectCanvasReadSurfaceBinding,
  createProjectCanvasReadSurfaceCoordinator,
  registerProjectCanvasReadSurface,
  registerProjectCanvasReadSurfaceCoordinator,
  sealCurrentProjectCanvasReadSnapshot,
} from './projectCanvasReadSurface'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function suspension(id: string) {
  return {
    version: 1 as const,
    suspensionId: `suspension-${id}`,
    surfaceInstanceId: 'surface-document-1',
    portRevision: Number(id),
    nonce: `suspension-nonce-${id}`,
  }
}

function binding(id: string, projectId = 'project-a') {
  return {
    version: 1 as const,
    bindingId: `binding-${id}`,
    binding: {
      projectId,
      immutableProjectUuid: `uuid-${projectId}`,
      projectGeneration: 1,
    },
    webContentsId: 1,
    processId: 2,
    frameRoutingId: 3,
    origin: 'file://',
    surfaceInstanceId: 'surface-document-1',
    portRevision: Number(id),
    nonce: `binding-nonce-${id}`,
  }
}

function harness() {
  let suspensionId = 0
  let readHandler: ((request: { binding: ReturnType<typeof binding> }) => unknown | Promise<unknown>) | undefined
  let documentReadHandler:
    | ((request: {
        binding: ReturnType<typeof binding>
        documentId: string
        scope: 'full' | 'selection'
      }) => unknown | Promise<unknown>)
    | undefined
  type DocumentWriteHandler = (request: {
    binding: ReturnType<typeof binding>
    documentId: string
    operation: 'insert' | 'replace' | 'append'
    content: string
    target: unknown
    preconditions: unknown
    signal: AbortSignal
  }) => unknown | Promise<unknown>
  let canvasWriteCaptureHandler:
    | ((request: {
        binding: ReturnType<typeof binding>
        operation: 'set_node_prompt'
        nodeId: string
      }) => unknown | Promise<unknown>)
    | undefined
  let canvasWriteExecuteHandler:
    | ((request: {
        binding: ReturnType<typeof binding>
        input: unknown
        target: unknown
        preconditions: unknown
        receiptProposalId: string
        approvalId: string
        actionHash: string
        signal: AbortSignal
      }) => unknown | Promise<unknown>)
    | undefined
  let timelineReadHandler:
    | ((request: {
        binding: ReturnType<typeof binding>
        input: { operation: 'read_timeline' }
        target: unknown
        preconditions: unknown
      }) => unknown | Promise<unknown>)
    | undefined
  let timelineWriteHandler:
    | ((request: {
        binding: ReturnType<typeof binding>
        input: { operation: 'undo_timeline_edit'; undoToken: string; expectedRevision: string }
        target: unknown
        preconditions: unknown
        receiptProposalId: string
        approvalId: string
        actionHash: string
        signal: AbortSignal
      }) => unknown | Promise<unknown>)
    | undefined
  const bridge = {
    suspend: vi.fn(async () => ({ suspension: suspension(String(++suspensionId)) })),
    commitCanvasRead: vi.fn(async (input: { projectId: string }) => ({
      binding: binding(String(suspensionId), input.projectId),
    })),
    captureCanvasReadSnapshot: vi.fn(async () => ({
      handle: { version: 1 as const, handleId: 'captured-a', nonce: 'captured-nonce-a' },
    })),
    release: vi.fn(async () => ({ released: true as const })),
    onCanvasRead: vi.fn((handler: typeof readHandler) => {
      readHandler = handler
      return () => {
        readHandler = undefined
      }
    }),
    onDocumentRead: vi.fn((handler: typeof documentReadHandler) => {
      documentReadHandler = handler
      return () => {
        documentReadHandler = undefined
      }
    }),
    onDocumentWrite: vi.fn((_handler: DocumentWriteHandler) => () => undefined),
    onCanvasWriteCapture: vi.fn((handler: typeof canvasWriteCaptureHandler) => {
      canvasWriteCaptureHandler = handler
      return () => {
        canvasWriteCaptureHandler = undefined
      }
    }),
    onCanvasWriteExecute: vi.fn((handler: typeof canvasWriteExecuteHandler) => {
      canvasWriteExecuteHandler = handler
      return () => {
        canvasWriteExecuteHandler = undefined
      }
    }),
    onTimelineRead: vi.fn((handler: typeof timelineReadHandler) => {
      timelineReadHandler = handler
      return () => {
        timelineReadHandler = undefined
      }
    }),
    onTimelineWrite: vi.fn((handler: typeof timelineWriteHandler) => {
      timelineWriteHandler = handler
      return () => {
        timelineWriteHandler = undefined
      }
    }),
    // Asset/export surfaces are not exercised by these canvas-read cases, but the
    // bridge contract now requires them; register inert subscriptions.
    onAssetRead: vi.fn(() => () => {}),
    onExportRead: vi.fn(() => () => {}),
    onExportWrite: vi.fn(() => () => {}),
  }
  const coordinator = createProjectCanvasReadSurfaceCoordinator({
    getSurfaceBridge: () => bridge,
    createSurfaceInstanceId: () => 'surface-document-1',
  })
  return {
    coordinator,
    bridge,
    read: (request: { binding: ReturnType<typeof binding> }) => readHandler?.(request),
    readDocument: (request: { binding: ReturnType<typeof binding>; documentId: string; scope: 'full' | 'selection' }) =>
      documentReadHandler?.(request),
    captureCanvasWrite: (request: Parameters<NonNullable<typeof canvasWriteCaptureHandler>>[0]) =>
      canvasWriteCaptureHandler?.(request),
    executeCanvasWrite: (request: Parameters<NonNullable<typeof canvasWriteExecuteHandler>>[0]) =>
      canvasWriteExecuteHandler?.(request),
    readTimeline: (request: Parameters<NonNullable<typeof timelineReadHandler>>[0]) =>
      timelineReadHandler?.(request),
    writeTimeline: (request: Parameters<NonNullable<typeof timelineWriteHandler>>[0]) =>
      timelineWriteHandler?.(request),
  }
}

describe('project canvas-read Surface hydration coordinator', () => {
  it('starts main suspend synchronously before returning the hydration epoch', async () => {
    const test = harness()
    const epoch = test.coordinator.beginHydration()

    expect(test.bridge.suspend).toHaveBeenCalledWith({ surfaceInstanceId: 'surface-document-1' })
    await expect(epoch.waitUntilSuspended()).resolves.toBeUndefined()
    expect(epoch.signal.aborted).toBe(false)
  })

  it('aborts an older hydration and rejects its delayed suspend reply before any read can start', async () => {
    const test = harness()
    const oldReply = deferred<{ suspension: ReturnType<typeof suspension> }>()
    test.bridge.suspend.mockImplementationOnce(() => oldReply.promise)
    const old = test.coordinator.beginHydration()
    const current = test.coordinator.beginHydration()
    oldReply.resolve({ suspension: suspension('99') })

    await expect(old.waitUntilSuspended()).rejects.toBeInstanceOf(ProjectHydrationSupersededError)
    expect(old.signal.aborted).toBe(true)
    await expect(current.waitUntilSuspended()).resolves.toBeUndefined()
    expect(current.signal.aborted).toBe(false)
  })

  it('normalizes a stale main rejection to superseded after a newer hydration wins', async () => {
    const test = harness()
    const lateCommit = deferred<{ binding: ReturnType<typeof binding> }>()
    test.bridge.commitCanvasRead.mockImplementationOnce(() => lateCommit.promise)
    const stale = test.coordinator.beginHydration()
    await stale.waitUntilSuspended()
    const committing = stale.commitCanvasRead('project-a')
    const rejected = expect(committing).rejects.toBeInstanceOf(ProjectHydrationSupersededError)
    await vi.waitFor(() => expect(test.bridge.commitCanvasRead).toHaveBeenCalledOnce())
    const current = test.coordinator.beginHydration()
    lateCommit.reject(new Error('surface_port_stale'))

    await rejected
    await expect(current.waitUntilSuspended()).resolves.toBeUndefined()
  })

  it('publishes a binding only for the current epoch after the caller finishes restore and active publish', async () => {
    const test = harness()
    const epoch = test.coordinator.beginHydration()
    await epoch.waitUntilSuspended()
    expect(test.coordinator.getCurrentBinding()).toBeNull()

    const committed = await epoch.commitCanvasRead('project-a')

    expect(committed).not.toBeNull()
    if (!committed) throw new Error('current hydration did not publish a binding')
    expect(committed.binding.projectId).toBe('project-a')
    expect(test.coordinator.getCurrentBinding()).toEqual(committed)
  })

  it('keeps failed hydration suspended and rotates even when reopening the same project id', async () => {
    const test = harness()
    const failed = test.coordinator.beginHydration()
    await failed.waitUntilSuspended()
    expect(test.bridge.commitCanvasRead).not.toHaveBeenCalled()

    const reload = test.coordinator.beginHydration()
    await reload.waitUntilSuspended()
    expect(failed.signal.aborted).toBe(true)
    expect(test.bridge.suspend).toHaveBeenCalledTimes(2)
    await reload.commitCanvasRead('project-a')
  })

  it('releases only the current suspension or binding and makes stale epochs unable to clear a newer one', async () => {
    const test = harness()
    const stale = test.coordinator.beginHydration()
    await stale.waitUntilSuspended()
    const current = test.coordinator.beginHydration()
    await current.waitUntilSuspended()

    await expect(stale.release()).rejects.toBeInstanceOf(ProjectHydrationSupersededError)
    expect(test.bridge.release).not.toHaveBeenCalled()
    await current.commitCanvasRead('project-b')
    await current.release()
    expect(test.bridge.release).toHaveBeenCalledWith({ authority: binding('2', 'project-b') })
    expect(test.coordinator.getCurrentBinding()).toBeNull()
  })

  it('keeps the current authority retryable until main acknowledges release', async () => {
    const test = harness()
    const epoch = test.coordinator.beginHydration()
    await epoch.waitUntilSuspended()
    const committed = await epoch.commitCanvasRead('project-a')
    let mainAlreadyReleased = false
    test.bridge.release
      .mockImplementationOnce(async () => {
        // Main performed the side effect, but Electron lost the ACK.
        mainAlreadyReleased = true
        throw new Error('main release failed')
      })
      .mockImplementationOnce(async () => {
        expect(mainAlreadyReleased).toBe(true)
        return { released: true as const }
      })

    await expect(test.coordinator.releaseCurrent()).rejects.toThrow('main release failed')
    expect(epoch.signal.aborted).toBe(false)
    expect(test.coordinator.getCurrentBinding()).toEqual(committed)

    await expect(test.coordinator.releaseCurrent()).resolves.toBeUndefined()
    expect(test.coordinator.getCurrentBinding()).toBeNull()
  })

  it('uses a fail-closed no-port epoch in browser mode without blocking ordinary project hydration', async () => {
    const coordinator = createProjectCanvasReadSurfaceCoordinator({
      getSurfaceBridge: () => null,
      createSurfaceInstanceId: () => 'browser-surface',
    })
    const epoch = coordinator.beginHydration()

    await expect(epoch.waitUntilSuspended()).resolves.toBeUndefined()
    await expect(epoch.commitCanvasRead('project-a')).resolves.toBeNull()
    expect(coordinator.getCurrentBinding()).toBeNull()
  })

  it('serves a live snapshot only for the coordinator current binding without copying project truth', async () => {
    const test = harness()
    const readSnapshot = vi.fn(() => ({ nodes: [{ id: 'live-node' }] }))
    const unsubscribe = test.coordinator.registerCanvasReadSource(readSnapshot)
    const epoch = test.coordinator.beginHydration()
    await epoch.waitUntilSuspended()
    const committed = await epoch.commitCanvasRead('project-a')

    expect(test.read({ binding: structuredClone(committed!) })).toEqual({ nodes: [{ id: 'live-node' }] })
    expect(readSnapshot).toHaveBeenCalledOnce()
    expect(() =>
      test.read({
        binding: { ...structuredClone(committed!), nonce: 'forged' },
      }),
    ).toThrow(expect.objectContaining({ code: 'surface_port_stale' }))

    test.coordinator.beginHydration()
    expect(() => test.read({ binding: structuredClone(committed!) })).toThrow(
      expect.objectContaining({ code: 'surface_port_suspended' }),
    )
    unsubscribe()
  })

  it('shares only the exact coordinator pointer when chat submission captures the opaque binding', async () => {
    const test = harness()
    const unregister = registerProjectCanvasReadSurfaceCoordinator(test.coordinator)
    const epoch = test.coordinator.beginHydration()
    await epoch.waitUntilSuspended()
    expect(captureCurrentProjectCanvasReadSurfaceBinding()).toBeNull()
    const committed = await epoch.commitCanvasRead('project-a')

    expect(captureCurrentProjectCanvasReadSurfaceBinding()).toBe(committed)
    unregister()
    expect(captureCurrentProjectCanvasReadSurfaceBinding()).toBeNull()
  })

  it('seals the exact submitted binding and snapshot synchronously without rechecking a later Surface', async () => {
    const test = harness()
    const unregister = registerProjectCanvasReadSurfaceCoordinator(test.coordinator)
    const epoch = test.coordinator.beginHydration()
    await epoch.waitUntilSuspended()
    const committed = await epoch.commitCanvasRead('project-a')
    const snapshot = { nodes: [], edges: [], groups: [], selectedNodeIds: [] }

    const sealed = sealCurrentProjectCanvasReadSnapshot(committed!, snapshot)
    expect(test.bridge.captureCanvasReadSnapshot).toHaveBeenCalledWith({ binding: committed, snapshot })
    test.coordinator.beginHydration()

    await expect(sealed).resolves.toEqual({ version: 1, handleId: 'captured-a', nonce: 'captured-nonce-a' })
    await expect(sealCurrentProjectCanvasReadSnapshot(committed!, snapshot)).rejects.toMatchObject({
      code: 'surface_port_suspended',
    })
    unregister()
  })

  it('registers and tears down the exact coordinator and its read source as one lifecycle', async () => {
    const test = harness()
    const readSnapshot = vi.fn(() => ({ nodes: [{ id: 'live-node' }] }))
    const readDocument = vi.fn(({ scope }: { documentId: string; scope: 'full' | 'selection' }) => ({
      text: scope === 'full' ? 'full draft' : 'selected text',
    }))
    const unregister = registerProjectCanvasReadSurface(test.coordinator, readSnapshot, readDocument)
    const epoch = test.coordinator.beginHydration()
    await epoch.waitUntilSuspended()
    const committed = await epoch.commitCanvasRead('project-a')

    expect(captureCurrentProjectCanvasReadSurfaceBinding()).toBe(committed)
    expect(test.read({ binding: committed! })).toEqual({ nodes: [{ id: 'live-node' }] })
    expect(
      test.readDocument({
        binding: structuredClone(committed!),
        documentId: 'document-a',
        scope: 'selection',
      }),
    ).toEqual({ text: 'selected text' })
    expect(readDocument).toHaveBeenCalledWith({ documentId: 'document-a', scope: 'selection' })
    expect(() =>
      test.readDocument({
        binding: { ...structuredClone(committed!), nonce: 'forged' },
        documentId: 'document-a',
        scope: 'full',
      }),
    ).toThrow(expect.objectContaining({ code: 'surface_port_stale' }))

    unregister()
    expect(captureCurrentProjectCanvasReadSurfaceBinding()).toBeNull()
    expect(test.read({ binding: committed! })).toBeUndefined()
    expect(
      test.readDocument({
        binding: committed!,
        documentId: 'document-a',
        scope: 'full',
      }),
    ).toBeUndefined()
  })

  it('suspends document reads immediately when the active project rotates', async () => {
    const test = harness()
    const unregister = registerProjectCanvasReadSurface(
      test.coordinator,
      () => ({}),
      () => ({ text: 'draft' }),
    )
    const epoch = test.coordinator.beginHydration()
    await epoch.waitUntilSuspended()
    const committed = await epoch.commitCanvasRead('project-a')
    expect(test.readDocument({ binding: committed!, documentId: 'document-a', scope: 'full' })).toEqual({
      text: 'draft',
    })

    test.coordinator.beginHydration()
    expect(() => test.readDocument({ binding: committed!, documentId: 'document-a', scope: 'full' })).toThrow(
      expect.objectContaining({ code: 'surface_port_suspended' }),
    )
    unregister()
  })

  it('shares the exact binding for Canvas write capture/execute and suspends both on rotation', async () => {
    const test = harness()
    const capture = vi.fn<NonNullable<Parameters<typeof registerProjectCanvasReadSurface>[4]>>(({ nodeId }) => ({
      node: { id: nodeId },
      groups: [],
    }))
    const execute = vi.fn(({ receiptProposalId }: { receiptProposalId: string }) => ({
      applied: true,
      proposalId: receiptProposalId,
    }))
    const unregister = registerProjectCanvasReadSurface(
      test.coordinator,
      () => ({}),
      undefined,
      undefined,
      capture,
      execute,
    )
    const epoch = test.coordinator.beginHydration()
    await epoch.waitUntilSuspended()
    const committed = await epoch.commitCanvasRead('project-a')
    const captureRequest = { binding: committed!, operation: 'set_node_prompt' as const, nodeId: 'node-real' }
    expect(test.captureCanvasWrite(captureRequest)).toEqual({ node: { id: 'node-real' }, groups: [] })
    const executeRequest = {
      binding: committed!,
      input: {},
      target: {},
      preconditions: {},
      receiptProposalId: 'receipt-a',
      approvalId: 'approval-a',
      actionHash: 'action-a',
      signal: new AbortController().signal,
    }
    expect(test.executeCanvasWrite(executeRequest)).toEqual({ applied: true, proposalId: 'receipt-a' })

    test.coordinator.beginHydration()
    expect(() => test.captureCanvasWrite(captureRequest)).toThrow(
      expect.objectContaining({ code: 'surface_port_suspended' }),
    )
    expect(() => test.executeCanvasWrite(executeRequest)).toThrow(
      expect.objectContaining({ code: 'surface_port_suspended' }),
    )
    unregister()
  })

  it('rejects Timeline read/write from an old binding as soon as the project Surface rotates', async () => {
    const test = harness()
    const read = vi.fn(() => ({ operation: 'read_timeline', revision: 'deadbeef' }))
    const write = vi.fn(() => ({ operation: 'undo_timeline_edit', ok: true, undone: true, revision: 'cafebabe' }))
    const unregister = registerProjectCanvasReadSurface(
      test.coordinator,
      () => ({}),
      undefined,
      undefined,
      undefined,
      undefined,
      read,
      write,
    )
    const epoch = test.coordinator.beginHydration()
    await epoch.waitUntilSuspended()
    const committed = await epoch.commitCanvasRead('project-a')
    const target = { kind: 'timeline', clipIds: [] }
    const preconditions = { timeline: { revision: 'deadbeef' } }
    const readRequest = {
      binding: committed!,
      input: { operation: 'read_timeline' as const },
      target,
      preconditions,
    }
    const writeRequest = {
      binding: committed!,
      input: {
        operation: 'undo_timeline_edit' as const,
        undoToken: 'timeline-undo:v1:receipt-a',
        expectedRevision: 'deadbeef',
      },
      target,
      preconditions,
      receiptProposalId: 'receipt-a',
      approvalId: 'approval-a',
      actionHash: 'action-a',
      signal: new AbortController().signal,
    }
    expect(test.readTimeline(readRequest)).toEqual({ operation: 'read_timeline', revision: 'deadbeef' })
    expect(test.writeTimeline(writeRequest)).toEqual({
      operation: 'undo_timeline_edit', ok: true, undone: true, revision: 'cafebabe',
    })

    test.coordinator.beginHydration()
    expect(() => test.readTimeline(readRequest)).toThrow(
      expect.objectContaining({ code: 'surface_port_suspended' }),
    )
    expect(() => test.writeTimeline(writeRequest)).toThrow(
      expect.objectContaining({ code: 'surface_port_suspended' }),
    )
    expect(read).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledTimes(1)
    unregister()
  })
})
