import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbenchStore'
import type { WorkbenchProjectPayload, WorkbenchProjectRecordV1 } from './projectRecordSchema'

export function readCurrentWorkbenchProjectPayload(): WorkbenchProjectPayload {
  const workbench = useWorkbenchStore.getState()
  const generation = useGenerationCanvasStore.getState()
  return {
    workbenchDocument: workbench.workbenchDocument,
    timeline: workbench.timeline,
    generationCanvas: generation.readSnapshot(),
    categories: workbench.categories,
  }
}

export function restoreWorkbenchProjectPayload(payload: WorkbenchProjectPayload): void {
  useWorkbenchStore.getState().setWorkbenchDocument(payload.workbenchDocument)
  useWorkbenchStore.getState().setTimeline(payload.timeline)
  useWorkbenchStore.getState().setCategories(payload.categories)
  useGenerationCanvasStore.getState().restoreSnapshot(payload.generationCanvas)
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
}

export function clearActiveWorkbenchProjectSaveTarget(projectId?: string): void {
  if (projectId && activeWorkbenchProjectSaveTarget?.projectId !== projectId) return
  activeWorkbenchProjectSaveTarget = null
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
