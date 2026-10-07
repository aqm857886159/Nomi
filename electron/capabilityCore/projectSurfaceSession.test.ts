import { describe, expect, it, vi } from 'vitest'
import type { IpcMainEvent } from 'electron'

const ipc = vi.hoisted(() => ({ listeners: new Map<string, (event: IpcMainEvent, value: unknown) => void>() }))
vi.mock('electron', () => ({ ipcMain: { on: (channel: string, listener: (event: IpcMainEvent, value: unknown) => void) => ipc.listeners.set(channel, listener) } }))
vi.mock('../ipcSenderGuard', () => ({ assertTrustedSender: () => undefined, assertTrustedFireAndForget: (_event: unknown, _channel: string, guard: (event: unknown) => void) => { try { guard(_event); return true } catch { return false } } }))
vi.mock('../runtimePaths', () => ({ getWorkspaceRepositoryDeps: () => ({}) }))
vi.mock('../workspace/workspaceRepository', () => ({ readWorkspaceProject: () => undefined, resolveWorkspaceProjectDir: () => undefined }))
import { createCanvasReadSurfaceRegistry, createSurfaceOwnerAuthority, type CapturedCanvasReadPort, type ProjectSurfaceSession } from './canvasReadSurfaceRegistry'
import * as factories from './verifiedCapabilityInvocationRendererFactories'
import { revalidateVerifiedCapabilityInvocation, resolveVerifiedCapabilityExecutionTarget, type VerifiedCapabilityInvocation } from './verifiedCapabilityInvocation'
import { registerMainCanvasReadExecutionRuntime } from './canvasReadExecutionRuntime'
import { createCapturedCanvasReadSnapshotRegistry } from './canvasReadCapturedSnapshotRegistry'
import { createMainCapabilityExecutorRegistry } from './capabilityExecutorRegistry'

function transportCannotBecomeSession(captured: CapturedCanvasReadPort) {
  // @ts-expect-error A frame capability cannot inhabit a long-lived session field.
  const session: ProjectSurfaceSession = captured
  return session
}
void transportCannotBecomeSession

async function fixture(send?: (channel: string, payload: Record<string, unknown>) => void) {
  const authority = createSurfaceOwnerAuthority()
  const descriptor = { contents: {}, frame: { send }, webContentsId: 1, processId: 2, frameRoutingId: 3, origin: 'file://', isLive: () => true }
  const owner = authority.capture(descriptor)
  const resolveProjectIdentity = vi.fn(async (projectId: string) => ({
    projectId, immutableProjectUuid: `uuid-${projectId}`, projectGeneration: 1, canonicalRootPath: `/projects/${projectId}`, canonicalRootDigest: `root-${projectId}`,
  }))
  const registry = createCanvasReadSurfaceRegistry({ ownerAuthority: authority, resolveProjectIdentity })
  const commit = async (projectId = 'a') => registry.commitCanvasRead(owner, {
    projectId, suspension: registry.suspend(owner, { surfaceInstanceId: 'surface' }),
  })
  const binding = (await commit()).binding
  return { registry, authority, descriptor, owner, binding, commit, resolveProjectIdentity }
}

