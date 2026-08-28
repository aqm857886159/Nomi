import { createDefaultGenerationCanvasSnapshot } from '../generationCanvas/store/generationCanvasDefaults'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { clearHistory } from '../generationCanvas/events/canvasUndoJournal'
import { clearClipboard } from '../generationCanvas/store/canvasClipboard'
import { clearCommittedProposal } from '../generationCanvas/agent/proposalUndo'
import { resetClientIdRegistry } from '../generationCanvas/agent/clientIdRegistry'
import { clearPendingRetryImports } from '../generationCanvas/adapters/assetImportAdapter'
import { useWorkbenchStore } from '../workbenchStore'
import { cloneBuiltinCategories, DEFAULT_CATEGORY_ID } from './projectCategories'
import { createDefaultTimeline } from '../timeline/timelineMath'
import { createDefaultWorkbenchDocument } from '../workbenchTypes'
import { abandonCreationTurn } from '../creation/creationTurnController'
import { abandonCanvasTurn } from '../generationCanvas/agent/canvasTurnController'
import { useShotVerifyStore } from '../generationCanvas/agent/shotVerifyStore'
import { resetTimelineAgentState } from '../timeline/agent/timelineToolCall'

/**
 * Release the currently opened project's heavy renderer-only state after it has
 * already been persisted. This is intentionally not a store action: leaving the
 * project library should not bump persistRevision or write an empty project.
 */
export function releaseWorkbenchProjectRuntimeState(): void {
  resetTimelineAgentState()
  abandonCreationTurn()
  abandonCanvasTurn()
  // 审片结果和在途 judge 都是项目态；离开项目必须清掉并递增 requestId，旧回执随后到达也不能复活。
  useShotVerifyStore.getState().clear()
  clearCommittedProposal()
  resetClientIdRegistry()
  clearHistory()
  clearClipboard()
  clearPendingRetryImports()

  const emptyCanvas = createDefaultGenerationCanvasSnapshot()
  useGenerationCanvasStore.setState({
    isReady: false,
    nodes: emptyCanvas.nodes,
    edges: emptyCanvas.edges,
    groups: emptyCanvas.groups,
    selectedNodeIds: [],
    pendingConnectionSourceId: '',
    pendingConnectionSourceSide: 'right',
    canvasZoom: 1,
    canvasOffset: { x: 0, y: 0 },
    generationAiDraft: '',
    generationAiMessages: [],
    generationAiCollapsed: true,
    canUndo: false,
    canRedo: false,
    hasClipboard: false,
  })

  const emptyDocument = createDefaultWorkbenchDocument()
  useWorkbenchStore.setState({
    workspaceMode: 'generation',
    activeCategoryId: DEFAULT_CATEGORY_ID,
    categories: cloneBuiltinCategories(),
    categoryViewports: {},
    workbenchDocuments: [emptyDocument],
    activeDocumentId: emptyDocument.id,
    creationDocumentTools: null,
    creationSelectionText: '',
    creationAiModeId: 'general',
    creationActiveSkill: null,
    creationAiDraft: '',
    creationAiMessages: [],
    creationAiAttachments: [],
    creationAiError: '',
    storyboardPlans: {},
    timeline: createDefaultTimeline(),
    timelinePlaying: false,
    previewAspectRatio: '16:9',
    selectedTimelineClipIds: [],
    selectedTextClipId: '',
    timelineSnapGuide: null,
    timelineSplitMode: false,
    timelineUndoStack: [],
    timelineRedoStack: [],
    creationAssistantAutoOpen: false,
  })
}
