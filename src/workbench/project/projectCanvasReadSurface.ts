import type {
  CanvasReadSurfaceBridge,
  CapturedCanvasReadSnapshotHandleWire,
  SurfacePortBindingWire,
  SurfaceSuspensionWire,
} from '../../../electron/shared/surfacePortBinding'
import { sameSurfacePortBindingWire, settleSurfacePortHandler, surfacePortFailure, SurfacePortWireError } from '../../../electron/shared/surfacePortBinding'
import { sameProjectAgentBinding, type ProjectBinding } from '../../../electron/shared/projectBinding'
import type { CanvasWriteInput, CanvasWriteOperation } from '../../../electron/shared/agentCapabilities/canvasWrite'
import type { DirectorWriteOperation } from '../../../electron/shared/agentCapabilities/directorWrite'
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
export type ProjectExecutionContext = ProjectSurfaceExecutionGuard & Readonly<{ binding: ProjectBinding }>

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
      operation: CanvasWriteOperation | CanvasDeleteInput['operation'] | DirectorWriteOperation
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
    read: (input: { input: TimelineReadInput; target: unknown; preconditions: unknown; projectId: string }) => unknown,
  ): () => void
  registerTimelineWriteSource(
    write: (input: {
      input: TimelineWriteInput
      target: unknown
      preconditions: unknown
      receiptProposalId: string
      approvalId: string
      actionHash: string
      projectId: string
    } & ProjectSurfaceExecutionGuard) => unknown,
  ): () => void
  registerAssetReadSource(
    read: (input: { input: AssetReadInput; target: unknown; preconditions: unknown; projectId: string }) => unknown,
  ): () => void
  registerExportReadSource(
    read: (input: { input: ExportReadInput; target: unknown; preconditions: unknown; projectId: string }) => unknown,
  ): () => void
  registerExportWriteSource(
    write: (input: {
      input: ExportWriteInput
      target: unknown
      preconditions: unknown
      receiptProposalId: string
      approvalId: string
      actionHash: string
      projectId: string
    } & ProjectSurfaceExecutionGuard) => unknown,
  ): () => void
}>

let registeredCoordinator: ProjectCanvasReadSurfaceCoordinator | null = null
/** Module-private: only the issuance points below can mint a project lifetime from a coordinator. */
const projectContextIssuers = new WeakMap<ProjectCanvasReadSurfaceCoordinator, () => ProjectExecutionContext>()
const projectOpenedListeners = new Set<(project: ProjectExecutionContext) => void>()
function notifyProjectOpened(coordinator: ProjectCanvasReadSurfaceCoordinator): void {
  if (registeredCoordinator !== coordinator) return
  for (const listener of [...projectOpenedListeners]) withProjectAction(listener)
}
let registeredCoordinatorLifetime: AbortController | null = null

