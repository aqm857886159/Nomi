import { useGenerationCanvasStore } from '../generationCanvasV2/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbenchStore'
import type { WorkbenchProjectPayload, WorkbenchProjectRecordV1 } from './projectRecordSchema'

export function readCurrentWorkbenchProjectPayload(): WorkbenchProjectPayload {
  const workbench = useWorkbenchStore.getState()
  const generation = useGenerationCanvasStore.getState()
  return {
    workbenchDocument: workbench.workbenchDocument,
    timeline: workbench.timeline,
    generationCanvas: generation.readSnapshot(),
  }
}

export function restoreWorkbenchProjectPayload(payload: WorkbenchProjectPayload): void {
  useWorkbenchStore.getState().setWorkbenchDocument(payload.workbenchDocument)
  useWorkbenchStore.getState().setTimeline(payload.timeline)
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
  autoSaveDelayMs?: number
}

type QueuedWorkbenchProjectSave = {
  projectId: string
  projectName: string
  payload: WorkbenchProjectPayload
}

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
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const autoSaveDelayMs = options.autoSaveDelayMs ?? 600
  const saveQueue = createProjectSaveQueue({
    saveProject: options.saveProject,
    onSaved: options.onSaved,
    onSaveError: options.onSaveError,
    isActive: () => !disposed,
  })
  const buildQueuedSave = (): QueuedWorkbenchProjectSave | null => {
    if (disposed || options.isHydrating() || !options.canPersist()) return null
    return {
      projectId: options.projectId,
      projectName: options.projectName,
      payload: readCurrentWorkbenchProjectPayload(),
    }
  }
  const flushSave = () => {
    saveTimer = null
    const next = buildQueuedSave()
    if (next) saveQueue.enqueue(next)
  }
  const saveIfReady = () => {
    if (options.isHydrating() || !options.canPersist()) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(flushSave, autoSaveDelayMs)
  }
  const unsubscribeWorkbench = useWorkbenchStore.subscribe(saveIfReady)
  const unsubscribeGeneration = useGenerationCanvasStore.subscribe(saveIfReady)
  setActiveWorkbenchProjectSaveTarget({
    projectId: options.projectId,
    projectName: options.projectName,
    canPersist: () => !options.isHydrating() && options.canPersist(),
    saveProject: options.saveProject,
    onSaved: options.onSaved,
  })
  return () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
      const pending = buildQueuedSave()
      if (pending) {
        void options.saveProject(pending.projectId, pending.payload, pending.projectName).catch((error: unknown) => {
          options.onSaveError?.(error)
        })
      }
    }
    disposed = true
    unsubscribeWorkbench()
    unsubscribeGeneration()
  }
}
