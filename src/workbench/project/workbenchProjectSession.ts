import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useShotVerifyStore } from '../generationCanvas/agent/shotVerifyStore'
import { useWorkbenchStore } from '../workbenchStore'
import { emitCanvasGesture, getCanvasEventLastSeq, seedCanvasEventLastSeq } from '../generationCanvas/events/canvasEventEmitter'
import { getDesktopBridge } from '../../desktop/bridge'
import { setDesktopActiveProjectId } from '../../desktop/activeProject'
import type { WorkbenchProjectPayload, WorkbenchProjectRecordV1 } from './projectRecordSchema'
import type { ProjectHydrationGuard } from './projectCanvasReadSurface'

export function readCurrentWorkbenchProjectPayload(): WorkbenchProjectPayload {
  const workbench = useWorkbenchStore.getState()
  const generation = useGenerationCanvasStore.getState()
  const activeStoryboardEntry = workbench.activeDocumentId
    ? workbench.storyboardPlans[workbench.activeDocumentId]
    : undefined
  return {
    workbenchDocuments: workbench.workbenchDocuments,
    activeDocumentId: workbench.activeDocumentId,
    timeline: workbench.timeline,
    // S5-b-0:持久化走 document 视图(选区是会话态不进项目文件)
    generationCanvas: generation.readDocumentSnapshot(),
    categories: workbench.categories,
    // S5-b-1:尾部重放游标(append 回执维护;回执延迟导致略旧也安全——reducer 幂等)
    generationCanvasLastSeq: getCanvasEventLastSeq(),
    // P4:每篇原稿的分镜方案映射随项目落盘（P0-6 从单字段升级）。
    storyboardPlans: workbench.storyboardPlans,
    storyboardDesignsByDocumentId: workbench.storyboardDesignsByDocumentId,
    // Keep the deprecated single-plan fields as a derived read-side bridge for
    // older project consumers. The document-keyed map remains the only write
    // source; this alias always follows the active document's projection.
    ...(activeStoryboardEntry
      ? {
          storyboardPlan: activeStoryboardEntry.plan,
          storyboardPlanCommitted: activeStoryboardEntry.committed,
        }
      : {}),
  }
}

export function restoreWorkbenchProjectPayload(payload: WorkbenchProjectPayload): void {
  useWorkbenchStore.getState().hydrateWorkbenchDocuments(
    payload.workbenchDocuments ?? (payload.workbenchDocument ? [payload.workbenchDocument] : []),
    payload.activeDocumentId ?? null,
  )
  useWorkbenchStore.getState().setTimeline(payload.timeline)
  useWorkbenchStore.getState().setCategories(payload.categories)
  // P4：恢复整套分镜方案映射。用 hydrateStoryboardDesigns（非 setStoryboardPlan）载入不标脏。
  const store = useWorkbenchStore.getState()
  store.hydrateStoryboardDesigns(
    payload.storyboardDesignsByDocumentId ?? {},
    payload.storyboardPlans ?? {},
  )
  useGenerationCanvasStore.getState().restoreSnapshot(payload.generationCanvas)
}

/**
 * S5-b-1 崩溃恢复:restore 之后调——重放快照没盖到的事件尾巴,再以"含尾巴的后态"
 * 发 genesis(顺序铁律:genesis 在尾部重放之后,否则磁盘日志最终态丢尾巴)。
 * 老项目(payload 无 lastSeq 字段)跳过重放只发 genesis——不拿整本日志去覆盖快照。
 */
export async function replayCanvasEventTailAndSealGenesis(
  projectId: string,
  payload: WorkbenchProjectPayload,
  guard: ProjectHydrationGuard,
): Promise<void> {
  guard.assertCurrent()
  const lastSeq = Number(payload.generationCanvasLastSeq) || 0
  seedCanvasEventLastSeq(lastSeq)
  const api = getDesktopBridge()?.events
  if (api && projectId && payload.generationCanvasLastSeq != null && lastSeq > 0) {
    let events: Awaited<ReturnType<typeof api.read>>['events'] = []
    try {
      const reply = await api.read(projectId, lastSeq)
      guard.assertCurrent()
      events = reply.events
    } catch {
      // A stale epoch is not an event-log fallback. Re-assert outside the
      // catch so supersession is never swallowed as an ordinary read error.
      guard.assertCurrent()
    }
    if (events.length) {
      const canvasTail = (events as { type?: string; payload?: Record<string, unknown>; seq?: number }[])
        .filter((event) => typeof event?.type === 'string' && event.type.startsWith('canvas.') && event.payload)
      if (canvasTail.length) {
        guard.assertCurrent()
        useGenerationCanvasStore.getState().applyEventTail(canvasTail as { type: string; payload: Record<string, unknown> }[])
        seedCanvasEventLastSeq(Math.max(lastSeq, ...canvasTail.map((event) => Number(event.seq) || 0)))
      }
    }
  }
  guard.assertCurrent()
  const post = useGenerationCanvasStore.getState()
  emitCanvasGesture([
    { type: 'canvas.snapshot.restored', payload: { snapshot: { nodes: post.nodes, edges: post.edges, groups: post.groups } } },
  ])
}

