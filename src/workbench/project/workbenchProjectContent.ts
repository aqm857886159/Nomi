import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbenchStore'
import { getCanvasEventLastSeq } from '../generationCanvas/events/canvasEventEmitter'
import type { WorkbenchProjectPayload } from './projectRecordSchema'

/** 写盘那份项目内容里，除「待删清单」以外的全部（待删清单记的是要删的文件，不是在用的东西）。 */
export type WorkbenchProjectContent = Omit<WorkbenchProjectPayload, 'pendingAssetDeletions'>

/**
 * 此刻已加载项目「写进项目文件的内容」——唯一的投影。存盘（`readCurrentWorkbenchProjectPayload` 在它上面加待删清单）
 * 和素材文件存活判定（`assets/projectLivenessContent.ts`）读的是同一份：写盘多一个字段，存活扫描自动多扫一个字段。
 */
export function readCurrentWorkbenchProjectContent(): WorkbenchProjectContent {
  const workbench = useWorkbenchStore.getState()
  const generation = useGenerationCanvasStore.getState()
  return {
    workbenchDocuments: workbench.workbenchDocuments,
    activeDocumentId: workbench.activeDocumentId,
    timeline: workbench.timeline,
    // S5-b-0:持久化走 document 视图(选区是会话态不进项目文件)
    generationCanvas: generation.readDocumentSnapshot(),
    categories: workbench.categories,
    // S5-b-1:尾部重放游标(append 回执维护;回执延迟导致略旧也安全——reducer 幂等)
    generationCanvasLastSeq: getCanvasEventLastSeq(),
    storyboardDesignsByDocumentId: workbench.storyboardDesignsByDocumentId,
    editingPanelLayout: workbench.editingPanelLayout,
  }
}
