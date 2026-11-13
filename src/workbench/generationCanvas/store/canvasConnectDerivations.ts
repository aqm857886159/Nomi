// 「用户连了一条线」之后，目标节点上跟着这个手势变的东西——唯一一处。
//
// 连线手势的入口有好几扇（手拖把柄 connectToNode、多选成组连、组连线 connectToGroup、节点进组时物化组连线、
// Agent 计划 / 3D 站位经 connectNodes、派生节点 addDerivedOutput，以及外部 MCP 的连线经 applyExternalGraph——
// 协调 2026-10-23 裁定：外部 Agent 连线和进程内 Agent 是同一个口径），它们在「边已经建上」之后都只调这一个函数；
// 粘贴、模板、恢复快照、撤销 / 重做 / 放回带着自己的状态进来，**不**调它（那不是连线手势，不重算）。
// 这一处只做一件事（生成方式不再在连线时切：发送时按输入现算，见 modeForInputs）：
//   视频比例的产品默认（首选 16:9、已连输入全竖 9:16，唯一出处 nodes/videoAspectSeed）——只改没被明确选过比例的
//      视频节点（用户 2026-10-22 Q2 拍板：连线那一刻算；断线、删上游不回头改），而且只在新边属于比例规则会数的
//      输入（首帧 / 尾帧 / 参考，判据 nodes/aspectRatio.isAspectInputEdgeMode）时才算——角色参考这类边没改输入集合，
//      不拿它去把一个比例本来是档案默认（如 adaptive）的节点改成 16:9。
// 幂等：已经是首选比例 → 不写。
//
// **`history: false` 不是可选项**（2026-09-07 真机走查测出来的）：这些是**连线这一个手势的后果**，不是用户另做的一件事。
// updateNode 默认会给 `meta` patch 打一个自己的 undo barrier，于是连完一条线后日志里叠了两个 barrier——第一下 ⌘Z
// 只把模式 / 比例切回去（用户眼里画布毫无变化），得按第二下才撤掉那条边。关掉的只是 barrier：这条 meta 变更照常入日志、
// 照常落盘，撤到连线那个 barrier 时它跟着回退。
import { findModelOptionByIdentifier, peekGenerationNodeModelOptions } from '../adapters/modelOptionsAdapter'
import { isAspectInputEdgeMode } from '../nodes/aspectRatio'
import { resolveRenderedControls } from '../nodes/nodeModelArchetype'
import { videoAspectSeedPatch } from '../nodes/videoAspectSeed'
import { nodeSelectedModelAddress } from '../nodes/controls/parameterControlModel'
import { isImageLikeGenerationNodeKind, isVideoLikeGenerationNodeKind } from '../model/generationNodeKinds'
import type { GenerationCanvasEdge, GenerationCanvasEdgeMode, GenerationCanvasNode } from '../model/generationCanvasTypes'

type ConnectDerivationStore = {
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  updateNode: (nodeId: string, patch: { meta: Record<string, unknown> }, options?: { history?: boolean }) => void
}

/**
 * ② 视频比例默认值跟着输入走。参数控件按节点此刻的模型，模型清单的取法和生成框同一个（同步读目录缓存，
 * 按节点**当前生成方式**取——peekGenerationNodeModelOptions；只发布「图生视频」的模型在默认的文生视频清单里找不到）；
 * 目录还没载入 → 不改（这一刻说不清这个模型有哪些比例档，不猜）。
 */
function seedTargetVideoAspect(store: ConnectDerivationStore, targetNodeId: string, edgeMode: GenerationCanvasEdgeMode | undefined): void {
  if (!isAspectInputEdgeMode(edgeMode)) return
  const target = store.nodes.find((n) => n.id === targetNodeId)
  if (!target || !isVideoLikeGenerationNodeKind(target.kind)) return
  const meta = (target.meta || {}) as Record<string, unknown>
  const address = nodeSelectedModelAddress(meta)
  if (!address.modelKey) return
  const option = findModelOptionByIdentifier(peekGenerationNodeModelOptions(target, store) ?? [], address.modelKey, address.vendorKey)
  if (!option) return
  const controls = resolveRenderedControls(option, meta, isImageLikeGenerationNodeKind(target.kind), true, { node: target, graph: store })
  const patch = videoAspectSeedPatch({ nodeId: targetNodeId, nodes: store.nodes, edges: store.edges, controls, meta, respectExplicit: true })
  if (Object.keys(patch).length === 0) return
  store.updateNode(targetNodeId, { meta: { ...meta, ...patch } }, { history: false })
}

/**
 * 连线手势的边已经建上之后调（每条新边一次）。传进来的 store 必须是**此刻**的（`get()`），两步之间会重读。
 * `mode` 是这条新边**落库后**的 mode（不是调用方请求的那个——writeCanvasEdge 的请求 mode 可以缺省、会被连线规则改写）。
 */
export function deriveTargetAfterConnect(
  getStore: () => ConnectDerivationStore,
  sourceNodeId: string,
  targetNodeId: string,
  mode: GenerationCanvasEdgeMode | undefined,
): void {
  void sourceNodeId
  seedTargetVideoAspect(getStore(), targetNodeId, mode)
}
