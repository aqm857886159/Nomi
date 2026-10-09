// `useWorkbenchStore` 的 C1 寿命声明 + 项目释放（2026-09-18）。
//
// 为什么单独一个文件而不是写在 store 旁边：`workbenchStore.ts` 顶着 800 行硬上限（R9），
// 这份 42 个字段的声明进去就撞线。声明与 store 分家不影响门岗——
// `check:store-lifetime` 按 store 名匹配声明，不按文件。
import { DEFAULT_PROJECT_AGENT_APPROVAL_POLICY } from '../../electron/shared/agentCapabilities/capabilityApprovalPolicy'
import { cloneEditingPanelLayout, EDITING_PANEL_DEFAULTS } from './preview/panelLayout'
import { declareStoreLifetime } from './project/storeLifetime'
import { cloneBuiltinCategories, DEFAULT_CATEGORY_ID } from './project/projectCategories'
import { createDefaultTimeline } from './timeline/timelineMath'
import { useWorkbenchStore } from './workbenchStore'
import { createDefaultWorkbenchDocument } from './workbenchTypes'

/**
 * C1 寿命声明 + 释放（原来是 `releaseWorkbenchProjectSession.ts` 里那份 21/31 的手写清单）。
 *
 * 窗口级的那些（侧栏宽度、折叠、面板高度、导出偏好）**刻意不清**：它们是用户在这台机器上
 * 调好的手感，和打开哪个项目无关，每换一次项目还原一次就是在跟他作对。
 *
 * 原清单漏掉的两个项目级字段，这次归位：
 * - `storyboardPlannerLauncher`：由 `ProjectAgentResidentShell.tsx` 的 useEffect 发布的
 *   **视图函数**（审计 §1.3 点名的「同一个病的第二例」）。它捕获着上一个项目那次挂载的闭包，
 *   留在 store 里 = 新项目的分镜规划入口指着旧项目。
 * - `canvasFitNonce` / `canvasFitCategoryId`：一次「把画布缩放到合适」的请求。
 *   不清的话，新项目第一帧会执行一条为上一个项目发出的适配。
 */
export const workbenchStoreLifetime = declareStoreLifetime({
  store: 'useWorkbenchStore',
  fields: {
    // 进程 / 窗口级：跟着这台机器与这个窗口走，切项目不动。
    persistRevision: 'process',
    timelinePanelCollapsed: 'window',
    timelinePanelHeight: 'window',
    exportResolution: 'window',
    exportQuality: 'window',
    timelineSnapEnabled: 'window',
    previewSourceTab: 'window',
    // 项目级：离开项目必须清。
    workspaceMode: 'project',
    activeCategoryId: 'project',
    categories: 'project',
    categoryViewports: 'project',
    canvasFitNonce: 'project',
    canvasFitCategoryId: 'project',
    workbenchDocuments: 'project',
    activeDocumentId: 'project',
    creationSelectionText: 'project',
    creationAiModeId: 'project',
    creationActiveSkill: 'project',
    selectedLibraryPrompt: 'project',
    storyboardPlannerLauncher: 'project',
    storyboardDesignsByDocumentId: 'project',
    activeStoryboardId: 'project',
    storyboardRowFocus: 'project',
    projectAgentDraft: 'project',
    projectAgentDraftRevision: 'project',
    // Unsent recovered buffers are keyed by immutable project UUID + pi session; late ACKs
    // remain accessible after returning to that project, without entering the new composer.
    projectAgentRecoveredDrafts: 'window', projectAgentDraftIntent: 'project', projectAgentDraftDisplayText: 'project', projectAgentAdmissionId: 'project',
    projectAgentAttachments: 'project',
    projectAgentReferences: 'project',
    projectAgentApprovalPolicy: 'project',
    projectAgentDockCollapsed: 'project',
    timeline: 'project',
    timelinePlaying: 'project',
    previewAspectRatio: 'project',
    selectedTimelineClipIds: 'project',
    selectedTextClipId: 'project',
    timelineSnapGuide: 'project',
    timelineSplitMode: 'project',
    timelineUndoStack: 'project',
    timelineRedoStack: 'project',
    editingPanelLayout: 'project',
    editingPanelUndoStack: 'project',
  },
  releaseProject: () => {
    const emptyDocument = createDefaultWorkbenchDocument()
    useWorkbenchStore.setState({
      workspaceMode: 'generation',
      activeCategoryId: DEFAULT_CATEGORY_ID,
      categories: cloneBuiltinCategories(),
      categoryViewports: {},
      canvasFitNonce: 0,
      canvasFitCategoryId: null,
      workbenchDocuments: [emptyDocument],
      activeDocumentId: emptyDocument.id,
      creationSelectionText: '',
      creationAiModeId: 'general',
      creationActiveSkill: null,
      selectedLibraryPrompt: null,
      storyboardPlannerLauncher: null,
      storyboardDesignsByDocumentId: {},
      activeStoryboardId: null,
      storyboardRowFocus: null,
      projectAgentDraft: '',
      projectAgentDraftRevision: 0,
      projectAgentDraftIntent: null, projectAgentDraftDisplayText: null, projectAgentAdmissionId: null,
      projectAgentAttachments: [],
      projectAgentReferences: [],
      projectAgentApprovalPolicy: DEFAULT_PROJECT_AGENT_APPROVAL_POLICY,
      projectAgentDockCollapsed: false,
      timeline: createDefaultTimeline(),
      timelinePlaying: false,
      previewAspectRatio: '16:9',
      selectedTimelineClipIds: [],
      selectedTextClipId: '',
      timelineSnapGuide: null,
      timelineSplitMode: false,
      timelineUndoStack: [],
      timelineRedoStack: [],
      editingPanelLayout: cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS),
      editingPanelUndoStack: [],
    })
  },
})
