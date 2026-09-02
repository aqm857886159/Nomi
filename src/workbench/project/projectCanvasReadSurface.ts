import type {
  CanvasReadSurfaceBridge,
  CapturedCanvasReadSnapshotHandleWire,
  SurfacePortBindingWire,
  SurfaceSuspensionWire,
} from '../../../electron/shared/surfacePortBinding'
import { SurfacePortWireError } from '../../../electron/shared/surfacePortBinding'
import type { CanvasWriteInput, CanvasWriteOperation } from '../../../electron/shared/agentCapabilities/canvasWrite'
import type { CanvasDeleteInput } from '../../../electron/shared/agentCapabilities/canvasDelete'
import type { AssetReadInput } from '../../../electron/shared/agentCapabilities/assetRead'
import type { ExportReadInput, ExportWriteInput } from '../../../electron/shared/agentCapabilities/exportCapabilities'
import type { TimelineReadInput } from '../../../electron/shared/agentCapabilities/timelineRead'
import type { TimelineWriteInput } from '../../../electron/shared/agentCapabilities/timelineWrite'

export class ProjectHydrationSupersededError extends Error {
  readonly code = 'project_hydration_superseded'

  constructor() {
    super('project_hydration_superseded')
    this.name = 'ProjectHydrationSupersededError'
  }
}

export type ProjectHydrationEpoch = Readonly<{
  signal: AbortSignal
  assertCurrent(): void
  waitUntilSuspended(): Promise<void>
  commitCanvasRead(projectId: string): Promise<SurfacePortBindingWire | null>
  release(): Promise<void>
}>

export type ProjectHydrationGuard = Pick<ProjectHydrationEpoch, 'signal' | 'assertCurrent'>
export type ProjectSurfaceExecutionGuard = Readonly<{ signal: AbortSignal; assertCurrent(): void }>

export type ProjectCanvasReadSurfaceCoordinator = Readonly<{
  beginHydration(): ProjectHydrationEpoch
  releaseCurrent(): Promise<void>
  getCurrentBinding(): SurfacePortBindingWire | null
  sealCanvasReadSnapshot(
    binding: SurfacePortBindingWire,
    snapshot: unknown,
  ): Promise<CapturedCanvasReadSnapshotHandleWire>
  registerCanvasReadSource(readSnapshot: () => unknown): () => void
  registerDocumentReadSource(
    readDocument: (input: { documentId: string; scope: 'full' | 'selection' }) => unknown,
  ): () => void
  registerDocumentWriteSource(
    writeDocument: (input: {
      documentId: string
      operation: 'insert' | 'replace' | 'append'
      content: string
      target: unknown
      preconditions: unknown
    } & ProjectSurfaceExecutionGuard) => unknown,
  ): () => void
  registerCanvasWriteCaptureSource(
    capture: (input: {
      operation: CanvasWriteOperation | CanvasDeleteInput['operation']
      input?: CanvasWriteInput | CanvasDeleteInput
      nodeId?: string
    }) => unknown,
  ): () => void
  registerCanvasWriteExecuteSource(
    execute: (input: {
      input: unknown
      target: unknown
      preconditions: unknown
      receiptProposalId: string
      approvalId: string
      actionHash: string
    } & ProjectSurfaceExecutionGuard) => unknown,
  ): () => void
  registerTimelineReadSource(
    read: (input: { input: TimelineReadInput; target: unknown; preconditions: unknown }) => unknown,
  ): () => void
  registerTimelineWriteSource(
    write: (input: {
      input: TimelineWriteInput
      target: unknown
      preconditions: unknown
      receiptProposalId: string
      approvalId: string
      actionHash: string
    } & ProjectSurfaceExecutionGuard) => unknown,
  ): () => void
  registerAssetReadSource(
    read: (input: { input: AssetReadInput; target: unknown; preconditions: unknown }) => unknown,
  ): () => void
  registerExportReadSource(
    read: (input: { input: ExportReadInput; target: unknown; preconditions: unknown }) => unknown,
  ): () => void
  registerExportWriteSource(
    write: (input: {
      input: ExportWriteInput
      target: unknown
      preconditions: unknown
      receiptProposalId: string
      approvalId: string
      actionHash: string
    } & ProjectSurfaceExecutionGuard) => unknown,
  ): () => void
}>

