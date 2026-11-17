// 生成范围的事实适配器：把画布节点 / 分镜行翻成共用主人（`generationShotScope`）要的中立事实。
// 只翻事实、不决定谁进——成员、默认勾选、依赖先后只在主人里算（设计卡 docs/plan/2026-11-17-generation-scope-one-home.md）。
// 「有可用结果」的唯一判据也在这里（分镜行状态、锁开关、批量都读它）。
import {
  hasSelectableScopeRow,
  planGenerationScope,
  ungeneratedReferenceUpstream,
  unselectableScopeReasons,
  type GenerationScopeIntent,
  type GenerationScopePlan,
  type ScopeEdgeFacts,
  type ScopeFacts,
  type ScopeItemFacts,
} from '../../../../electron/shared/agentCapabilities/generationShotScope'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { GENERATION_NODE_KINDS, getGenerationNodeExecutionKind, type GenerationNodeKind } from '../model/generationNodeKinds'
import { isAnchorFrozen, isVisualAnchorNode } from '../model/anchorBibleKeys'
import { isTextPromptEdge } from '../agent/referenceEdgeCapability'
import { isGenerationNodeBusy } from '../components/canvasProductionScope'
import { useProductionCanvasLandingStore } from '../../production/productionCanvasLandingStore'
import type { ProductionRunsById } from '../../production/productionShotOwnership'

export type ScopeGraph = Readonly<{ nodes: readonly GenerationCanvasNode[]; edges: readonly GenerationCanvasEdge[] }>

/**
 * 「生成中」怎么读：
 *   · `full`（默认）：排队 / 生成中 / 归制作流程占着（`isGenerationNodeBusy`）；
 *   · `status`：只看节点自己的排队 / 生成中——卡上点了确认、出价开好之后再问时用（这一批自己刚开的出价会把节点标成「归制作流程」，
 *     按 full 读就会把自己剔掉）。
 * `occupied`：主进程那边此刻占着的节点（别的出价开着）。
 */
export type ScopeBusyReading = Readonly<{ busy?: 'full' | 'status'; occupied?: ReadonlySet<string>; runs?: ProductionRunsById }>

/** 「有可用结果」的唯一判据。 */
export function hasUsableResult(node: GenerationCanvasNode | undefined | null): boolean {
  if (!node) return false
  const url = node.result?.url || node.result?.thumbnailUrl
  return typeof url === 'string' && url.length > 0
}

function busyReader(reading: ScopeBusyReading): (node: GenerationCanvasNode) => boolean {
  const occupied = reading.occupied ?? new Set<string>()
  if (reading.busy === 'status') return (node) => node.status === 'queued' || node.status === 'running' || occupied.has(node.id)
  const runs = reading.runs ?? useProductionCanvasLandingStore.getState().runs
  return (node) => isGenerationNodeBusy(node, runs) || occupied.has(node.id)
}

/** 不认识的种类（旧版本 / 别处写进来的）不能生成——事实里要读整张图，上游卡的种类不一定是生成节点。 */
function isGeneratableKind(kind: string): boolean {
  return (GENERATION_NODE_KINDS as readonly string[]).includes(kind) && Boolean(getGenerationNodeExecutionKind(kind as GenerationNodeKind))
}

function itemOf(node: GenerationCanvasNode, busy: (node: GenerationCanvasNode) => boolean): ScopeItemFacts {
  return {
    id: node.id,
    title: node.title,
    generatable: isGeneratableKind(node.kind),
    hasResult: hasUsableResult(node),
    frozen: isAnchorFrozen(node),
    recoverable: node.status === 'recoverable',
    busy: busy(node),
    failed: node.status === 'error',
    settled: node.status === 'success',
    visualAnchor: isVisualAnchorNode(node),
  }
}