describe('Project surface session identity', () => {
  it.each(['success', 'failure'] as const)('rejects a late %s reply for revoked authority without revoking its replacement', async (outcome) => {
    const f = await fixture()
    const old = f.registry.openProjectSession(f.owner, f.binding)
    const capture = f.registry.captureProjectSessionPort(old)
    const wire = f.registry.resolveCapturedCanvasReadPort(capture).binding
    let finish!: (identity: Awaited<ReturnType<typeof f.resolveProjectIdentity>>) => void
    let fail!: (error: Error) => void
    f.resolveProjectIdentity.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject }))
    const reply = f.registry.assertCanvasReadPortReply(capture, wire)
    const rejected = expect(reply).rejects.toMatchObject({ code: outcome === 'success' ? 'capability_cancelled' : 'project_identity_unavailable' })
    f.registry.revokeProjectSession(old)
    const replacement = f.registry.openProjectSession(f.owner, f.binding)
    if (outcome === 'success') finish(await f.resolveProjectIdentity('a'))
    else fail(new Error('late read failure'))
    await rejected
    await expect(f.registry.verifyProjectSession(replacement)).resolves.toMatchObject({ binding: f.binding })
  })

  it('does not revoke a new session when an old session identity read fails late', async () => {
    const f = await fixture()
    const old = f.registry.openProjectSession(f.owner, f.binding)
    let fail!: (error: Error) => void
    f.resolveProjectIdentity.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    const rejected = expect(f.registry.verifyProjectSession(old)).rejects.toMatchObject({ code: 'project_identity_unavailable' })
    f.registry.revokeProjectSession(old)
    const replacement = f.registry.openProjectSession(f.owner, f.binding)
    fail(new Error('old session IO failure'))
    await rejected
    await expect(f.registry.verifyProjectSession(replacement)).resolves.toMatchObject({ binding: f.binding })
  })

  it.each(['session-verification', 'reply-verification'] as const)('can issue fresh authority after transient %s IO failure without reviving the old session', async (stage) => {
    const f = await fixture()
    const session = f.registry.openProjectSession(f.owner, f.binding)
    const capture = f.registry.captureProjectSessionPort(session)
    const wire = f.registry.resolveCapturedCanvasReadPort(capture).binding
    f.resolveProjectIdentity.mockRejectedValueOnce(new Error('temporary disk read failure'))
    await expect(stage === 'session-verification' ? f.registry.verifyProjectSession(session)
      : f.registry.assertCanvasReadPortReply(capture, wire)).rejects.toMatchObject({ code: 'project_identity_unavailable' })
    expect(() => f.registry.resolveProjectSession(session)).toThrow()
    expect(() => f.registry.resolveCapturedCanvasReadPort(capture)).toThrow()
    const fresh = f.registry.openProjectSession(f.owner, f.binding)
    expect(fresh).not.toBe(session)
    await expect(f.registry.verifyProjectSession(fresh)).resolves.toMatchObject({ binding: f.binding })
    expect(() => f.registry.resolveProjectSession(session)).toThrow()
  })

  it.each(['invalid-output', 'untyped-error'] as const)('retains uncertainty after document dispatch with %s', async (failure) => {
    const f = await fixture()
    const session = f.registry.openProjectSession(f.owner, f.binding)
    const invocation = await factories.createRendererDocumentWriteVerifiedInvocationFactory({ registry: f.registry, session, requestId: 'invalid-result' }).mint({
      toolCallId: 'tool', documentId: 'doc', anchor: { kind: 'whole-document' },
      preconditions: { document: { revision: 1, contentHash: 'before' } }, input: { operation: 'append', content: 'After' },
    })
    let writes = 0
    const executor = createMainCapabilityExecutorRegistry({
      resolveCanvasReadPort: async () => { throw new Error('not a read') },
      resolveDocumentWritePort: async () => ({ write: async () => {
        writes += 1
        if (failure === 'untyped-error') throw new Error('reply encoding failed after commit')
        return { applied: 'not-a-boolean' }
      } }),
    })
    await expect(executor.execute(invocation)).rejects.toMatchObject({ code: 'capability_receipt_unresolved' })
    expect(writes).toBe(1)
  })

  it('reports an unknown outcome when a dispatched document write times out', async () => {
    const f = await fixture()
    const session = f.registry.openProjectSession(f.owner, f.binding)
    const invocation = await factories.createRendererDocumentWriteVerifiedInvocationFactory({ registry: f.registry, session, requestId: 'timeout' }).mint({
      toolCallId: 'tool', documentId: 'doc', anchor: { kind: 'whole-document' },
      preconditions: { document: { revision: 1, contentHash: 'before' } }, input: { operation: 'append', content: 'After' },
    })
    let writes = 0
    const executor = createMainCapabilityExecutorRegistry({ timeoutMs: 1,
      resolveCanvasReadPort: async () => { throw new Error('not a read') },
      resolveDocumentWritePort: async () => ({ write: ({ signal }) => new Promise((_resolve, reject) => {
        writes += 1
        signal.addEventListener('abort', () => reject(new Error('late renderer')), { once: true })
      }) }),
    })
    await expect(executor.execute(invocation)).rejects.toMatchObject({ code: 'capability_receipt_unresolved' })
    expect(writes).toBe(1)
  })

  it('keeps one identity for the same owner and project while action captures expire', async () => {
    const f = await fixture()
    const session = f.registry.openProjectSession(f.owner, f.binding)
    expect(f.registry.openProjectSession(f.owner, f.binding)).toBe(session)
    const old = f.registry.captureProjectSessionPort(session)
    const identity = f.registry.resolveProjectSession(session)
    await f.commit()
    expect(f.registry.resolveProjectSession(session)).toEqual(identity)
    expect(() => f.registry.resolveCapturedCanvasReadPort(old)).toThrow()
    expect(f.registry.resolveCapturedCanvasReadPort(f.registry.captureProjectSessionPort(session)).binding.binding).toEqual(f.binding)
  })

  it('permanently revokes A before B can publish and does not resurrect A on returning', async () => {
    const f = await fixture()
    const session = f.registry.openProjectSession(f.owner, f.binding)
    const { signal } = f.registry.resolveProjectSession(session)
    await f.commit('b')
    expect(signal.aborted).toBe(true)
    expect(() => f.registry.resolveProjectSession(session)).toThrow()
    await f.commit('a')
    expect(() => f.registry.captureProjectSessionPort(session)).toThrow()
    expect(f.registry.openProjectSession(f.owner, f.binding)).not.toBe(session)
  })

  it('rejects forged sessions, another window and incomplete project identity', async () => {
    const f = await fixture()
    const session = f.registry.openProjectSession(f.owner, f.binding)
    const other = f.authority.capture({ ...f.descriptor, contents: {}, webContentsId: 9 })
    expect(() => f.registry.openProjectSession(other, f.binding)).toThrow(expect.objectContaining({ code: 'surface_owner_mismatch' }))
    expect(() => f.registry.assertProjectSessionOwner(session, other)).toThrow(expect.objectContaining({ code: 'surface_owner_mismatch' }))
    expect(() => f.registry.resolveProjectSession({} as never)).toThrow()
    for (const change of [{ projectId: 'b' }, { immutableProjectUuid: 'replacement' }, { projectGeneration: 2 }]) {
      expect(() => f.registry.openProjectSession(f.owner, { ...f.binding, ...change })).toThrow()
    }
  })

  it('revokes on owner replacement and explicit close, even when project stays the same', async () => {
    const f = await fixture()
    const session = f.registry.openProjectSession(f.owner, f.binding)
    f.registry.invalidateOwner(f.owner)
    await f.commit()
    expect(() => f.registry.captureProjectSessionPort(session)).toThrow()
    const next = f.registry.openProjectSession(f.owner, f.binding)
    f.registry.revokeProjectSession(next)
    expect(() => f.registry.resolveProjectSession(next)).toThrow()
  })

  it('cancels an already dispatched action immediately when its session closes', async () => {
    let sent!: () => void
    const dispatched = new Promise<void>(resolve => { sent = resolve })
    const send = vi.fn((channel: string) => { if (channel.endsWith(':request')) sent() })
    const f = await fixture(send)
    const session = f.registry.openProjectSession(f.owner, f.binding)
    const captured = f.registry.captureProjectSessionPort(session)
    const runtime = registerMainCanvasReadExecutionRuntime({ surfaceRegistry: f.registry,
      capturedSnapshots: createCapturedCanvasReadSnapshotRegistry({ ownerAuthority: f.authority }),
    })
    const reading = runtime.surfacePortRuntime!.createPort(captured).read({ signal: new AbortController().signal })
    const rejected = expect(reading).rejects.toMatchObject({ code: 'capability_cancelled' })
    await dispatched
    f.registry.revokeProjectSession(session)
    expect(send.mock.calls.some(([channel]) => channel === 'nomi:surface:request:cancel')).toBe(true)
    expect(() => f.registry.resolveCapturedCanvasReadPort(captured)).toThrow()
    await rejected
  })

  it('revalidates immutable disk identity and detects a project switch while identity IO is pending', async () => {
    const f = await fixture()
    const session = f.registry.openProjectSession(f.owner, f.binding)
    let resolve!: (value: Awaited<ReturnType<typeof f.resolveProjectIdentity>>) => void
    f.resolveProjectIdentity.mockImplementationOnce(() => new Promise(yes => { resolve = yes }))
    const verifying = f.registry.verifyProjectSession(session)
    await f.commit('b')
    resolve({ projectId: 'a', immutableProjectUuid: 'uuid-a', projectGeneration: 1, canonicalRootPath: '/projects/a', canonicalRootDigest: 'root-a' })
    await expect(verifying).rejects.toMatchObject({ code: 'project_binding_stale' })
    await f.commit('a')
    const next = f.registry.openProjectSession(f.owner, f.binding)
    f.resolveProjectIdentity.mockResolvedValueOnce({ projectId: 'a', immutableProjectUuid: 'replaced', projectGeneration: 1, canonicalRootPath: '/projects/a', canonicalRootDigest: 'root-a' })
    await expect(f.registry.verifyProjectSession(next)).rejects.toMatchObject({ code: 'project_binding_stale' })
    expect(f.registry.getCommittedProjectSelection()).toBeNull()
  })
})