let registeredCoordinator: ProjectCanvasReadSurfaceCoordinator | null = null

/** Share the one coordinator object, never a copied project/binding scalar. */
export function registerProjectCanvasReadSurfaceCoordinator(
  coordinator: ProjectCanvasReadSurfaceCoordinator,
): () => void {
  if (registeredCoordinator && registeredCoordinator !== coordinator) {
    throw new SurfacePortWireError('surface_owner_mismatch')
  }
  registeredCoordinator = coordinator
  return () => {
    if (registeredCoordinator === coordinator) registeredCoordinator = null
  }
}

/** Install the one shared coordinator pointer and its live read source together. */
export function registerProjectCanvasReadSurface(
  coordinator: ProjectCanvasReadSurfaceCoordinator,
  readSnapshot: () => unknown,
  readDocument?: (input: { documentId: string; scope: 'full' | 'selection' }) => unknown,
  writeDocument?: (input: {
    documentId: string
    operation: 'insert' | 'replace' | 'append'
    content: string
    target: unknown
    preconditions: unknown
  } & ProjectSurfaceExecutionGuard) => unknown,
  captureCanvasWrite?: (input: {
    operation: CanvasWriteOperation | CanvasDeleteInput['operation']
    input?: CanvasWriteInput | CanvasDeleteInput
    nodeId?: string
  }) => unknown,
  executeCanvasWrite?: (input: {
    input: unknown
    target: unknown
    preconditions: unknown
    receiptProposalId: string
    approvalId: string
    actionHash: string
  } & ProjectSurfaceExecutionGuard) => unknown,
  readTimeline?: (input: { input: TimelineReadInput; target: unknown; preconditions: unknown }) => unknown,
  writeTimeline?: (input: {
    input: TimelineWriteInput
    target: unknown
    preconditions: unknown
    receiptProposalId: string
    approvalId: string
    actionHash: string
  } & ProjectSurfaceExecutionGuard) => unknown,
  additionalSources?: Readonly<{
    readAsset?: (input: { input: AssetReadInput; target: unknown; preconditions: unknown }) => unknown
    readExport?: (input: { input: ExportReadInput; target: unknown; preconditions: unknown }) => unknown
    writeExport?: (input: {
      input: ExportWriteInput
      target: unknown
      preconditions: unknown
      receiptProposalId: string
      approvalId: string
      actionHash: string
    } & ProjectSurfaceExecutionGuard) => unknown
  }>,
): () => void {
  const unregisterCoordinator = registerProjectCanvasReadSurfaceCoordinator(coordinator)
  let unregisterSnapshot: (() => void) | undefined
  let unregisterDocument: (() => void) | undefined
  let unregisterDocumentWrite: (() => void) | undefined
  let unregisterCanvasWriteCapture: (() => void) | undefined
  let unregisterCanvasWriteExecute: (() => void) | undefined
  let unregisterTimelineRead: (() => void) | undefined
  let unregisterTimelineWrite: (() => void) | undefined
  let unregisterAssetRead: (() => void) | undefined
  let unregisterExportRead: (() => void) | undefined
  let unregisterExportWrite: (() => void) | undefined
  try {
    unregisterSnapshot = coordinator.registerCanvasReadSource(readSnapshot)
    unregisterDocument = readDocument ? coordinator.registerDocumentReadSource(readDocument) : undefined
    unregisterDocumentWrite = writeDocument ? coordinator.registerDocumentWriteSource(writeDocument) : undefined
    unregisterCanvasWriteCapture = captureCanvasWrite
      ? coordinator.registerCanvasWriteCaptureSource(captureCanvasWrite)
      : undefined
    unregisterCanvasWriteExecute = executeCanvasWrite
      ? coordinator.registerCanvasWriteExecuteSource(executeCanvasWrite)
      : undefined
    unregisterTimelineRead = readTimeline ? coordinator.registerTimelineReadSource(readTimeline) : undefined
    unregisterTimelineWrite = writeTimeline ? coordinator.registerTimelineWriteSource(writeTimeline) : undefined
    unregisterAssetRead = additionalSources?.readAsset
      ? coordinator.registerAssetReadSource(additionalSources.readAsset)
      : undefined
    unregisterExportRead = additionalSources?.readExport
      ? coordinator.registerExportReadSource(additionalSources.readExport)
      : undefined
    unregisterExportWrite = additionalSources?.writeExport
      ? coordinator.registerExportWriteSource(additionalSources.writeExport)
      : undefined
    return () => {
      unregisterExportWrite?.()
      unregisterExportRead?.()
      unregisterAssetRead?.()
      unregisterTimelineWrite?.()
      unregisterTimelineRead?.()
      unregisterCanvasWriteExecute?.()
      unregisterCanvasWriteCapture?.()
      unregisterDocumentWrite?.()
      unregisterDocument?.()
      unregisterSnapshot?.()
      unregisterCoordinator()
    }
  } catch (error) {
    unregisterExportWrite?.()
    unregisterExportRead?.()
    unregisterAssetRead?.()
    unregisterTimelineWrite?.()
    unregisterTimelineRead?.()
    unregisterCanvasWriteExecute?.()
    unregisterCanvasWriteCapture?.()
    unregisterDocument?.()
    unregisterDocumentWrite?.()
    unregisterSnapshot?.()
    unregisterCoordinator()
    throw error
  }
}