/** Share the one coordinator object, never a copied project/binding scalar. */
export function registerProjectCanvasReadSurfaceCoordinator(
  coordinator: ProjectCanvasReadSurfaceCoordinator,
): () => void {
  if (registeredCoordinator && registeredCoordinator !== coordinator) {
    throw new SurfacePortWireError('surface_owner_mismatch')
  }
  if (!registeredCoordinator) registeredCoordinatorLifetime = new AbortController()
  registeredCoordinator = coordinator
  return () => {
    if (registeredCoordinator === coordinator) {
      registeredCoordinatorLifetime?.abort()
      registeredCoordinatorLifetime = null
      registeredCoordinator = null
    }
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
    operation: CanvasWriteOperation | CanvasDeleteInput['operation'] | DirectorWriteOperation
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
  readTimeline?: (input: { input: TimelineReadInput; target: unknown; preconditions: unknown; projectId: string }) => unknown,
  writeTimeline?: (input: {
    input: TimelineWriteInput
    target: unknown
    preconditions: unknown
    receiptProposalId: string
    approvalId: string
    actionHash: string
    projectId: string
  } & ProjectSurfaceExecutionGuard) => unknown,
  additionalSources?: Readonly<{
    readAsset?: (input: { input: AssetReadInput; target: unknown; preconditions: unknown; projectId: string }) => unknown
    readExport?: (input: { input: ExportReadInput; target: unknown; preconditions: unknown; projectId: string }) => unknown
    writeExport?: (input: {
      input: ExportWriteInput
      target: unknown
      preconditions: unknown
      receiptProposalId: string
      approvalId: string
      actionHash: string
      projectId: string
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

/** Project IO keeps a lifetime, not the page's transport capture. Module-private by design. */
function captureCurrentProjectExecutionContext(): ProjectExecutionContext {
  const coordinator = registeredCoordinator
  const lifetime = registeredCoordinatorLifetime
  const issue = coordinator ? projectContextIssuers.get(coordinator) : undefined
  if (!coordinator || !lifetime || !issue) throw new SurfacePortWireError('project_identity_unavailable')
  const context = issue()
  return Object.freeze({ ...context, signal: AbortSignal.any([context.signal, lifetime.signal]), assertCurrent() {
    if (lifetime.signal.aborted || registeredCoordinator !== coordinator) throw new SurfacePortWireError('project_binding_stale')
    context.assertCurrent()
  } })
}

/**
 * The single renderer issuance point for project IO authority (key = trusted window + project).
 * A user action calls it synchronously as its first step, before any await, and receives the
 * originating project lifetime; everything downstream only accepts that context and can never
 * re-read "the current project". With no open project the action does not start: `unavailable`
 * (or undefined) is returned. Late issuance after an await is rejected by
 * projectActionIssuance.contract.test.ts.
 */
export function withProjectAction<R>(run: (project: ProjectExecutionContext) => R): R | undefined
export function withProjectAction<R>(run: (project: ProjectExecutionContext) => R, unavailable: () => R): R
export function withProjectAction<R>(run: (project: ProjectExecutionContext) => R, unavailable?: () => R): R | undefined {
  let project: ProjectExecutionContext
  try {
    project = captureCurrentProjectExecutionContext()
  } catch (error) {
    if (!isProjectImportCancellation(error)) throw error
    return unavailable?.()
  }
  return run(project)
}

/**
 * Issuance for project-scoped background effects that start when a project becomes available
 * (e.g. repairing stored results after open). The listener receives each newly committed project's
 * lifetime, including the one already open at subscription; it never reads "the current project".
 */
export function subscribeProjectOpened(listener: (project: ProjectExecutionContext) => void): () => void {
  projectOpenedListeners.add(listener)
  withProjectAction(listener)
  return () => { projectOpenedListeners.delete(listener) }
}

/**
 * Issuance point for work main addressed to a project at the moment main committed it (the
 * open-project canvas reconciliation). Main's commit fires its listeners before this window has
 * processed the commit reply, so such a request can arrive while the window is still adopting that
 * very project; issuing "unavailable" there turned every open-time reconciliation into a logged
 * warning (S1-5, 2026-10-03). Resolves with the lifetime this window has open right now, or — when
 * none is open yet — with the next lifetime it adopts; `undefined` if none is adopted in time.
 * The caller still checks that the adopted project is the one it was addressed to.
 */
export function whenProjectAdopted(timeoutMs: number): Promise<ProjectExecutionContext | undefined> {
  const open = withProjectAction((project) => project)
  if (open) return Promise.resolve(open)
  return new Promise((resolve) => {
    const listener = (project: ProjectExecutionContext): void => {
      settle()
      resolve(project)
    }
    const timer = setTimeout(() => {
      settle()
      resolve(undefined)
    }, timeoutMs)
    const settle = (): void => {
      clearTimeout(timer)
      projectOpenedListeners.delete(listener)
    }
    projectOpenedListeners.add(listener)
  })
}

/**
 * Issuance point for actions that main started on its own trusted input (the global screenshot
 * hotkey). Main fixes its committed binding before its awaits and names it in the event; the
 * renderer adopts that project lifetime only while that very binding is still this window's
 * current epoch. The wire identifies the action, it never authorizes it; a mismatch means the
 * project changed in between, so the action is cancelled (undefined).
 */
export function withMainProjectAction<R>(surfaceBinding: unknown, run: (project: ProjectExecutionContext) => R): R | undefined {
  const current = captureCurrentProjectCanvasReadSurfaceBinding()
  const wire = surfaceBinding && typeof surfaceBinding === 'object' ? surfaceBinding as Partial<SurfacePortBindingWire> : null
  if (!current || !wire?.binding || typeof wire.binding !== 'object' || !sameBinding(wire as SurfacePortBindingWire, current)) return undefined
  return withProjectAction(run)
}

/**
 * Routing/display predicate: is this project the one open in this window right now? It answers a
 * yes/no question and never hands out authority; anything that acts must hold an issued context.
 */
export function isProjectOpen(projectId: string | null | undefined): boolean {
  const id = String(projectId || '').trim()
  return Boolean(id) && withProjectAction((project) => project.binding.projectId === id) === true
}

/**
 * Background-run predicate: is the run's own project (full identity fixed at submission) the one
 * loaded in this window right now? Background work routes its store writes by this answer and
 * otherwise writes the project on disk; it never adopts the loaded project as its target.
 */
export function isProjectBindingOpen(binding: ProjectBinding): boolean {
  return withProjectAction((project) => sameProjectAgentBinding(project.binding, binding)) === true
}

/** Async UI cleanup must not update a replacement project's component state. */
export function isProjectExecutionContextCurrent(context: ProjectExecutionContext | undefined): boolean {
  if (!context) return false
  try { context.assertCurrent(); return true } catch { return false }
}

export function isProjectImportCancellation(error: unknown): boolean {
  const { code } = surfacePortFailure(error)
  return code === 'capability_cancelled' || code === 'project_binding_stale' || code === 'project_identity_unavailable'
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
  interactionController: AbortController
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

// C2：这一份与主进程登记表那一份维度完全相同（13 维），是逐字抄的第二遍。
// 抄得再准也只是「今天还一致」——上游给 SurfacePortBindingWire 加一个字段时，
// 三层里跟上的那几层和没跟上的那层就开始给出不同答案。现在只从 owner import。
const sameBinding = sameSurfacePortBindingWire

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
    state.interactionController.abort()
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
      current?.interactionController.abort()
      const bridge = input.getSurfaceBridge()
      const state: EpochState = {
        id: ++sequence,
        controller: new AbortController(),
        interactionController: new AbortController(),
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
      // A newer hydration may supersede this one before anyone awaits its suspension (a quick
      // second switch). That is expected cancellation, not a failure: awaiters still receive the
      // rejection through awaitWhileCurrent, but the bare promise must not surface as an
      // unhandled rejection. Anything else stays unhandled-visible.
      state.suspensionPromise.catch((error: unknown) => {
        if (!(error instanceof ProjectHydrationSupersededError)) throw error
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
          notifyProjectOpened(coordinator)
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
      return bridge.onCanvasRead(({ binding }) => settleSurfacePortHandler(() => {
        const state = current
        if (!state || !state.binding) {
          throw new SurfacePortWireError(state ? 'surface_port_suspended' : 'surface_port_unavailable')
        }
        if (!sameBinding(binding, state.binding)) throw new SurfacePortWireError('surface_port_stale')
        // The preload invokes this handler synchronously; the store snapshot is
        // therefore captured against the exact binding before any promise turn.
        return readSnapshot()
      }))
    },
    registerDocumentReadSource(readDocument) {
      const bridge = input.getSurfaceBridge()
      if (!bridge || !readDocument) return () => undefined
      return bridge.onDocumentRead(({ binding, documentId, scope }) => settleSurfacePortHandler(() => {
        const state = current
        if (!state || !state.binding)
          throw new SurfacePortWireError(state ? 'surface_port_suspended' : 'surface_port_unavailable')
        if (!sameBinding(binding, state.binding)) throw new SurfacePortWireError('surface_port_stale')
        return readDocument({ documentId, scope })
      }))
    },
    registerDocumentWriteSource(writeDocument) {
      const bridge = input.getSurfaceBridge()
      if (!bridge || !writeDocument) return () => undefined
      return bridge.onDocumentWrite(({ binding, signal, documentId, operation, content, target, preconditions }) => settleSurfacePortHandler(() => {
        const guard = requestGuard(binding, signal)
        return writeDocument({ documentId, operation, content, target, preconditions, ...guard })
      }))
    },
    registerCanvasWriteCaptureSource(capture) {
      const bridge = input.getSurfaceBridge()
      if (!bridge || !capture) return () => undefined
      return bridge.onCanvasWriteCapture(({ binding, operation, input, nodeId }) => settleSurfacePortHandler(() => {
        const state = current
        if (!state || !state.binding)
          throw new SurfacePortWireError(state ? 'surface_port_suspended' : 'surface_port_unavailable')
        if (!sameBinding(binding, state.binding)) throw new SurfacePortWireError('surface_port_stale')
        return capture({
          operation,
          ...(input !== undefined ? { input: input as CanvasWriteInput } : {}),
          ...(nodeId ? { nodeId } : {}),
        })
      }))
    },
    registerCanvasWriteExecuteSource(execute) {
      const bridge = input.getSurfaceBridge()
      if (!bridge || !execute) return () => undefined
      return bridge.onCanvasWriteExecute(({ binding, ...request }) => settleSurfacePortHandler(() => {
        const guard = requestGuard(binding, request.signal)
        return execute({ ...request, ...guard })
      }))
    },
    registerTimelineReadSource(read) {
      const bridge = input.getSurfaceBridge()
      if (!bridge || !read) return () => undefined
      return bridge.onTimelineRead(({ binding, ...request }) => settleSurfacePortHandler(() => {
        const state = current
        if (!state || !state.binding)
          throw new SurfacePortWireError(state ? 'surface_port_suspended' : 'surface_port_unavailable')
        if (!sameBinding(binding, state.binding)) throw new SurfacePortWireError('surface_port_stale')
        return read({ ...request, projectId: binding.binding.projectId })
      }))
    },
    registerTimelineWriteSource(write) {
      const bridge = input.getSurfaceBridge()
      if (!bridge || !write) return () => undefined
      return bridge.onTimelineWrite(({ binding, ...request }) => settleSurfacePortHandler(() => {
        const guard = requestGuard(binding, request.signal)
        return write({ ...request, ...guard, projectId: binding.binding.projectId })
      }))
    },
    registerAssetReadSource(read) {
      const bridge = input.getSurfaceBridge()
      if (!bridge || !read) return () => undefined
      return bridge.onAssetRead(({ binding, ...request }) => settleSurfacePortHandler(() => {
        const state = current
        if (!state || !state.binding)
          throw new SurfacePortWireError(state ? 'surface_port_suspended' : 'surface_port_unavailable')
        if (!sameBinding(binding, state.binding)) throw new SurfacePortWireError('surface_port_stale')
        return read({ ...request, projectId: binding.binding.projectId })
      }))
    },
    registerExportReadSource(read) {
      const bridge = input.getSurfaceBridge()
      if (!bridge || !read) return () => undefined
      return bridge.onExportRead(({ binding, ...request }) => settleSurfacePortHandler(() => {
        const state = current
        if (!state || !state.binding)
          throw new SurfacePortWireError(state ? 'surface_port_suspended' : 'surface_port_unavailable')
        if (!sameBinding(binding, state.binding)) throw new SurfacePortWireError('surface_port_stale')
        return read({ ...request, projectId: binding.binding.projectId })
      }))
    },
    registerExportWriteSource(write) {
      const bridge = input.getSurfaceBridge()
      if (!bridge || !write) return () => undefined
      return bridge.onExportWrite(({ binding, ...request }) => settleSurfacePortHandler(() => {
        const guard = requestGuard(binding, request.signal)
        return write({ ...request, ...guard, projectId: binding.binding.projectId })
      }))
    },
  })
  // The lifetime is the hydration epoch's interaction controller: page changes keep it, any
  // project replacement or release aborts it permanently (A → B → A cannot revive).
  projectContextIssuers.set(coordinator, () => {
    const state = current
    if (!state?.binding) throw new SurfacePortWireError('project_identity_unavailable')
    const binding = Object.freeze({ ...state.binding.binding })
    const assertProjectCurrent = (): void => {
      if (current !== state || state.controller.signal.aborted || state.interactionController.signal.aborted ||
        !state.binding || !sameProjectAgentBinding(binding, state.binding.binding)) throw new SurfacePortWireError('project_binding_stale')
    }
    assertProjectCurrent()
    return Object.freeze({ binding, signal: state.interactionController.signal, assertCurrent: assertProjectCurrent })
  })
  return coordinator
}