const node = { id: 'node', kind: 'image', title: 'Shot', prompt: 'Before', locked: false, categoryId: 'shots', groupId: null,
  model: { modelKey: 'model', vendorKey: 'vendor', archetypeId: null, modeId: null, variantId: null }, currentResult: null }
const context = { toolCallId: 'tool' }
const cases = [
  { name: 'canvas read', factory: factories.createRendererCanvasReadVerifiedInvocationFactory, args: { ...context, input: {} } },
  { name: 'document read', factory: factories.createRendererDocumentReadVerifiedInvocationFactory, args: { ...context, documentId: 'doc', input: { scope: 'full' } } },
  { name: 'document write', factory: factories.createRendererDocumentWriteVerifiedInvocationFactory,
    args: { ...context, documentId: 'doc', anchor: { kind: 'whole-document' }, preconditions: { document: { revision: 1, contentHash: 'before' } }, input: { operation: 'append', content: 'After' } } },
  { name: 'canvas write', factory: factories.createRendererCanvasWriteVerifiedInvocationFactory,
    args: { ...context, input: { operation: 'set_node_prompt', nodeId: 'node', prompt: 'After' }, rawEvidence: { node, groups: [] } } },
  { name: 'canvas delete', factory: factories.createRendererCanvasDeleteVerifiedInvocationFactory,
    args: { ...context, input: { operation: 'delete_canvas_nodes', nodeIds: ['node'], reason: 'Unused' }, rawEvidence: {
      nodes: [{ ...node, position: { x: 0, y: 0 } }], edges: [], groups: [], resolvedReferences: [{ requestedId: 'node', nodeId: 'node' }],
    } } },
  { name: 'timeline read', factory: factories.createRendererTimelineReadVerifiedInvocationFactory, args: { ...context, input: { operation: 'read_timeline' } } },
  { name: 'timeline write', factory: factories.createRendererTimelineWriteVerifiedInvocationFactory, args: { ...context, input: { operation: 'undo_timeline_edit', undoToken: 'undo', expectedRevision: 'before' } } },
  { name: 'asset read', factory: factories.createRendererAssetReadVerifiedInvocationFactory, args: { ...context, input: { operation: 'search_media' } } },
  { name: 'export read', factory: factories.createRendererExportReadVerifiedInvocationFactory, args: { ...context, input: { operation: 'inspect_export_job', jobId: 'job' } } },
  { name: 'export write', factory: factories.createRendererExportWriteVerifiedInvocationFactory, args: { ...context, input: { operation: 'export_timeline', expectedRevision: 'before' } } },
] as const