/** 参考边（去掉文字提示边：它不吃上游的图，不排先后）。 */
function referenceEdges(graph: ScopeGraph): ScopeEdgeFacts[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  return graph.edges.filter((edge) => {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    return !(source && target && isTextPromptEdge(source, target, edge.mode))
  }).map((edge) => ({ source: edge.source, target: edge.target }))
}

/** 整张图的事实（节点全量：上游参考卡哪怕不能生成，也要读它有没有图、定没定妆）。 */
export function scopeFactsOf(graph: ScopeGraph, reading: ScopeBusyReading = {}): ScopeFacts {
  const busy = busyReader(reading)
  return { items: graph.nodes.map((node) => itemOf(node, busy)), edges: referenceEdges(graph) }
}

/** 画布入口的问法：意图 + 选的那几个 + 当前画布 → 规划。 */
export function planCanvasGenerationScope(intent: GenerationScopeIntent, selection: readonly string[], graph: ScopeGraph, reading: ScopeBusyReading = {}): GenerationScopePlan {
  return planGenerationScope({ intent, selection, facts: scopeFactsOf(graph, reading) })
}

/** 按钮可用态：这几个节点里有没有能勾的。每次画布变化都要算——只翻这几个，不翻整张图、不读边。 */
export function hasSelectableCanvasScope(intent: GenerationScopeIntent, nodeIds: readonly string[], nodes: readonly GenerationCanvasNode[], reading: ScopeBusyReading = {}): boolean {
  if (nodeIds.length === 0) return false
  const wanted = new Set(nodeIds)
  const busy = busyReader(reading)
  return hasSelectableScopeRow(intent, nodes.filter((node) => wanted.has(node.id)).map((node) => itemOf(node, busy)))
}

/** 按钮置灰时说给创作者听的原因：这几个节点一个都勾不上时，各因为什么（主人算，这里只翻事实）。能勾 → null。 */
export function canvasScopeUnselectableReasons(intent: GenerationScopeIntent, nodeIds: readonly string[], nodes: readonly GenerationCanvasNode[], reading: ScopeBusyReading = {}): ReturnType<typeof unselectableScopeReasons> {
  const wanted = new Set(nodeIds)
  const busy = busyReader(reading)
  return unselectableScopeReasons(intent, nodes.filter((node) => wanted.has(node.id)).map((node) => itemOf(node, busy)))
}

/** 单发浮框的「还要先补哪几张参考」（浮框提示与 ↑ 共用主人的同一个判据）。 */
export function collectUngeneratedReferenceAncestors(nodeId: string, graph: ScopeGraph): string[] {
  return ungeneratedReferenceUpstream(nodeId, { items: graph.nodes.map((node) => ({ id: node.id, hasResult: hasUsableResult(node) }) as ScopeItemFacts), edges: referenceEdges(graph) })
}

/** 分镜一行翻成事实：行状态已经由行 derive 读过两个节点（首帧 + 镜头），这里只照它翻，不再读节点。 */
export function storyboardRowScopeItem(id: string, status: string): ScopeItemFacts {
  const done = status === 'done' || status === 'locked'
  return {
    id,
    generatable: true,
    hasResult: done,
    // 行状态 locked = 定了妆、有结果（行 derive 已经读过 meta.frozen）
    frozen: status === 'locked',
    recoverable: status === 'recoverable',
    busy: status === 'generating',
    failed: status === 'failed',
    settled: done,
    missingRequired: status === 'missing-required',
    visualAnchor: false,
  }
}

/** 分镜参考卡翻成事实：已经摆到画布上的按节点翻；还没摆上去的 = 一张还没生成过的卡。 */
export function storyboardAnchorScopeItem(id: string, node: GenerationCanvasNode | null | undefined, reading: ScopeBusyReading = {}): ScopeItemFacts {
  if (node) return { ...itemOf(node, busyReader(reading)), id, generatable: true }
  return { id, generatable: true, hasResult: false, frozen: false, recoverable: false, busy: false, failed: false, settled: false, visualAnchor: true }
}
