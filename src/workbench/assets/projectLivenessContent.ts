// 素材文件存活判定读的「项目内容」——唯一的装配口（判定本身在 `assetResultDeletion.ts#isProjectFileReferenced`）。
//
// 一份项目的内容 = ①写进项目文件的那一份（`readCurrentWorkbenchProjectContent`，和存盘同一个投影，写盘多一个字段这里自动多扫一个）
//                + ②这个项目会话里还没落进项目文件、但马上要用的东西（助手输入框、找回的未发草稿、还没落地的结果）
//                + ③会话撤销材料（时间轴撤销 / 重做栈、删节点时摘下的片段）——只在会话还活着时算；关项目那一刻撤销栈马上清零，不算。
// 画布撤销日志不进来：它由「撤销窗口过去才真删」的日志位置机制管（`pendingAssetDeletions.ts`），进扫描会让任何删除都要等到关项目。
//
// 拿不到完整内容（画布还没载入、载入的不是目标项目、装配抛错）一律返回 null，判定把 null 当「有人用」。
// 哪些会话字段算 ②③、哪些不装引用，由 `PROJECT_SESSION_FIELD_ROLES` 一张表说了算；普查测试保证每个「项目寿命」字段都在表里。
import { logRendererError } from '../../desktop/rendererLog'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { useWorkbenchStore } from '../workbenchStore'
import { readCurrentWorkbenchProjectContent } from '../project/workbenchProjectContent'
import type { WorkbenchProjectPayload } from '../project/projectRecordSchema'

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
    workbenchDocuments: 'content', activeDocumentId: 'content', categories: 'content', timeline: 'content',
    storyboardDesignsByDocumentId: 'content', editingPanelLayout: 'content',
    projectAgentDraft: 'pending', projectAgentDraftDisplayText: 'pending', projectAgentDraftIntent: 'pending',
    projectAgentAttachments: 'pending', projectAgentReferences: 'pending', selectedLibraryPrompt: 'pending', creationActiveSkill: 'pending',
    timelineUndoStack: 'session-undo', timelineRedoStack: 'session-undo', detachedTimelineClips: 'session-undo',
    workspaceMode: UI_STATE, activeCategoryId: UI_STATE, categoryViewports: UI_STATE, canvasFitNonce: UI_STATE, canvasFitCategoryId: UI_STATE,
    creationAiModeId: UI_STATE, storyboardPlannerLauncher: { none: '视图发布的回调函数，不是数据' },
    activeStoryboardId: UI_STATE, storyboardRowFocus: UI_STATE, projectAgentDraftRevision: UI_STATE, projectAgentAdmissionId: UI_STATE,
    projectAgentApprovalPolicy: UI_STATE, projectAgentDockCollapsed: UI_STATE, timelinePlaying: UI_STATE, previewAspectRatio: UI_STATE,
    selectedTimelineClipIds: UI_STATE, selectedTextClipId: UI_STATE, timelineSnapGuide: UI_STATE, timelineSplitMode: UI_STATE,
    editingPanelUndoStack: { none: '面板尺寸 / 显隐的撤销，不装文件' }, editingPanelKeep: UI_STATE,
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
    status: UI_STATE, deviations: { none: '审片偏差说明（文字 + 节点 id），不是素材引用' }, budget: UI_STATE,
    projectId: UI_STATE, requestId: UI_STATE, exhausted: UI_STATE,
  },
  'useAssetImportProgressStore': { byNode: UI_STATE, settled: UI_STATE },
  'useNodeExternalHighlightStore': { hoverNodeId: UI_STATE, claims: UI_STATE, flashNodeIds: UI_STATE },
  'useSpendConfirmStore': { pending: { none: '付费确认卡：参数来自节点本身（已在 content 里）' }, queue: { none: '同 pending' } },
  'useCanvasPickModeStore': { request: UI_STATE },
  'useBatchPlanPreviewStore': { plan: { none: '批量生成预览：引用来自节点本身（已在 content 里）' }, running: UI_STATE },
  'useNodeLivePreviewStore': { byNode: { none: '生成中的实时预览帧，不是项目文件' } },
  'useResidentActivityStore': { dotClassName: UI_STATE, label: UI_STATE, dockStatus: UI_STATE, dockPendingCount: UI_STATE, dockUnreadCount: UI_STATE },
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

