// 喂给 LLM 的画布上下文(token 优化 T1,单一真相源):system prompt 的快照段与
// read_canvas_state 的回包都从这里出——紧凑行格式取代全字段 pretty JSON
// (实测后者 ~2-3k token/请求且随节点线性涨;本格式同画布 ~0.4-0.8k)。
// 字段白名单:id/kind/title/锁/运行态/prompt 摘要 60 字;选中节点附完整提示词
// (润色要原文);result/history/runs/meta/position 等与规划无关的字段一律不进。
import type { GenerationCanvasNode, GenerationCanvasEdge } from '../model/generationCanvasTypes'

type SnapshotLike = {
  nodes: readonly GenerationCanvasNode[]
  edges: readonly GenerationCanvasEdge[]
  selectedNodeIds?: readonly string[]
}

const head = (text: string, max = 60): string => {
  const compact = String(text || '').trim().replace(/\s+/g, ' ')
  return compact.length > max ? `${compact.slice(0, max)}…` : compact
}

export function formatCanvasForAgent(snapshot: SnapshotLike, selectedNodes: readonly GenerationCanvasNode[] = []): string {
  if (snapshot.nodes.length === 0) return '画布当前为空。'
  const titleById = new Map(snapshot.nodes.map((node) => [node.id, node.title]))
  const lines = snapshot.nodes.map((node) => {
    const flags = [
      node.locked ? '已锁定' : null,
      // 区分已出视频 / 已出图——排片(arrange_storyboard_to_timeline)按视频优先、缺则关键帧占位。
      node.result?.type === 'video' ? '已出视频' : node.result ? '已出图' : null,
      node.status && node.status !== 'idle' && node.status !== 'success' ? node.status : null,
    ].filter(Boolean)
    const promptHead = head(node.prompt || '')
    return [
      `- ${node.id} | ${node.kind}`,
      // 镜号(shotIndex)= 剧本时序的真相,排片即按它排;让 Agent 决策/复报能引用「镜 N」。
      typeof node.shotIndex === 'number' ? ` | 镜${node.shotIndex}` : '',
      typeof node.meta?.storyboardDesignId === 'string' && node.meta.storyboardDesignId.trim()
        ? ` | storyboard:${node.meta.storyboardDesignId.trim()}`
        : '',
      ` | ${node.title}`,
      flags.length ? ` | ${flags.join(',')}` : '',
      promptHead ? ` | prompt: ${promptHead}` : '',
    ].join('')
  })
  const edges = snapshot.edges
    .map((edge) => `${titleById.get(edge.source) || edge.source}→${titleById.get(edge.target) || edge.target}`)
    .join(', ')
  const selectedIds = selectedNodes.length
    ? selectedNodes.map((node) => node.id)
    : (snapshot.selectedNodeIds ?? [])
  // 选中节点(通常 ≤1)给完整提示词——润色/改写需要原文,其余节点摘要即可。
  const fullPrompts = selectedNodes
    .filter((node) => (node.prompt || '').length > 60)
    .map((node) => `「${node.title}」(${node.id}) 完整提示词:\n${node.prompt}`)
  return [
    `画布节点 ${snapshot.nodes.length} 个(id | 类型 | 标题 | 状态 | prompt 摘要):`,
    ...lines,
    `引用边: ${edges || '无'}`,
    `当前选中: ${selectedIds.length ? selectedIds.join(', ') : '无'}`,
    ...(fullPrompts.length ? ['', ...fullPrompts] : []),
  ].join('\n')
}