export type WorkbenchProjectSaveFn = (
  projectId: string,
  payload: WorkbenchProjectPayload,
  projectName: string,
) => Promise<WorkbenchProjectRecordV1>

export async function saveCurrentWorkbenchProject(
  projectId: string,
  projectName: string,
  saveProject: WorkbenchProjectSaveFn,
): Promise<WorkbenchProjectRecordV1> {
  return saveProject(projectId, readCurrentWorkbenchProjectPayload(), projectName)
}

type ActiveWorkbenchProjectSaveTarget = {
  projectId: string
  projectName: string
  canPersist: () => boolean
  saveProject: WorkbenchProjectSaveFn
  onSaved: (record: WorkbenchProjectRecordV1) => void
  /** Cancel the debounce scheduled for the same in-memory revision before an
   * immediate canonical write starts. Otherwise that old timer can save the
   * identical payload again after a later decline and advance project.revision
   * even though the declined request changed nothing. */
  beforeImmediateSave?: () => Promise<void>
}

let activeWorkbenchProjectSaveTarget: ActiveWorkbenchProjectSaveTarget | null = null
const activeWorkbenchProjectSaveTargetListeners = new Set<() => void>()
const ACTIVE_PROJECT_SAVE_TARGET_WAIT_MS = 5_000

function notifyActiveWorkbenchProjectSaveTarget(): void {
  activeWorkbenchProjectSaveTargetListeners.forEach((listener) => listener())
}

export function setActiveWorkbenchProjectSaveTarget(target: ActiveWorkbenchProjectSaveTarget | null): void {
  activeWorkbenchProjectSaveTarget = target
  setDesktopActiveProjectId(target?.projectId ?? '')
  // 当前工作台项目是审片结果的所有权边界。绑定新项目时同步切换 shot verify scope；
  // activateProject 对同 id 幂等，不会因保存订阅重绑而误清本项目预算。
  useShotVerifyStore.getState().activateProject(target?.projectId)
  notifyActiveWorkbenchProjectSaveTarget()
}

export function clearActiveWorkbenchProjectSaveTarget(projectId?: string): void {
  if (projectId && activeWorkbenchProjectSaveTarget?.projectId !== projectId) return
  activeWorkbenchProjectSaveTarget = null
  notifyActiveWorkbenchProjectSaveTarget()
}

/**
 * Wait for the single active project save owner to be installed.  Hydration
 * publishes the project before React's persistence effect binds its target;
 * canonical MCP writes may therefore reach the renderer in that short window.
 * Waiting on the owner signal keeps the receipt barrier fail-closed without
 * creating a second writer or relying on a runner sleep.
 */
export function waitForActiveWorkbenchProjectSaveTarget(projectId: string): boolean | Promise<boolean> {
  const current = activeWorkbenchProjectSaveTarget
  if (current?.projectId === projectId && current.canPersist()) return true
  return new Promise((resolve) => {
    let settled = false
    const finish = (ready: boolean): void => {
      if (settled) return
      settled = true
      activeWorkbenchProjectSaveTargetListeners.delete(listener)
      if (timer) clearTimeout(timer)
      resolve(ready)
    }
    const listener = (): void => {
      const target = activeWorkbenchProjectSaveTarget
      // A project cutover clears the owner before installing the replacement.
      // Resolve that waiter as stale instead of leaving a caller pending until
      // the timeout while another project owns the surface.
      if (!target || target.projectId !== projectId) {
        finish(false)
        return
      }
      if (!target.canPersist()) return
      finish(true)
    }
    activeWorkbenchProjectSaveTargetListeners.add(listener)
    const timer = setTimeout(() => finish(false), ACTIVE_PROJECT_SAVE_TARGET_WAIT_MS)
  })
}

/** 当前活动 workbench 项目 id（单一真相源）—— 抽帧落素材需要它，runner 作用域本身拿不到。 */
export function getActiveWorkbenchProjectId(): string | null {
  return activeWorkbenchProjectSaveTarget?.projectId ?? null
}

export async function persistActiveWorkbenchProjectNow(): Promise<WorkbenchProjectRecordV1 | null> {
  const target = activeWorkbenchProjectSaveTarget
  if (!target || !target.canPersist()) return null
  await target.beforeImmediateSave?.()
  const saved = await saveCurrentWorkbenchProject(target.projectId, target.projectName, target.saveProject)
  target.onSaved(saved)
  return saved
}

