import { declareStoreLifetime } from '../project/storeLifetime'
import { create } from 'zustand'

import type { ProductionRun } from '../../../electron/productionRun/productionRunTypes'
import { productionRunApi } from './productionRunApi'
import { isProductionRunTask } from './productionRunView'

type ProductionRunStore = {
  projectId: string | null
  run: ProductionRun | null
  cursor: number
  loading: boolean
  error: string | null
  lastPolledAt: number | null
  requestedRunId: string | null
  navigationTarget: { projectId: string; runId: string; artifactId?: string } | null
  load: (projectId: string) => Promise<void>
  loadRun: (projectId: string, runId: string) => Promise<void>
  navigateTo: (projectId: string, runId: string, artifactId?: string) => Promise<void>
  poll: () => Promise<void>
  reset: () => void
}

let loadRequestEpoch = 0

function isActive(run: { status: string }): boolean {
  return run.status !== 'completed' && run.status !== 'cancelled'
}

export const useProductionRunStore = create<ProductionRunStore>()((set, get) => ({
  projectId: null,
  run: null,
  cursor: 0,
  loading: false,
  error: null,
  lastPolledAt: null,
  requestedRunId: null,
  navigationTarget: null,

  load: async (projectId) => {
    const epoch = ++loadRequestEpoch
    const clean = projectId.trim()
    if (!clean) {
      get().reset()
      return
    }
    const target = get().navigationTarget?.projectId === clean ? get().navigationTarget : null
    const requestedRunId = target?.runId ?? (get().projectId === clean ? get().requestedRunId : null)
    set({ projectId: clean, run: null, cursor: 0, loading: true, error: null, requestedRunId, ...(target ? {} : { navigationTarget: null }) })
    try {
      const summaries = await productionRunApi.list(clean)
      if (epoch !== loadRequestEpoch || get().projectId !== clean) return
      // 整卡只给任务面板里真有的任务挑：Agent 没出价的草稿 / 丢掉的计划不是任务，不能顶掉正在跑的那份。
      // 显式导航（requestedRunId）照旧直达。
      const tasks = summaries.filter(isProductionRunTask)
      const summary = (requestedRunId ? summaries.find((item) => item.runId === requestedRunId) : undefined) ?? tasks.find(isActive) ?? tasks[0]
      const run = summary ? await productionRunApi.read(clean, summary.runId) : null
      if (epoch !== loadRequestEpoch || get().projectId !== clean) return
      set({ run, cursor: run?.snapshotCursor ?? 0, loading: false, lastPolledAt: Date.now(), requestedRunId })
    } catch (error) {
      if (epoch === loadRequestEpoch && get().projectId === clean) set({ loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  },

  loadRun: async (projectId, runId) => {
    const epoch = ++loadRequestEpoch
    const cleanProjectId = projectId.trim()
    const cleanRunId = runId.trim()
    if (!cleanProjectId || !cleanRunId) return
    set({ projectId: cleanProjectId, loading: true, error: null, requestedRunId: cleanRunId })
    try {
      const run = await productionRunApi.read(cleanProjectId, cleanRunId)
      if (epoch !== loadRequestEpoch || get().projectId !== cleanProjectId) return
      set({ run, cursor: run?.snapshotCursor ?? 0, loading: false, lastPolledAt: Date.now(), requestedRunId: cleanRunId, error: run ? null : `Production run not found: ${cleanRunId}` })
    } catch (error) {
      if (epoch === loadRequestEpoch && get().projectId === cleanProjectId) set({ loading: false, requestedRunId: cleanRunId, error: error instanceof Error ? error.message : String(error), lastPolledAt: Date.now() })
    }
  },

  navigateTo: async (projectId, runId, artifactId) => {
    const cleanProjectId = projectId.trim()
    const cleanRunId = runId.trim()
    const cleanArtifactId = artifactId?.trim()
    if (!cleanProjectId || !cleanRunId) return
    set({ navigationTarget: { projectId: cleanProjectId, runId: cleanRunId, ...(cleanArtifactId ? { artifactId: cleanArtifactId } : {}) } })
    await get().loadRun(cleanProjectId, cleanRunId)
  },

  poll: async () => {
    const { projectId, run, cursor } = get()
    if (!projectId || !run) return
    try {
      const events = await productionRunApi.events(projectId, run.runId, cursor)
      if (get().projectId !== projectId || get().run?.runId !== run.runId) return
      const nextCursor = events.reduce((latest, event) => Math.max(latest, event.cursor), cursor)
      const newestRevision = events.reduce((latest, event) => Math.max(latest, event.runRevision), run.revision)
      if (newestRevision > run.revision) {
        const refreshed = await productionRunApi.read(projectId, run.runId)
        if (get().projectId === projectId && get().run?.runId === run.runId) {
          set({ run: refreshed, cursor: refreshed?.snapshotCursor ?? nextCursor, error: null, lastPolledAt: Date.now() })
        }
      } else {
        set({ cursor: nextCursor, error: null, lastPolledAt: Date.now() })
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), lastPolledAt: Date.now() })
    }
  },

  reset: () => {
    loadRequestEpoch += 1
    set({ projectId: null, run: null, cursor: 0, loading: false, error: null, lastPolledAt: null, requestedRunId: null, navigationTarget: null })
  },
}))

/**
 * C1 寿命声明：这个 store 存着 `projectId`，读侧按它自校（审计 §1.1「不清但不串」）。
 * 但「不串」不等于「该留」：离开项目后还在轮询上一个项目的 run，既白花请求，
 * 也让新项目的制作面在第一帧显示别人的进度。它的 `reset()` 会推进 `loadRequestEpoch`，
 * 在途回执落地时认得出自己已经过期。
 */
export const productionRunStoreLifetime = declareStoreLifetime({
  store: 'useProductionRunStore',
  fields: {
    projectId: 'project', run: 'project', cursor: 'project', loading: 'project',
    error: 'project', lastPolledAt: 'project', requestedRunId: 'project', navigationTarget: 'project',
  },
  releaseProject: () => useProductionRunStore.getState().reset(),
})
