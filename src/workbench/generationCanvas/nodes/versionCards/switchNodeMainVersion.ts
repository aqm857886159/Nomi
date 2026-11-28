// 切换节点主版本的**唯一共享领域命令**（画布版本宫格 `NodeVersionCardsHost` 与列表大详情 `DetailVersions` 共用）。
//
// 为什么不能在视图里裸调 `store.setNodeMainResult`：
// 1. 节点若正开着内联白板，必须先 `finishWhiteboard(nodeId)` 落盘当前涂鸦，否则切主图会把未保存的白板改动冲掉；
// 2. 不同版本的真实像素宽高可能不同（例：第 1 版 9:16、第 2 版 16:9），切换时必须按该版本自身或素材侧车里的真实宽高
//    经 `computeMediaMetaPatch` 一并回填 `meta`，否则节点尺寸与比例标签仍停留在上一版；
// 3. 异步读取侧车期间若用户切走了项目（`!isProjectExecutionContextCurrent`），必须中止，绝不往新项目串写。
import { getDesktopBridge } from '../../../../desktop/bridge'
import { logRendererError } from '../../../../desktop/rendererLog'
import { listNodeResultVersions, resultIdentity } from '../../model/nodeResultLifecycle'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { isProjectExecutionContextCurrent, withProjectAction } from '../../../project/projectCanvasReadSurface'
import { findCanvasResultMediaDimensions } from '../../../project/projectMediaMigration'
import { computeMediaMetaPatch, readMediaDimensions, type MediaDimensions } from '../nodeSizing'
import { finishWhiteboard } from '../whiteboard/whiteboardSession'

export type SwitchNodeMainVersionOptions = Readonly<{
  readOnly?: boolean
  /** 画布版本宫格在真实项目上下文里要求打开项目；纯 store 环境（单测 / 离线快照）缺省放行按版本自身尺寸回填。 */
  requireOpenProject?: boolean
  onSwitched?: (info: { versionNo: number; downstreamCount: number }) => void
}>

async function resolveTargetVersionDimensions(
  projectId: string | null,
  isCurrentProject: () => boolean,
  target: ReturnType<typeof listNodeResultVersions>[number],
): Promise<{ aborted: boolean; dimensions: MediaDimensions | null }> {
  const inline = readMediaDimensions(
    (target as { width?: unknown }).width,
    (target as { height?: unknown }).height,
  )
  if (inline) return { aborted: false, dimensions: inline }
  if (!projectId) return { aborted: false, dimensions: null }
  try {
    const assets: Array<{ id?: string; data?: Record<string, unknown> }> = []
    let cursor: string | null = null
    do {
      const desktop = getDesktopBridge()
      if (!desktop?.assets?.list) break
      const page = await desktop.assets.list({ projectId, cursor, limit: 500 })
      if (!page) break
      assets.push(...page.items)
      cursor = page.cursor || null
    } while (cursor)
    if (!isCurrentProject()) return { aborted: true, dimensions: null }
    return { aborted: false, dimensions: findCanvasResultMediaDimensions(target, assets) }
  } catch (error) {
    logRendererError('version-card-dimensions-unreadable', error)
    return { aborted: !isCurrentProject(), dimensions: null }
  }
}

const latestSwitchSeqByNode = new Map<string, number>()

export async function switchNodeMainVersion(
  nodeId: string,
  identity: string,
  options: SwitchNodeMainVersionOptions = {},
): Promise<boolean> {
  if (options.readOnly) return false
  const project = withProjectAction((loaded) => loaded)
  if (options.requireOpenProject && !project) return false
  const switchSeq = (latestSwitchSeqByNode.get(nodeId) ?? 0) + 1
  latestSwitchSeqByNode.set(nodeId, switchSeq)
  const isLatestRequest = () => latestSwitchSeqByNode.get(nodeId) === switchSeq
  const isCurrentProject = () => (project ? isProjectExecutionContextCurrent(project) : true)
  try {
    if (!(await finishWhiteboard(nodeId)) || !isCurrentProject() || !isLatestRequest()) return false

    const live = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
    const target = live ? listNodeResultVersions(live).find((candidate) => resultIdentity(candidate) === identity) : undefined
    if (!live || !target) return false

    const { aborted, dimensions } = await resolveTargetVersionDimensions(
      project?.binding.projectId ?? null,
      isCurrentProject,
      target,
    )
    if (aborted || !isCurrentProject() || !isLatestRequest()) return false

    const current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
    if (!current) return false
    const patch = dimensions
      ? computeMediaMetaPatch({
          resultType: target.type,
          meta: current.meta || {},
          ...dimensions,
          durationSeconds: target.durationSeconds,
        })
      : null

    useGenerationCanvasStore.getState().setNodeMainResult(nodeId, identity, patch?.meta)
    if (options.onSwitched) {
      const downstreamCount = new Set(
        useGenerationCanvasStore.getState().edges.filter((edge) => edge.source === nodeId).map((edge) => edge.target),
      ).size
      options.onSwitched({ versionNo: target.versionNo ?? 1, downstreamCount })
    }
    return true
  } finally {
    if (isLatestRequest()) latestSwitchSeqByNode.delete(nodeId)
  }
}
