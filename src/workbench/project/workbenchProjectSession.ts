import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbenchStore'
import { emitCanvasGesture, getCanvasEventLastSeq, seedCanvasEventLastSeq } from '../generationCanvas/events/canvasEventEmitter'
import { getDesktopBridge } from '../../desktop/bridge'
import type { WorkbenchProjectPayload, WorkbenchProjectRecordV1 } from './projectRecordSchema'

export function readCurrentWorkbenchProjectPayload(): WorkbenchProjectPayload {
  const workbench = useWorkbenchStore.getState()
  const generation = useGenerationCanvasStore.getState()
  return {
    workbenchDocument: workbench.workbenchDocument,
    timeline: workbench.timeline,
    // S5-b-0:持久化走 document 视图(选区是会话态不进项目文件)
    generationCanvas: generation.readDocumentSnapshot(),
    categories: workbench.categories,
    // S5-b-1:尾部重放游标(append 回执维护;回执延迟导致略旧也安全——reducer 幂等)
    generationCanvasLastSeq: getCanvasEventLastSeq(),
    // P0-6:分镜方案随项目落盘(此前纯内存→切项目/重载蒸发)。
    storyboardPlan: workbench.storyboardPlan,
    // 卡片回看:落画布状态随项目落盘(草稿/已落画布),否则重开项目分不清卡片该显哪态。
    storyboardPlanCommitted: workbench.storyboardPlanCommitted,
  }
}

export function restoreWorkbenchProjectPayload(payload: WorkbenchProjectPayload): void {
  useWorkbenchStore.getState().setWorkbenchDocument(payload.workbenchDocument)
  useWorkbenchStore.getState().setTimeline(payload.timeline)
  useWorkbenchStore.getState().setCategories(payload.categories)
  // P0-6:分镜方案随项目恢复。restore 在 hydrate 里先于 swapCreationAiProject 跑,故由它负责
  // 载入本项目方案(swap 不再清,见 workbenchStore),老项目无字段则置 null。
  // 用 hydrateStoryboardPlan(非 setStoryboardPlan):载入不自动展开编辑器、不标脏。
  useWorkbenchStore.getState().hydrateStoryboardPlan(payload.storyboardPlan ?? null, payload.storyboardPlanCommitted ?? false)
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
): Promise<void> {
  const lastSeq = Number(payload.generationCanvasLastSeq) || 0
  seedCanvasEventLastSeq(lastSeq)
  const api = getDesktopBridge()?.events
  if (api && projectId && payload.generationCanvasLastSeq != null && lastSeq > 0) {
    try {
      const { events } = await api.read(projectId, lastSeq)
      const canvasTail = (events as { type?: string; payload?: Record<string, unknown>; seq?: number }[])
        .filter((event) => typeof event?.type === 'string' && event.type.startsWith('canvas.') && event.payload)
      if (canvasTail.length) {
        useGenerationCanvasStore.getState().applyEventTail(canvasTail as { type: string; payload: Record<string, unknown> }[])
        seedCanvasEventLastSeq(Math.max(lastSeq, ...canvasTail.map((event) => Number(event.seq) || 0)))
      }
    } catch {
      /* 旁路:读尾巴失败退回纯快照,不影响打开项目 */
    }
  }
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
}

let activeWorkbenchProjectSaveTarget: ActiveWorkbenchProjectSaveTarget | null = null

export function setActiveWorkbenchProjectSaveTarget(target: ActiveWorkbenchProjectSaveTarget | null): void {
  activeWorkbenchProjectSaveTarget = target
  // 能力核 A/B 守卫：把「当前窗口打开的项目」上报主进程——外部 CLI/MCP 据此拒绝直写正在编辑的工程
  // （防内存 store 防抖回盘覆盖外部改动）。可选口（老 preload 无 capability 即 no-op）。
  getDesktopBridge()?.capability?.setActiveProject(target?.projectId ?? '')
}

export function clearActiveWorkbenchProjectSaveTarget(projectId?: string): void {
  if (projectId && activeWorkbenchProjectSaveTarget?.projectId !== projectId) return
  activeWorkbenchProjectSaveTarget = null
}

/** 当前活动 workbench 项目 id（单一真相源）—— 抽帧落素材需要它，runner 作用域本身拿不到。 */
export function getActiveWorkbenchProjectId(): string | null {
  return activeWorkbenchProjectSaveTarget?.projectId ?? null
}

export async function persistActiveWorkbenchProjectNow(): Promise<WorkbenchProjectRecordV1 | null> {
  const target = activeWorkbenchProjectSaveTarget
  if (!target || !target.canPersist()) return null
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
    }
  }

  return {
    enqueue(save: QueuedWorkbenchProjectSave): void {
      pending = save
      void drain()
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