/**
 * 不在渲染层 store 里、刻意不算「活引用」的三份持久数据（2026-11-17 协调裁定）。普查测试钉住它们装引用的形状：
 * 以后有人往里加地址，测试红，先回这里重判。
 */
export const MAIN_PROCESS_RECORDS_NOT_LIVE: Readonly<Record<string, string>> = {
  agentConversationHistory: '助手已发出的对话历史：转录里只存素材身份 claim（assetId + version），记的是过去说过什么；文件不在时那条消息画「附件不可用」（electron/agentLane/laneDesktopAttachments.ts），不会从历史里消失',
  productionRunLedger: '制作运行的产物台账：记的是过去哪次运行产出了什么；文件不在时那次产物的预览打不开，台账本身还在',
  agentQueuedInputs: '助手运行中排队、还没发出的输入（主进程里）：同样按 claim 存；它在用户中止时才回到渲染层输入框，时刻由用户决定，清扫排不到它后面——已知限制：原结果被删、文件回收后，这条输入发出去时附件不可用',
}

export type ProjectLivenessContent = { nodes: readonly GenerationCanvasNode[]; rest: unknown }

/** 会话还活着（删除当场、撤销挤出、列表）还是马上结束（关项目 / 换项目那一次释放：撤销栈随后清零）。 */
export type ProjectSessionMoment = 'alive' | 'ending'

function pickRoles(store: string, state: object, accept: (role: ProjectSessionFieldRole) => boolean): Record<string, unknown> {
  const roles = PROJECT_SESSION_FIELD_ROLES[store] ?? {}
  const picked: Record<string, unknown> = {}
  for (const [field, role] of Object.entries(roles)) {
    if (accept(role)) picked[field] = (state as Record<string, unknown>)[field]
  }
  return picked
}

/** 找回的未发助手草稿是窗口寿命（按项目 UUID 挂着），关闭的项目也要算它。 */
function recoveredAgentDrafts(): unknown {
  return useWorkbenchStore.getState().projectAgentRecoveredDrafts
}

/** 此刻已加载项目的完整内容；画布没载入、载入的不是这个项目、装配出错 → null（判定当「有人用」）。 */
export function readLoadedProjectLivenessContent(projectId: string, moment: ProjectSessionMoment): ProjectLivenessContent | null {
  const canvas = useGenerationCanvasStore.getState()
  if (!canvas.isReady || !projectId || canvas.projectId !== projectId) return null
  try {
    const { generationCanvas, ...content } = readCurrentWorkbenchProjectContent()
    const { nodes, ...canvasRest } = generationCanvas
    const workbench = useWorkbenchStore.getState()
    const pending = (role: ProjectSessionFieldRole) => role === 'pending' || (moment === 'alive' && role === 'session-undo')
    return {
      nodes,
      rest: {
        content: { ...content, generationCanvas: canvasRest },
        workbenchSession: pickRoles('useWorkbenchStore', workbench, pending),
        canvasSession: pickRoles('useGenerationCanvasStore', canvas, pending),
        recoveredAgentDrafts: recoveredAgentDrafts(),
      },
    }
  } catch (error) {
    logRendererError('asset-liveness-content-unreadable', error)
    return null
  }
}

/** 关闭的项目：读盘得到的整份内容（去掉待删清单本身）+ 窗口里挂着的这个项目的未发草稿。 */
export function closedProjectLivenessContent(payload: WorkbenchProjectPayload): ProjectLivenessContent {
  const { generationCanvas, pendingAssetDeletions: _toDelete, ...content } = payload
  const { nodes, ...canvasRest } = generationCanvas
  return { nodes, rest: { content: { ...content, generationCanvas: canvasRest }, recoveredAgentDrafts: recoveredAgentDrafts() } }
}