export type WorkbenchProjectPersistenceOptions = {
  projectId: string
  projectName: string
  isHydrating: () => boolean
  canPersist: () => boolean
  saveProject: WorkbenchProjectSaveFn
  onSaved: (record: WorkbenchProjectRecordV1) => void
  onSaveError?: (error: unknown) => void
}

type QueuedWorkbenchProjectSave = {
  projectId: string
  projectName: string
  payload: WorkbenchProjectPayload
}

const PROJECT_SAVE_DEBOUNCE_MS = 700

function createProjectSaveQueue(input: {
  saveProject: WorkbenchProjectSaveFn
  onSaved: (record: WorkbenchProjectRecordV1) => void
  onSaveError?: (error: unknown) => void
  isActive: () => boolean
}) {
  let running = false
  let pending: QueuedWorkbenchProjectSave | null = null
  const idleWaiters: Array<() => void> = []

  const notifyIdle = () => {
    if (running || pending) return
    const waiters = idleWaiters.splice(0)
    waiters.forEach((resolve) => resolve())
  }

  const drain = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      while (pending && input.isActive()) {
        const next = pending
        pending = null
        try {
          const saved = await input.saveProject(next.projectId, next.payload, next.projectName)
          if (input.isActive()) input.onSaved(saved)
        } catch (error: unknown) {
          if (input.isActive()) input.onSaveError?.(error)
        }
      }
    } finally {
      running = false
      if (pending && input.isActive()) void drain()
      notifyIdle()
    }
  }

  return {
    enqueue(save: QueuedWorkbenchProjectSave): void {
      pending = save
      void drain()
    },
    cancelPending(): void {
      pending = null
      notifyIdle()
    },
    whenIdle(): Promise<void> {
      if (!running && !pending) return Promise.resolve()
      return new Promise((resolve) => idleWaiters.push(resolve))
    },
  }
}

export function subscribeWorkbenchProjectPersistence(options: WorkbenchProjectPersistenceOptions): () => void {
  let disposed = false
  let saveScheduled = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const saveQueue = createProjectSaveQueue({
    saveProject: options.saveProject,
    onSaved: options.onSaved,
    onSaveError: options.onSaveError,
    isActive: () => !disposed,
  })
  const flushSave = async () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    saveScheduled = false
    if (disposed || options.isHydrating() || !options.canPersist()) return
    saveQueue.enqueue({
      projectId: options.projectId,
      projectName: options.projectName,
      payload: readCurrentWorkbenchProjectPayload(),
    })
  }
  const flushPendingSave = () => {
    if (!saveScheduled || disposed) return
    void flushSave()
  }
  const saveIfReady = () => {
    if (options.isHydrating() || !options.canPersist()) return
    saveScheduled = true
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { void flushSave() }, PROJECT_SAVE_DEBOUNCE_MS)
  }
  const unsubscribeWorkbench = useWorkbenchStore.subscribe((state) => state.persistRevision, saveIfReady)
  const unsubscribeGeneration = useGenerationCanvasStore.subscribe((state) => state.persistRevision, saveIfReady)
  window.addEventListener('pagehide', flushPendingSave)
  window.addEventListener('beforeunload', flushPendingSave)
  setActiveWorkbenchProjectSaveTarget({
    projectId: options.projectId,
    projectName: options.projectName,
    canPersist: () => !options.isHydrating() && options.canPersist(),
    saveProject: options.saveProject,
    onSaved: options.onSaved,
    beforeImmediateSave: async () => {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      saveScheduled = false
      saveQueue.cancelPending()
      await saveQueue.whenIdle()
    },
  })
  return () => {
    // Cancel the debounce timer so it doesn't fire after disposal
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    window.removeEventListener('pagehide', flushPendingSave)
    window.removeEventListener('beforeunload', flushPendingSave)
    unsubscribeWorkbench()
    unsubscribeGeneration()
    clearActiveWorkbenchProjectSaveTarget(options.projectId)
    // CRITICAL: Flush any pending save BEFORE marking disposed.
    // We bypass the async save queue (whose drain loop short-circuits on
    // `!isActive` i.e. `disposed`) and call saveProject directly. This is
    // essential to prevent data loss when the subscription is torn down by
    // a Vite hot-reload, a project rename, or a component unmount while
    // there are debounced changes still pending.
    if (saveScheduled || saveTimer !== null) {
      saveScheduled = false
      const payload = readCurrentWorkbenchProjectPayload()
      const finalProjectId = options.projectId
      const finalProjectName = options.projectName
      void options.saveProject(finalProjectId, payload, finalProjectName)
        .then((record) => { options.onSaved(record) })
        .catch((error: unknown) => { options.onSaveError?.(error) })
    }
    disposed = true
  }
}