export function captureCurrentProjectCanvasReadSurfaceBinding(): SurfacePortBindingWire | null {
  return registeredCoordinator?.getCurrentBinding() ?? null
}

/** Exchange the already-captured exact binding and bytes; never recapture global state after an await. */
export function sealCurrentProjectCanvasReadSnapshot(
  binding: SurfacePortBindingWire,
  snapshot: unknown,
): Promise<CapturedCanvasReadSnapshotHandleWire> {
  const coordinator = registeredCoordinator
  if (!coordinator) return Promise.reject(new SurfacePortWireError('surface_port_unavailable'))
  return coordinator.sealCanvasReadSnapshot(binding, snapshot)
}

type EpochState = {
  id: number
  controller: AbortController
  bridge: CanvasReadSurfaceBridge | null
  suspensionPromise: Promise<void>
  suspension: SurfaceSuspensionWire | null
  binding: SurfacePortBindingWire | null
  epoch: ProjectHydrationEpoch | null
}

function requiredProjectId(value: string): string {
  const projectId = value.trim()
  if (!projectId) throw new Error('project_identity_unavailable')
  return projectId
}

function sameBinding(left: SurfacePortBindingWire, right: SurfacePortBindingWire): boolean {
  return (
    left.version === right.version &&
    left.bindingId === right.bindingId &&
    left.binding.projectId === right.binding.projectId &&
    left.binding.immutableProjectUuid === right.binding.immutableProjectUuid &&
    left.binding.projectGeneration === right.binding.projectGeneration &&
    left.webContentsId === right.webContentsId &&
    left.processId === right.processId &&
    left.frameRoutingId === right.frameRoutingId &&
    left.origin === right.origin &&
    left.surfaceInstanceId === right.surfaceInstanceId &&
    left.portRevision === right.portRevision &&
    left.nonce === right.nonce
  )
}

