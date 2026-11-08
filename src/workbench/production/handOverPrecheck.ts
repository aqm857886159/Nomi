import { paidNodeLedger } from '../generationCanvas/spend/spendConfirm'
// 「这几镜交给画布，哪几镜本机就能判定发不出去」——Agent 付费卡（出卡前、渲染时）与交接那一步
// （`production.hand-over-shots`，开同意前）读同一个判据（D2 第③步，债 a）。
//
// ── 为什么要在花钱的闸之前判 ──
//
// 空提示词、图生视频没有首帧、3D-BOX 预演没就绪、引用了还没定妆的参考卡……这些在本机就看得出来。以前要等用户点了
// 「生成」、过了付费门、交给供应商之后才报错（或者被供应商拒），钱的闸白过一遍，卡上还说不清是哪一镜、该去哪改。
// 现在卡上就把这一镜画成「参数被拒」那一格（原因 + 「去改镜 N」），主按钮不数它；交接时再判一遍，判不过的不开同意。
//
// ── 判据都不是这里新写的 ──
//
// 每一条都读画布那一侧已有的唯一判据：节点在跑 / 要核对（节点状态）、模型选了没有（`selectedVendor` / `selectedModelKey`）、
// 走不走单镜 Run（`paidNodeLedger`）、预演（`directorPreviewSpendBlock`）、输入齐不齐（`generationNodeInputsReady`，
// 生成钮置灰与提交咽喉同一个）、提示词要不要（`promptRequiredForNode`）、依赖波次（`buildDependencyWaves`，画布批量同一个）。
// 这里只把它们的结论换成交接失败的语义码（卡据此选文案与「去改镜 N」/「再试一次」）。
import type { GenerationHandOverFailure } from '../../desktop/productionRunBridgeTypes'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { selectedModelKey, selectedVendor } from '../generationCanvas/runner/catalogTaskResolve'
import { generationNodeInputsReady, unmetReferenceDependencyForNode } from '../generationCanvas/runner/generationRunController'
import { promptRequiredForNode } from '../generationCanvas/runner/promptRequirement'
import { buildDependencyWaves, type DependencyWavePlan } from '../generationCanvas/runner/dependencyWaves'
import { directorPreviewSpendBlock } from '../generationCanvas/nodes/director/model/directorPreviewState'

export type HandOverGraph = Readonly<{ nodes: readonly GenerationCanvasNode[]; edges: readonly GenerationCanvasEdge[] }>

const notSent = (code: string): GenerationHandOverFailure => ({ kind: 'not_sent', code })
const rejected = (code: string): GenerationHandOverFailure => ({ kind: 'parameter_rejected', code })

/** 依赖波次拦下的原因 → 语义码。三种都要先在画布上动一下（定妆 / 先生成上游 / 拆环），再按也没用，所以都走「去改镜 N」。 */
const BLOCKED_CODE: Readonly<Record<DependencyWavePlan['blocked'][number]['reason'], string>> = {
  'unfrozen-anchor': 'anchor_not_frozen',
  'missing-upstream': 'upstream_not_ready',
  cycle: 'reference_cycle',
}

/**
 * 一个节点自己的那几条（不看别的镜的结论）。`null` = 这一镜本机看不出发不出去。
 * `waveDecidesReferences`：它的参考由依赖波次说了算——要么来自同一批里还没出图的上游（轮到它那一波参考才齐，
 * `runGenerationNode` 提交前再判同一个判据），要么波次已经拦下了它（上游没好 / 参考卡没定妆，那句话比「缺参考」准）。
 */
function nodeHandOverFailure(node: GenerationCanvasNode | undefined, graph: HandOverGraph, waveDecidesReferences: boolean): GenerationHandOverFailure | null {
  if (!node) return notSent('canvas_node_missing')
  // 同节点还有一笔在路上 / 结果没核对：再交一次就是重复花钱（主进程派发时同样会拒，这里先不开同意）。
  if (node.status === 'queued' || node.status === 'running') return notSent('node_generation_in_flight')
  if (node.status === 'recoverable') return notSent('node_needs_reconcile')
  const vendor = selectedVendor(node)
  if (!vendor || !selectedModelKey(node)) return rejected('model_not_selected')
  // 本机模型（ComfyUI）不进单镜 Run，没有画布同意可绑：卡交不出去，去节点上自己点生成。
  if (paidNodeLedger(node) !== 'run') return rejected('local_model_on_card')
  // 下面几个判据只读不写；按它们的参数形状借用同一份数组，不为每个节点拷一遍整张画布（卡在渲染期每次画布变都会问）。
  const context = graph as { nodes: GenerationCanvasNode[]; edges: GenerationCanvasEdge[] }
  if (directorPreviewSpendBlock(node.id, graph.nodes)) return rejected('director_preview_blocked')
  if (!waveDecidesReferences && !generationNodeInputsReady(node, context)) {
    return rejected(unmetReferenceDependencyForNode(node, context) ? 'reference_combination_invalid' : 'reference_required')
  }
  if (!String(node.prompt ?? '').trim() && promptRequiredForNode(node, vendor)) return rejected('prompt_required')
  return null
}

/**
 * 这几个节点一起交给画布时，哪几个本机就能判定发不出去（节点 id → 原因）。先逐个判节点自己的，再对剩下的那一批排依赖波次：
 * 同一批里的上下游按波次先后跑（不算拦），批外上游没结果、参考卡没定妆、成环的拦下；自己没过的上游，它的下游按「上游没好」拦。
 */
export function handOverPrecheck(nodeIds: readonly string[], graph: HandOverGraph): ReadonlyMap<string, GenerationHandOverFailure> {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const batch = new Set(nodeIds)
  // 同批里谁吃谁的图、谁已经被波次拦下：画布批量排波次用的那一份（文字提示边、没定妆的参考卡的口径都在里面），不另判一遍。
  const whole = buildDependencyWaves(nodeIds, graph)
  const waveDecides = new Set([
    ...whole.edgesUsed.filter((edge) => batch.has(edge.source)).map((edge) => edge.target),
    ...whole.blocked.map((blocked) => blocked.nodeId),
  ])
  const failures = new Map<string, GenerationHandOverFailure>()
  for (const nodeId of nodeIds) {
    const failure = nodeHandOverFailure(byId.get(nodeId), graph, waveDecides.has(nodeId))
    if (failure) failures.set(nodeId, failure)
  }
  const passing = nodeIds.filter((nodeId) => !failures.has(nodeId))
  if (passing.length > 0) {
    for (const blocked of buildDependencyWaves(passing, graph).blocked) failures.set(blocked.nodeId, rejected(BLOCKED_CODE[blocked.reason]))
  }
  return failures
}
