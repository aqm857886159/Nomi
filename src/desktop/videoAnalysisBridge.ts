import type {
  VideoAnalysisEvidence,
  VideoAnalysisResult,
  VideoAnalysisTask,
} from '../../electron/videoAnalysis/contracts'
import type { VideoAnalysisHealthProjection } from '../../electron/videoAnalysis/ipc'

export type DesktopVideoAnalysisBridge = {
  start: (payload: { projectId: string; assetUrl: string; sourceNodeId: string }) => Promise<VideoAnalysisTask>
  list: (projectId: string) => Promise<VideoAnalysisTask[]>
  read: (projectId: string, analysisId: string) => Promise<{
    task: VideoAnalysisTask | null
    result: VideoAnalysisResult | null
    evidence: VideoAnalysisEvidence | null
  }>
  cancel: (projectId: string, analysisId: string) => Promise<VideoAnalysisTask>
  cleanup: (projectId: string) => Promise<{ attempted: number; removed: number; failed: number }>
  health: () => Promise<VideoAnalysisHealthProjection>
}
