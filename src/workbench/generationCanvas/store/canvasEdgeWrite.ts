// store 里「整条边追加进画布」的唯一落点：粘贴、拖动复制、组复制、模板实例化、复制为变体。
//
// 这几扇门原来各自 `state.edges = [...state.edges, ...cloned.edges]` 原样搬边，从不过连线总闸
// （electron/shared/canvas/edgeAdmission 的 validateReferenceEdge）：剪贴板里来自旧项目 / 旧规则的非法边
// （视频 → 文本这类）粘贴一次就重新落地。现在只有这一个函数能把整条边加进去——过闸，被拒的不写入、返回原因。
// 单条连线（connectNodes / connectToNode / 组连线）走 canvasGraphActions 的 writeCanvasEdge，同样过这道闸。
// 门岗 check:canvas-edge-writers 钉死：别的文件不许自己 `.edges = […]` / `.edges.push(`。
import { admitNewEdges, type RejectedEdge } from '../../../../electron/shared/canvas/edgeAdmission'
import i18n from '../../../i18n'
import { reportCanvasFeedback } from '../components/canvasFeedback'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'

type EdgeWritableState = { nodes: GenerationCanvasNode[]; edges: GenerationCanvasEdge[] }

export type AppendedEdges = { added: GenerationCanvasEdge[]; rejected: RejectedEdge<GenerationCanvasEdge>[] }

/** 在 `set` 里、新节点已经写进 `state.nodes` 之后调用：过闸的边追加进 `state.edges`，被拒的不写入。 */
export function appendAdmittedEdges(state: EdgeWritableState, incoming: readonly GenerationCanvasEdge[]): AppendedEdges {
  if (!incoming.length) return { added: [], rejected: [] }
  const verdict = admitNewEdges({ nodes: state.nodes, known: new Set<string>(), next: incoming })
  const added = [...verdict.edges]
  if (added.length) state.edges = [...state.edges, ...added]
  return { added, rejected: verdict.rejected }
}

/** 有连线没带过来时说一句——说的 = 做的：节点照常放下，只少了这几条线。 */
export function reportSkippedEdges(rejected: readonly unknown[], projectId: string | null): void {
  if (!rejected.length) return
  reportCanvasFeedback(i18n.t('generationCommon.canvas.edgesSkippedOnPaste', { count: rejected.length }), 'info', {
    identity: 'edges-skipped-on-paste',
    reason: 'edge-admission',
    projectId: projectId ?? '',
  })
}
