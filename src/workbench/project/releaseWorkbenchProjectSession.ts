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

/**
 * Release the currently opened project's heavy renderer-only state after it has
 * already been persisted. This is intentionally not a store action: leaving the
 * project library should not bump persistRevision or write an empty project.
 */
export function releaseWorkbenchProjectRuntimeState(): void {
  abandonCreationTurn()
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

  useWorkbenchStore.setState({
    workspaceMode: 'generation',
    activeCategoryId: DEFAULT_CATEGORY_ID,
    categories: cloneBuiltinCategories(),
    categoryViewports: {},
    workbenchDocument: createDefaultWorkbenchDocument(),
    creationDocumentTools: null,
    creationSelectionText: '',
    creationAiModeId: 'general',
    creationActiveSkill: null,
    creationAiDraft: '',
    creationAiMessages: [],
    creationAiAttachments: [],
    creationAiError: '',
    storyboardPlan: null,
    storyboardPlanCommitted: false,
    storyboardEditorOpen: false,
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
