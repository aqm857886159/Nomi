import { create } from 'zustand'

import type { VideoAnalysisTask } from '../../../electron/videoAnalysis/contracts'
import { getDesktopBridge } from '../../desktop/bridge'

type VideoAnalysisProjectionState = {
  tasksByProject: Record<string, VideoAnalysisTask[]>
  setTasks: (projectId: string, tasks: VideoAnalysisTask[]) => void
  publishTask: (task: VideoAnalysisTask) => void
}

const EMPTY_TASKS: VideoAnalysisTask[] = []

export const useVideoAnalysisProjectionStore = create<VideoAnalysisProjectionState>((set) => ({
  tasksByProject: {},
  setTasks: (projectId, tasks) => set((state) => ({
    tasksByProject: { ...state.tasksByProject, [projectId]: tasks },
  })),
  publishTask: (task) => set((state) => {
    const current = state.tasksByProject[task.projectId] ?? EMPTY_TASKS
    return {
      tasksByProject: {
        ...state.tasksByProject,
        [task.projectId]: [task, ...current.filter((candidate) => candidate.analysisId !== task.analysisId)],
      },
    }
  }),
}))

export function selectVideoAnalysisTasks(
  state: VideoAnalysisProjectionState,
  projectId: string | null | undefined,
): VideoAnalysisTask[] {
  return projectId ? (state.tasksByProject[projectId] ?? EMPTY_TASKS) : EMPTY_TASKS
}

export async function refreshVideoAnalysisTasks(projectId: string | null | undefined): Promise<VideoAnalysisTask[]> {
  const list = getDesktopBridge()?.videoAnalysis?.list
  if (!projectId || !list) return EMPTY_TASKS
  const tasks = await list(projectId)
  useVideoAnalysisProjectionStore.getState().setTasks(projectId, tasks)
  return tasks
}
