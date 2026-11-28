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
    timeline: { ...workbench.timeline, scale: workbench.persistedTimelineScale },
    previewAspect: workbench.previewAspect,
    // S5-b-0:持久化走 document 视图(选区是会话态不进项目文件)
    generationCanvas: generation.readDocumentSnapshot(),
    categories: workbench.categories,
    // 当前已确认游标；保存队列会等待这份快照所覆盖的追加回执。
    generationCanvasLastSeq: getCanvasEventLastSeq(),
    storyboardDesignsByDocumentId: workbench.storyboardDesignsByDocumentId,
    editingPanelLayout: workbench.editingPanelLayout,
  }
}

// 字段归类表和上面组成载荷的那段放在一起：以后加一个载荷字段，归类就在同一个文件里跟着改，漏不掉。
// 素材文件存活判定（`assets/projectLivenessContent.ts`）只 import 这张表，不另写一份。
/**
 * 每个声明为「项目寿命」的 store 字段装不装文件引用：
 * - `content`：写进项目文件，经 `readCurrentWorkbenchProjectContent` 整份扫描；
 * - `pending`：会话里还没落进项目文件、马上要用的东西（未发的输入、待落地的结果），任何时候都扫；
 * - `session-undo`：会话撤销材料，会话活着时扫，关项目那一次释放不扫；
 * - 其余字符串：不装文件引用，写明理由。
 */
export type ProjectSessionFieldRole = 'content' | 'pending' | 'session-undo' | { none: string }

const UI_STATE = { none: '界面 / 选择 / 进度状态，只存 id、计数或开关，不装文件地址' } as const

export const PROJECT_SESSION_FIELD_ROLES: Readonly<Record<string, Readonly<Record<string, ProjectSessionFieldRole>>>> = {
  'useWorkbenchStore': {
    workbenchDocuments: 'content', activeDocumentId: 'content', categories: 'content', timeline: 'content', previewAspect: 'content',
    storyboardDesignsByDocumentId: 'content', editingPanelLayout: 'content',
    projectAgentDraft: 'pending', projectAgentDraftDisplayText: 'pending', projectAgentDraftIntent: 'pending',
    projectAgentAttachments: 'pending', projectAgentReferences: 'pending', selectedLibraryPrompt: 'pending', creationActiveSkill: 'pending',
    persistedTimelineScale: { none: '手动确认的时间轴缩放数值' },
    timelineHistory: 'session-undo', detachedTimelineClips: 'session-undo',
    workspaceMode: UI_STATE, activeCategoryId: UI_STATE, categoryViewports: UI_STATE, canvasFitNonce: UI_STATE, canvasFitCategoryId: UI_STATE,
    creationAiModeId: UI_STATE, storyboardPlannerLauncher: { none: '视图发布的回调函数，不是数据' },
    activeStoryboardId: UI_STATE, storyboardRowFocus: UI_STATE, projectAgentDraftRevision: UI_STATE, projectAgentAdmissionId: UI_STATE,
    projectAgentApprovalPolicy: UI_STATE, projectAgentDockCollapsed: UI_STATE, timelinePlaying: UI_STATE,
    selectedTimelineClipIds: UI_STATE, selectedTextClipId: UI_STATE, timelineSnapGuide: UI_STATE, timelineSplitMode: UI_STATE,
    editingPanelHistory: { none: '面板尺寸 / 显隐的撤销，不装文件' }, editingPanelKeep: UI_STATE,
  },
  sessionFrameStore: {
    value: { none: 'temporal 的 present 是同步用的镜像。可恢复的引用只来自 workbench 的 timeline 和 timelineHistory.entries；旅行前以当前内容覆盖镜像。' },
    metadata: { none: 'Agent 回执授权身份与 revision，不装素材地址' },
  },
  'useGenerationCanvasStore': {
    nodes: 'content', edges: 'content', groups: 'content',
    generationAiDraft: 'pending', heldNodeOutcomes: 'pending',
    generationAiMessages: { none: '画布 AI 已发出的对话记录：记的是过去说过什么，同助手对话历史' },
    projectId: UI_STATE, isReady: UI_STATE, selectedNodeIds: UI_STATE, pendingConnectionSourceId: UI_STATE,
    pendingConnectionSourceSide: UI_STATE, pendingConnectionSourceKind: UI_STATE, canUndo: UI_STATE, canRedo: UI_STATE, hasClipboard: UI_STATE,
    generationAiCollapsed: UI_STATE,
  },
  'useAgentFormViewStore': { machineBySurface: UI_STATE },
  'useNodePromptFocusStore': { request: UI_STATE },
  'useWhiteboardSession': { nodeId: UI_STATE },
  'useShotVerifyStore': {
    status: UI_STATE, deviations: { none: '审片偏差说明（文字 + 节点 id），不是素材引用' },
    unverified: { none: '审片未校验说明（原因码 + 节点 id），不是素材引用' }, budget: UI_STATE,
    projectId: UI_STATE, requestId: UI_STATE, exhausted: UI_STATE,
  },
  'useAssetImportProgressStore': { byNode: UI_STATE, settled: UI_STATE },
  'useNodeExternalHighlightStore': { hoverNodeId: UI_STATE, claims: UI_STATE, flashNodeIds: UI_STATE },
  'useSpendConfirmStore': { pending: { none: '付费确认卡：参数来自节点本身（已在 content 里）' }, queue: { none: '同 pending' } },
  'useCanvasPickModeStore': { request: UI_STATE, returnToList: UI_STATE },
  'useBatchPlanPreviewStore': { plan: { none: '批量生成预览：引用来自节点本身（已在 content 里）' }, running: UI_STATE },
  'useNodeLivePreviewStore': { byNode: { none: '生成中的实时预览帧，不是项目文件' } },
  'useResidentActivityStore': { dotClassName: UI_STATE, label: UI_STATE, dockStatus: UI_STATE, dockFaceStatus: UI_STATE, dockPendingCount: UI_STATE, dockUnreadCount: UI_STATE },
  'useResidentComposerFocusStore': { request: UI_STATE },
  'useProductionRunStore': {
    projectId: UI_STATE, run: { none: '制作运行台账的只读镜像：记的是过去发生过什么（主进程台账同理）' }, cursor: UI_STATE,
    loading: UI_STATE, error: UI_STATE, lastPolledAt: UI_STATE, requestedRunId: UI_STATE, navigationTarget: UI_STATE,
  },
  'useProductionCanvasLandingStore': { projectId: UI_STATE, runs: { none: '制作运行落地进度：只存 run / 节点 id' }, pinnedForE2E: UI_STATE },
  'useNodePointerStore': { locatedNodeId: UI_STATE, returnTo: UI_STATE },
  'useGenerationViewStore': { view: UI_STATE, inspectorKey: UI_STATE },
  'useGenerationPageLayerTenants': { open: UI_STATE },
}
