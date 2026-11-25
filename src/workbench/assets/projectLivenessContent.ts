// 素材文件存活判定读的「项目内容」——唯一的装配口（判定本身在 `assetResultDeletion.ts#isProjectFileReferenced`）。
//
// 一份项目的内容 = ①写进项目文件的那一份（`readCurrentWorkbenchProjectContent`，和存盘同一个投影，写盘多一个字段这里自动多扫一个）
//                + ②这个项目会话里还没落进项目文件、但马上要用的东西（助手输入框、找回的未发草稿、还没落地的结果）
//                + ③会话撤销材料（时间轴撤销 / 重做栈、删节点时摘下的片段）——只在会话还活着时算；关项目那一刻撤销栈马上清零，不算。
// 画布撤销日志不进来：它由「撤销窗口过去才真删」的日志位置机制管（`pendingAssetDeletions.ts`），进扫描会让任何删除都要等到关项目。
//
// 拿不到完整内容（画布还没载入、载入的不是目标项目、装配抛错）一律返回 null，判定把 null 当「有人用」。
// 哪些会话字段算 ②③、哪些不装引用，由 `PROJECT_SESSION_FIELD_ROLES` 一张表说了算（和组成载荷的那段放在一起：`project/workbenchProjectContent.ts`）；普查测试保证每个「项目寿命」字段都在表里。
import { logRendererError } from '../../desktop/rendererLog'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { useWorkbenchStore } from '../workbenchStore'
import { PROJECT_SESSION_FIELD_ROLES, readCurrentWorkbenchProjectContent, type ProjectSessionFieldRole } from '../project/workbenchProjectContent'
import type { WorkbenchProjectPayload } from '../project/projectRecordSchema'

/**
 * 不在渲染层 store 里、刻意不算「活引用」的三份持久数据（2026-11-17 协调裁定）。普查测试钉住它们装引用的形状：
 * 以后有人往里加地址，测试红，先回这里重判。
 */
export const MAIN_PROCESS_RECORDS_NOT_LIVE: Readonly<Record<string, string>> = {
  agentConversationHistory: '助手已发出的对话历史：转录里只存素材身份 claim（assetId + version），记的是过去说过什么；文件不在时那条消息画「附件不可用」（electron/agentLane/laneDesktopAttachments.ts），不会从历史里消失',
  productionRunLedger: '制作运行的产物台账：记的是过去哪次运行产出了什么；文件不在时那次产物的预览打不开，台账本身还在',
  agentQueuedInputs: '助手运行中排队、还没发出的输入（主进程里）：同样按 claim 存；它在用户中止时才回到渲染层输入框，时刻由用户决定，清扫排不到它后面——已知限制：原结果被删、文件回收后，这条输入发出去时附件不可用',
}

type ProjectLivenessContent = { nodes: readonly GenerationCanvasNode[]; rest: unknown }

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