export function createProjectCanvasReadSurfaceCoordinator(
  input: Readonly<{
    getSurfaceBridge(): CanvasReadSurfaceBridge | null
    createSurfaceInstanceId(): string
  }>,
): ProjectCanvasReadSurfaceCoordinator {
  const surfaceInstanceId = input.createSurfaceInstanceId().trim()
  if (!surfaceInstanceId) throw new Error('surface_instance_unavailable')
  let sequence = 0
  let current: EpochState | null = null

  const assertCurrent = (state: EpochState): void => {
    if (current !== state || state.controller.signal.aborted) {
      throw new ProjectHydrationSupersededError()
    }
  }

  const awaitWhileCurrent = async <T>(state: EpochState, pending: Promise<T>): Promise<T> => {
    try {
      const value = await pending
      assertCurrent(state)
      return value
    } catch (error) {
      // Prefer the local epoch verdict over a delayed main stale error. This
      // keeps older callers from treating an expected overlap as a real failure.
      assertCurrent(state)
      throw error
    }
  }

  const requestGuard = (binding: SurfacePortBindingWire, signal: AbortSignal): ProjectSurfaceExecutionGuard => {
    const assertRequestCurrent = (): void => {
      if (signal.aborted) throw new SurfacePortWireError('capability_cancelled')
      const state = current
      if (!state?.binding) {
        throw new SurfacePortWireError(state ? 'surface_port_suspended' : 'surface_port_unavailable')
      }
      if (!sameBinding(binding, state.binding)) throw new SurfacePortWireError('surface_port_stale')
    }
    assertRequestCurrent()
    return Object.freeze({ signal, assertCurrent: assertRequestCurrent })
  }

  const releaseState = async (state: EpochState): Promise<void> => {
    assertCurrent(state)
    await awaitWhileCurrent(state, state.suspensionPromise)
    const authority = state.binding ?? state.suspension
    if (!authority || !state.bridge) {
      state.controller.abort()
      if (current === state) current = null
      return
    }
    // Keep the exact server-issued authority until main confirms it has cleared
    // the route. If IPC fails, retaining it is the only way to retry release
    // without resurrecting or guessing project authority in the renderer.
    await awaitWhileCurrent(state, state.bridge.release({ authority }))
    state.controller.abort()
    if (current === state) current = null
  }

  const coordinator: ProjectCanvasReadSurfaceCoordinator = Object.freeze({
    beginHydration() {
      current?.controller.abort()
      const bridge = input.getSurfaceBridge()
      const state: EpochState = {
        id: ++sequence,
        controller: new AbortController(),
        bridge,
        suspensionPromise: Promise.resolve(),
        suspension: null,
        binding: null,
        epoch: null,
      }
      current = state
      const rawSuspension = bridge ? Promise.resolve(bridge.suspend({ surfaceInstanceId })) : Promise.resolve(null)
      state.suspensionPromise = rawSuspension.then((reply) => {
        assertCurrent(state)
        state.suspension = reply?.suspension ?? null
      })
      const epoch: ProjectHydrationEpoch = Object.freeze({
        signal: state.controller.signal,
        assertCurrent: () => assertCurrent(state),
        waitUntilSuspended: async () => {
          await awaitWhileCurrent(state, state.suspensionPromise)
        },
        commitCanvasRead: async (value) => {
          await awaitWhileCurrent(state, state.suspensionPromise)
          if (!state.bridge || !state.suspension) return null
          const reply = await awaitWhileCurrent(
            state,
            state.bridge.commitCanvasRead({
              projectId: requiredProjectId(value),
              suspension: state.suspension,
            }),
          )
          state.binding = reply.binding
          return reply.binding
        },
        release: () => releaseState(state),
      })
      state.epoch = epoch
      return epoch
    },
    async releaseCurrent() {
      const state = current
      if (!state) return
      await releaseState(state)
    },
    getCurrentBinding() {
      return current?.binding ?? null
    },
    sealCanvasReadSnapshot(binding, snapshot) {
      const state = current
      if (!state?.binding || !state.bridge) {
        return Promise.reject(new SurfacePortWireError(state ? 'surface_port_suspended' : 'surface_port_unavailable'))
      }
      if (!sameBinding(binding, state.binding)) {
        return Promise.reject(new SurfacePortWireError('surface_port_stale'))
      }
      // IPC dispatch happens during this call. Its reply deliberately does not
      // consult `current`: the main-sealed bytes belong to the submitted turn.
      return Promise.resolve(state.bridge.captureCanvasReadSnapshot({ binding, snapshot })).then(
        (reply) => reply.handle,
      )
    },
    registerCanvasReadSource(readSnapshot) {
      const bridge = input.getSurfaceBridge()
      if (!bridge) return () => undefined
      return bridge.onCanvasRead(({ binding }) => {
        const state = current
        if (!state || !state.binding) {
          throw new SurfacePortWireError(state ? 'surface_port_suspended' : 'surface_port_unavailable')
        }
        if (!sameBinding(binding, state.binding)) throw new SurfacePortWireError('surface_port_stale')
        // The preload invokes this handler synchronously; the store snapshot is
        // therefore captured against the exact binding before any promise turn.
        return readSnapshot()
      })
    },
    registerDocumentReadSource(readDocument) {
      const bridge = input.getSurfaceBridge()
      if (!bridge || !readDocument) return () => undefined
      return bridge.onDocumentRead(({ binding, documentId, scope }) => {
        const state = current
        if (!state || !state.binding)
          throw new SurfacePortWireError(state ? 'surface_port_suspended' : 'surface_port_unavailable')
        if (!sameBinding(binding, state.binding)) throw new SurfacePortWireError('surface_port_stale')
        return readDocument({ documentId, scope })
      })
    },
    registerDocumentWriteSource(writeDocument) {
      const bridge = input.getSurfaceBridge()
      if (!bridge || !writeDocument) return () => undefined
      return bridge.onDocumentWrite(({ binding, signal, documentId, operation, content, target, preconditions }) => {
        const guard = requestGuard(binding, signal)
        return writeDocument({ documentId, operation, content, target, preconditions, ...guard })
      })
    },
    registerCanvasWriteCaptureSource(capture) {
      const bridge = input.getSurfaceBridge()
      if (!bridge || !capture) return () => undefined
      return bridge.onCanvasWriteCapture(({ binding, operation, input, nodeId }) => {
        const state = current
        if (!state || !state.binding)
          throw new SurfacePortWireError(state ? 'surface_port_suspended' : 'surface_port_unavailable')
        if (!sameBinding(binding, state.binding)) throw new SurfacePortWireError('surface_port_stale')
        return capture({
          operation,
          ...(input !== undefined ? { input: input as CanvasWriteInput } : {}),
          ...(nodeId ? { nodeId } : {}),
        })
      })
    },
    registerCanvasWriteExecuteSource(execute) {
      const bridge = input.getSurfaceBridge()
      if (!bridge || !execute) return () => undefined
      return bridge.onCanvasWriteExecute(({ binding, ...request }) => {
        const guard = requestGuard(binding, request.signal)
        return execute({ ...request, ...guard })
      })
    },
    registerTimelineReadSource(read) {
      const bridge = input.getSurfaceBridge()
      if (!bridge || !read) return () => undefined
      return bridge.onTimelineRead(({ binding, ...request }) => {
        const state = current
        if (!state || !state.binding)
          throw new SurfacePortWireError(state ? 'surface_port_suspended' : 'surface_port_unavailable')
        if (!sameBinding(binding, state.binding)) throw new SurfacePortWireError('surface_port_stale')
        return read(request)
      })
    },
    registerTimelineWriteSource(write) {
      const bridge = input.getSurfaceBridge()
      if (!bridge || !write) return () => undefined
      return bridge.onTimelineWrite(({ binding, ...request }) => {
        const guard = requestGuard(binding, request.signal)
        return write({ ...request, ...guard })
      })
    },
    registerAssetReadSource(read) {
      const bridge = input.getSurfaceBridge()
      if (!bridge || !read) return () => undefined
      return bridge.onAssetRead(({ binding, ...request }) => {
        const state = current
        if (!state || !state.binding)
          throw new SurfacePortWireError(state ? 'surface_port_suspended' : 'surface_port_unavailable')
        if (!sameBinding(binding, state.binding)) throw new SurfacePortWireError('surface_port_stale')
        return read(request)
      })
    },
    registerExportReadSource(read) {
      const bridge = input.getSurfaceBridge()
      if (!bridge || !read) return () => undefined
      return bridge.onExportRead(({ binding, ...request }) => {
        const state = current
        if (!state || !state.binding)
          throw new SurfacePortWireError(state ? 'surface_port_suspended' : 'surface_port_unavailable')
        if (!sameBinding(binding, state.binding)) throw new SurfacePortWireError('surface_port_stale')
        return read(request)
      })
    },
    registerExportWriteSource(write) {
      const bridge = input.getSurfaceBridge()
      if (!bridge || !write) return () => undefined
      return bridge.onExportWrite(({ binding, ...request }) => {
        const guard = requestGuard(binding, request.signal)
        return write({ ...request, ...guard })
      })
    },
  })
  return coordinator
}
