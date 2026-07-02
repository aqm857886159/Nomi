import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

/**
 * 图片镜头 → 视频镜头（image-first 桥，用户拍板 2026-07-02）：
 * 建一个派生 video 节点 + first_frame 边（这张图 = 视频首帧，复用现有 i2v 链路，P1 零新链路）。
 *
 * 语义要点：
 * - 视频节点**继承源图的镜号**（同一镜的两阶段——排片按视频镜位落在剧本位置 3 而非新号 13）；
 *   addNode 会先自动领新号，随即 updateNode 覆写回继承号（nextShotIndex 按 max 计算，空号无影响）。
 * - meta.sourceNodeId 指回源图 → 一键整理会把视频紧跟其源镜头摆放。
 * - 不写 modelKey：让 useNodeModelAutoSelect 的「modelKey 空时自动选默认视频模型」既有路径接管。
 * - 幂等：该图已转出过视频（存在 image→video 出边）→ 返回已有节点 id，不重复建。
 *
 * 返回 { nodeId, existed }；UI 层据此吐 toast。纯 store 编排，可单测（store 可在测试里 setState 铺底）。
 */
export function convertImageShotToVideo(node: GenerationCanvasNode): { nodeId: string; existed: boolean } {
  const state = useGenerationCanvasStore.getState()
  const existing = state.nodes.find(
    (candidate) =>
      getGenerationNodeExecutionKind(candidate.kind) === 'video' &&
      state.edges.some((edge) => edge.source === node.id && edge.target === candidate.id),
  )
  if (existing) {
    state.selectNode(existing.id)
    return { nodeId: existing.id, existed: true }
  }
  const video = state.addNode({
    kind: 'video',
    title: node.title ? `${node.title} · 视频` : '',
    prompt: node.prompt || '',
    meta: { sourceNodeId: node.id },
    position: { x: node.position.x + (node.size?.width ?? 320) + 80, y: node.position.y },
    ...(node.categoryId ? { categoryId: node.categoryId } : {}),
    select: true,
  })
  if (typeof node.shotIndex === 'number') {
    useGenerationCanvasStore.getState().updateNode(video.id, { shotIndex: node.shotIndex })
  }
  useGenerationCanvasStore.getState().connectNodes(node.id, video.id, 'first_frame')
  return { nodeId: video.id, existed: false }
}