describe.each(cases)('$name project session authority', ({ factory, args }) => {
  if ('operation' in args.input && ['append', 'set_node_prompt', 'delete_canvas_nodes', 'undo_timeline_edit', 'export_timeline'].includes(args.input.operation)) {
    it.each(['session', 'caller', 'reply-identity'] as const)('keeps a dispatched write outcome unknown on %s interruption', async (interruption) => {
      const caller = new AbortController()
      let writes = 0
      const send = vi.fn((channel: string, payload: Record<string, unknown>) => {
        if (channel.endsWith(':cancel')) return
        writes += 1
        if (interruption === 'session') f.registry.revokeProjectSession(session)
        else if (interruption === 'caller') caller.abort()
        else {
          f.resolveProjectIdentity.mockRejectedValueOnce(new Error('identity disk unavailable'))
          ipc.listeners.get(channel.replace(/:request$/, ':reply'))!(
            { sender: f.descriptor.contents, senderFrame: f.descriptor.frame } as IpcMainEvent,
            { ...payload, result: { applied: true } },
          )
        }
      })
      const f = await fixture(send)
      const session = f.registry.openProjectSession(f.owner, f.binding)
      const invocation: VerifiedCapabilityInvocation<unknown, unknown> = await factory({ registry: f.registry, session, requestId: 'request' }).mint(args as never)
      const runtime = registerMainCanvasReadExecutionRuntime({ surfaceRegistry: f.registry,
        capturedSnapshots: createCapturedCanvasReadSnapshotRegistry({ ownerAuthority: f.authority }),
        disk: { resolveProjectIdentity: async () => { throw new Error('no disk fallback') }, readCanvas: () => { throw new Error('no disk fallback') } },
      })
      await expect(runtime.executor.execute(invocation, { signal: caller.signal,
        approval: { receiptProposalId: 'receipt', approvalId: 'approval', actionHash: invocation.actionHash } }))
        .rejects.toMatchObject({ code: 'capability_receipt_unresolved' })
      expect(writes).toBe(1)
    })
  }

  it('production executor dispatches through the current action transport after the prepared transport expires', async () => {
    const send = vi.fn((channel: string, payload: Record<string, unknown>) => {
      const event = { sender: f.descriptor.contents, senderFrame: f.descriptor.frame } as IpcMainEvent
      ipc.listeners.get(channel.replace(/:request$/, ':reply'))!(event, { ...payload, error: { code: 'capability_target_stale' } })
    })
    const f = await fixture(send)
    const session = f.registry.openProjectSession(f.owner, f.binding)
    const invocation: VerifiedCapabilityInvocation<unknown, unknown> = await factory({ registry: f.registry, session, requestId: 'request' }).mint(args as never)
    const nextBinding = await f.commit()
    const runtime = registerMainCanvasReadExecutionRuntime({ surfaceRegistry: f.registry,
      capturedSnapshots: createCapturedCanvasReadSnapshotRegistry({ ownerAuthority: f.authority }),
      disk: { resolveProjectIdentity: async () => { throw new Error('renderer invocation must not read disk') }, readCanvas: () => { throw new Error('no disk fallback') } },
    })
    await expect(runtime.executor.execute(invocation, { approval: { receiptProposalId: 'receipt', approvalId: 'approval', actionHash: invocation.actionHash } }))
      .rejects.toMatchObject({ code: 'capability_target_stale' })
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][1].binding).toEqual(nextBinding)
    const target = resolveVerifiedCapabilityExecutionTarget(invocation)
    if (target.kind === 'canvas-write-surface' || target.kind === 'timeline-write-surface' || target.kind === 'export-write-surface') {
      send.mockClear()
      await expect(runtime.executor.execute(invocation, { approval: { receiptProposalId: 'receipt', approvalId: 'approval', actionHash: 'tampered' } }))
        .rejects.toMatchObject({ code: 'capability_authority_invalid' })
      expect(send).not.toHaveBeenCalled()
    }
  })

  it('keeps prepared authority across transport replacement and permanently rejects it after changing project', async () => {
    const f = await fixture()
    const session = f.registry.openProjectSession(f.owner, f.binding)
    const adapter = factory({ registry: f.registry, session, requestId: 'request' })
    const invocation: VerifiedCapabilityInvocation<unknown, unknown> = await adapter.mint(args as never)
    const hash = invocation.actionHash
    const preconditions = invocation.preconditions
    await f.commit()
    await expect(revalidateVerifiedCapabilityInvocation(invocation)).resolves.toBe(invocation)
    expect(invocation.actionHash).toBe(hash)
    expect(invocation.preconditions).toBe(preconditions)
    expect(resolveVerifiedCapabilityExecutionTarget(invocation)).toMatchObject({ session })
    expect(resolveVerifiedCapabilityExecutionTarget(invocation)).not.toHaveProperty('capturedPort')
    await f.commit('b')
    await expect(revalidateVerifiedCapabilityInvocation(invocation)).rejects.toMatchObject({ code: 'project_binding_stale' })
    await f.commit('a')
    await expect(adapter.mint(args as never)).rejects.toMatchObject({ code: 'project_binding_stale' })
  })

  it('does not move an old invocation to another owner opening the same project', async () => {
    const f = await fixture()
    const session = f.registry.openProjectSession(f.owner, f.binding)
    const invocation: VerifiedCapabilityInvocation<unknown, unknown> = await factory({ registry: f.registry, session, requestId: 'request' }).mint(args as never)
    f.registry.invalidateOwner(f.owner)
    const other = f.authority.capture({ ...f.descriptor, contents: {}, frame: {}, webContentsId: 8 })
    const suspension = f.registry.suspend(other, { surfaceInstanceId: 'other' })
    await f.registry.commitCanvasRead(other, { projectId: 'a', suspension })
    const replacement = f.registry.openProjectSession(other, f.binding)
    expect(replacement).not.toBe(session)
    await expect(revalidateVerifiedCapabilityInvocation(invocation)).rejects.toMatchObject({ code: 'project_binding_stale' })
  })
})
