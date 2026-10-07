// 画布写边界的统一提交口：所有「整图 / 整节点写回」的唯一实现。
//
// 节点对象里混着编辑层（位置、提示词、参数、连线）和事实层（运行态、落地结果、跟主图走的媒体尺寸——钱已经花了）。
// 整写的门有好几扇：撤销 / 重做、外部 MCP 整张写回、放回被删的节点（提案 restore-graph、分镜删行撤销）、
// 放回节点字段（提案 restore-node-fields）、项目装载。以前每扇门各自记得「事实层取此刻的」（#1065 撤销叠回、
// #1072 外部写只取运行态、#1073 撤销日志里的暂存），一门一补，V-1072 又找出一扇没补的。现在只有这里一份规则：
//
//   **编辑层取传进来的，事实层取活的**（electron/shared/canvas/landedNodeFields 的 withLiveNodeFacts /
//   withLiveRunState，主进程盘上外部写用的是同一个函数）；
//   **节点不在时到达的结局**按 nodeId 暂存在 store（heldNodeOutcomes），任何一扇门把节点带回来都在这里自动接上，
//   接上的那一刻记一笔落地（run-updated 带 landed），之后的撤销 / 重做照常叠回。
//
// 撤销 / 重做是唯一允许回退落地字段的门（用户撤「设为主图 / 删版本」这类自己的编辑）：它取目标位置的投影，
// 再按顺序把目标位置之后的落地叠回去，运行态取活的；撤销「建节点」时带着落地结果的节点留下（协调会话 10-07 定 B）。
//
// 结构约束：store 里 layer 为 'document' 的动作只能在这个文件里实现（canvasWriteBoundary 的动作分层表 +
// CanvasDocumentActions 的键与之相等的类型断言）；它们只构造一份 CanvasDocumentWrite 交给 commit。
import { backfillShotIndexes } from '../model/shotNumbering'
import { replayCanvasEvents } from '../events/canvasEventReducer'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import { getHistoryFlags, popRedo, popUndo, pushUndoSnapshot, seedUndoJournalBase, type ProductionCanvasHistoryIntent, type UndoRestore } from '../events/canvasUndoJournal'
import { mergeExternalCanvasWrite, type CanvasDocLike } from '../../../../electron/shared/canvas/externalCanvasWrite'
import { withLiveNodeFacts, withLiveRunState } from '../../../../electron/shared/canvas/landedNodeFields'
import { convergeDeconstructionNodes } from '../nodes/shotTable/deconstructionLifecycle'
import type { GenerationCanvasEdge, GenerationCanvasNode, NodeGroup } from '../model/generationCanvasTypes'
import { bumpPersistRevision } from './canvasGuards'
import { clearClipboard } from './canvasClipboard'
import { normalizeStoreSnapshot } from './canvasSnapshotNormalizer'
import { nodeRunOutcomePatch, type HeldNodeOutcome } from './nodeRunOutcome'
import type { CanvasDocumentActions, CanvasSliceCreator, GenerationCanvasState, HeldNodeOutcomes } from './canvasStoreTypes'
import { emitProductionCanvasSignal } from '../../production/productionCanvasSignals'

/** 一次整写：哪扇门、带了什么。commit 按种类穷举处理，新加种类不处理就编译不过。 */
export type CanvasDocumentWrite =
  /** 打开项目：没有活的画布可比，事实就是快照里的（含重启收敛）；暂存清空，撤销基线从这里起。 */
  | Readonly<{ kind: 'load'; snapshot: unknown }>
  /** 打开项目时重放快照之后落盘的事件尾巴（崩溃恢复）。 */
  | Readonly<{ kind: 'load-tail'; events: readonly { type: string; payload: Record<string, unknown> }[] }>
  /** 撤销 / 重做：目标位置的投影 + 之后的落地。 */
  | Readonly<{ kind: 'rewind'; restore: UndoRestore; direction: 'undo' | 'redo' }>
  /** 外部 MCP 整张写回：base = 外部读到的那份，next = 它算出的整张；只合它自己改了的编辑。 */
  | Readonly<{ kind: 'external'; base: CanvasDocLike; next: CanvasDocLike }>
  /** 按原 id 放回被删的节点 / 边（已在的跳过，不覆盖现状）。 */
  | Readonly<{ kind: 'put-back'; nodes: readonly GenerationCanvasNode[]; edges: readonly GenerationCanvasEdge[] }>
  /** 把一个仍在的节点的 meta / prompt 放回某一刻（编辑层），事实层取活的。 */
  | Readonly<{ kind: 'node-fields'; nodeId: string; meta: Readonly<Record<string, unknown>>; prompt: string }>

type Returned = Readonly<{ node: GenerationCanvasNode; outcomes: HeldNodeOutcome[] }>
type FactRule = (target: GenerationCanvasNode, live: GenerationCanvasNode) => GenerationCanvasNode

function readOutcome(landed: Readonly<Record<string, unknown>>): HeldNodeOutcome | null {
  if (landed.kind === 'result' && landed.result && typeof landed.result === 'object') return landed as unknown as HeldNodeOutcome
  if (landed.kind === 'content' && landed.contentJson && typeof landed.contentJson === 'object') return landed as unknown as HeldNodeOutcome
  if (landed.kind === 'status' && typeof landed.status === 'string') return landed as unknown as HeldNodeOutcome
  if (landed.kind === 'run-started' && landed.run && typeof landed.run === 'object') return landed as unknown as HeldNodeOutcome
  return null
}

/** 生成结果 / 文本定稿才算「节点上落过付费结果」（撤销建节点时据此留下节点）；运行状态不算。 */
const isPaidLanding = (outcome: HeldNodeOutcome | null) => outcome?.kind === 'result' || outcome?.kind === 'content'

const layOutcomes = (node: GenerationCanvasNode, outcomes: readonly HeldNodeOutcome[]) =>
  outcomes.reduce<GenerationCanvasNode>((current, outcome) => ({ ...current, ...nodeRunOutcomePatch(current, outcome) }), node)

/**
 * 唯一的事实层规则：活着的节点按 `rule` 取活的事实；活的画布上没有、这次被带回来的节点，叠上它不在期间暂存的结局。
 */
export function settleNodeFacts(
  target: readonly GenerationCanvasNode[],
  live: readonly GenerationCanvasNode[],
  held: HeldNodeOutcomes,
  rule: FactRule,
): { nodes: GenerationCanvasNode[]; returned: Returned[] } {
  const liveById = new Map(live.map((node) => [node.id, node]))
  const returned: Returned[] = []
  const nodes = target.map((node) => {
    const current = liveById.get(node.id)
    if (current) return rule(node, current)
    const pending = held[node.id]
    if (!pending?.length) return node
    const landed = layOutcomes(node, pending)
    returned.push({ node: landed, outcomes: pending })
    return landed
  })
  return { nodes, returned }
}

/** 撤销 / 重做的后态：目标投影 + 之后的落地按顺序叠回 + 运行态取活的 + 规则 B。 */
function settleRewind(restore: UndoRestore, live: readonly GenerationCanvasNode[], held: HeldNodeOutcomes) {
  const { projection, landingsAfter, nodeIdsSeenBefore } = restore
  const byId = new Map(projection.nodes.map((node) => [node.id, node]))
  for (const { nodeId, landed } of landingsAfter) {
    const node = byId.get(nodeId)
    const outcome = readOutcome(landed)
    if (node && outcome) byId.set(nodeId, { ...node, ...nodeRunOutcomePatch(node, outcome) })
  }
  const settled = settleNodeFacts(projection.nodes.map((node) => byId.get(node.id)!), live, held, withLiveRunState)
  // 规则 B：撤销的正是「建这个节点」（目标位置及之前它从没出现过），而它在那之后落过付费结果 → 节点原样留下；
  // 它挂的分组若被这一步撤掉了，摘掉分组标记。重做「删节点」不在此列：那个节点在目标位置之前出现过。
  const paid = new Set(landingsAfter.filter(({ landed }) => isPaidLanding(readOutcome(landed))).map(({ nodeId }) => nodeId))
  const kept = live
    .filter((node) => !byId.has(node.id) && paid.has(node.id) && !nodeIdsSeenBefore.has(node.id))
    .map((node) => {
      if (!node.groupId || projection.groups.some((group) => group.id === node.groupId && group.nodeIds.includes(node.id))) return node
      const next = { ...node }
      delete next.groupId
      return next
    })
  return { nodes: [...settled.nodes, ...kept], edges: projection.edges, groups: projection.groups, returned: settled.returned }
}

function withoutReturned(held: HeldNodeOutcomes, returned: readonly Returned[]): HeldNodeOutcomes {
  if (!returned.length) return held
  const next = { ...held }
  for (const { node } of returned) delete next[node.id]
  return next
}

/** 带回来的节点补落的结局记一笔落地：之后的撤销 / 重做按它叠回（与运行时落地同一个事件）。 */
function emitReturnedLandings(returned: readonly Returned[]): void {
  emitCanvasGesture(
    returned.flatMap(({ node, outcomes }) => outcomes.map((landed) => ({ type: 'canvas.node.run-updated', payload: { node, landed } }))),
    { source: 'runtime' },
  )
}

type Projection = Readonly<{ nodes: GenerationCanvasNode[]; edges: GenerationCanvasEdge[]; groups: NodeGroup[] }>

function emitProductionSignalsForDocumentChange(before: readonly GenerationCanvasNode[], after: readonly GenerationCanvasNode[]): void {
  const beforeIds = new Set(before.map((node) => node.id))
  const afterIds = new Set(after.map((node) => node.id))
  emitProductionCanvasSignal({ kind: 'detach', nodes: before.filter((node) => !afterIds.has(node.id)) })
  emitProductionCanvasSignal({ kind: 'reattach', nodes: after.filter((node) => !beforeIds.has(node.id)) })
}

function invertProductionCanvasIntent(intent: ProductionCanvasHistoryIntent): ProductionCanvasHistoryIntent {
  if (intent.kind === 'none') return intent
  return {
    kind: 'signals',
    signals: intent.signals.map((signal) => ({
      kind: signal.kind === 'detach' ? 'reattach' : 'detach',
      nodes: signal.nodes,
    })),
  }
}

function replayProductionCanvasIntent(restore: UndoRestore, direction: 'undo' | 'redo'): void {
  const intent = direction === 'undo'
    ? invertProductionCanvasIntent(restore.productionCanvasIntent)
    : restore.productionCanvasIntent
  if (intent.kind === 'none') return
  for (const signal of intent.signals) emitProductionCanvasSignal(signal)
}

export const createCanvasDocumentActions: CanvasSliceCreator<CanvasDocumentActions> = (set, get) => {
  /** 换掉整张图（撤销 / 重做 / 外部写）：选区 clamp 到仍在的节点，连线手势作废。 */
  const replaceDocument = (next: Projection, held: HeldNodeOutcomes, extra?: (state: GenerationCanvasState) => void) => {
    set((state) => {
      state.nodes = next.nodes
      state.edges = next.edges
      state.groups = next.groups
      state.heldNodeOutcomes = held
      extra?.(state)
      const surviving = new Set(next.nodes.map((node) => node.id))
      state.selectedNodeIds = state.selectedNodeIds.filter((id) => surviving.has(id))
      state.pendingConnectionSourceId = ''
      state.pendingConnectionSourceSide = 'right'
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
  }

  const commit = (write: CanvasDocumentWrite): void => {
    switch (write.kind) {
      case 'load': {
        const normalized = normalizeStoreSnapshot(write.snapshot)
        // S5-b-2:journal 起点 = 恢复出的画布(undo 最远只回放到这帧,不会塌到空白)
        seedUndoJournalBase({ nodes: normalized.nodes, edges: normalized.edges, groups: normalized.groups })
        clearClipboard()
        set({
          isReady: true,
          persistRevision: get().persistRevision,
          nodes: normalized.nodes,
          edges: normalized.edges,
          groups: normalized.groups,
          workflowTemplates: normalized.workflowTemplates || [],
          heldNodeOutcomes: {},
          // S5-b-0:重开项目不再恢复幽灵选区(老 payload 里残存的 selectedNodeIds 忽略)
          selectedNodeIds: [],
          pendingConnectionSourceId: '',
          pendingConnectionSourceSide: 'right',
          hasClipboard: false,
          ...getHistoryFlags(),
        })
        // genesis 事件不在这里发(S5-b-1):必须等 hydrate 尾部重放完成后由
        // workbenchProjectSession 以"含尾巴的后态"发,否则磁盘日志最终态会丢尾巴。
        return
      }
      case 'load-tail': {
        // S5-b-1 崩溃恢复:把快照之后落盘的事件(lastSeq 尾巴)重放回投影。reducer 全 case 幂等。
        if (!write.events.length) return
        const state = get()
        const projection = replayCanvasEvents(write.events, { nodes: state.nodes, edges: state.edges, groups: state.groups })
        // 拆解进度的每一下写都走 canvas.node.updated 进了事件日志，重放会把 `status: 'running'` 原样写回来——
        // 终态判定的 owner 只有一份，重放完再问它一次；已终态的表它原样返回，幂等（重启后拆解表卡在「进行中」就是这一下）。
        set({ nodes: convergeDeconstructionNodes(projection.nodes), edges: projection.edges, groups: projection.groups })
        return
      }
      case 'rewind': {
        const live = get()
        const next = settleRewind(write.restore, live.nodes, live.heldNodeOutcomes)
        replaceDocument(next, withoutReturned(live.heldNodeOutcomes, next.returned))
        // 影子记账:撤销=全量后态(replay≡snapshot 恒真)
        emitCanvasGesture([{ type: 'canvas.snapshot.restored', payload: { snapshot: { nodes: next.nodes, edges: next.edges, groups: next.groups } } }])
        emitReturnedLandings(next.returned)
        replayProductionCanvasIntent(write.restore, write.direction)
        return
      }
      case 'external': {
        // A 模式实时桥：外部 MCP 改动经主进程算好整张，这里按它读到的那份三方合并到此刻的画布（与盘上同一个合并函数）。
        // 规范化里的「重启收敛」只对装载成立；会话中途应用时事实层一律以此刻的为准（下面 settleNodeFacts）。
        const live = get()
        const merged = mergeExternalCanvasWrite({ base: write.base, next: write.next, current: live.readDocumentSnapshot() })
        const normalized = normalizeStoreSnapshot(merged)
        const settled = settleNodeFacts(normalized.nodes, live.nodes, live.heldNodeOutcomes, withLiveNodeFacts)
        const next = { nodes: settled.nodes, edges: normalized.edges, groups: normalized.groups }
        pushUndoSnapshot(live) // 入历史:外部改动可被用户 Ctrl+Z 撤销
        replaceDocument(next, withoutReturned(live.heldNodeOutcomes, settled.returned), (state) => {
          state.workflowTemplates = normalized.workflowTemplates || state.workflowTemplates
        })
        emitCanvasGesture([{ type: 'canvas.snapshot.restored', payload: { snapshot: next } }])
        emitReturnedLandings(settled.returned)
        emitProductionSignalsForDocumentChange(live.nodes, next.nodes)
        return
      }
      case 'put-back': {
        const live = get()
        const existingNodeIds = new Set(live.nodes.map((node) => node.id))
        const existingEdgeIds = new Set(live.edges.map((edge) => edge.id))
        const incoming = write.nodes.filter((node) => node?.id && !existingNodeIds.has(node.id))
        const numbered = backfillShotIndexes([...live.nodes, ...incoming]).nodes.slice(live.nodes.length)
        const settled = settleNodeFacts(numbered, live.nodes, live.heldNodeOutcomes, withLiveNodeFacts)
        const addEdges = write.edges.filter((edge) => edge?.id && !existingEdgeIds.has(edge.id))
        if (!settled.nodes.length && !addEdges.length) return
        pushUndoSnapshot(live)
        set((state) => {
          state.nodes = [...state.nodes, ...settled.nodes]
          state.edges = [...state.edges, ...addEdges]
          state.heldNodeOutcomes = withoutReturned(state.heldNodeOutcomes, settled.returned)
          bumpPersistRevision(state)
          Object.assign(state, getHistoryFlags())
        })
        emitCanvasGesture([
          ...settled.nodes.map((node) => ({ type: 'canvas.node.added', payload: { node } })),
          ...addEdges.map((edge) => ({ type: 'canvas.edge.added', payload: { edge } })),
        ])
        emitProductionCanvasSignal({ kind: 'reattach', nodes: incoming })
        emitReturnedLandings(settled.returned)
        return
      }
      case 'node-fields': {
        const current = get().nodes.find((node) => node.id === write.nodeId)
        // 节点已被删 = 无可放回（与其它补偿同样容忍 no-op）。
        if (!current) return
        const settled = withLiveNodeFacts({ ...current, meta: { ...write.meta }, prompt: write.prompt }, current)
        get().updateNode(write.nodeId, { meta: settled.meta, prompt: settled.prompt })
        return
      }
      default: {
        const unhandled: never = write
        throw new Error(`canvas document write not handled: ${JSON.stringify(unhandled)}`)
      }
    }
  }

  return {
    restoreSnapshot: (snapshot) => commit({ kind: 'load', snapshot }),
    applyEventTail: (events) => commit({ kind: 'load-tail', events }),
    undo: () => {
      const restore = popUndo()
      if (restore) commit({ kind: 'rewind', restore, direction: 'undo' })
    },
    redo: () => {
      const restore = popRedo()
      if (restore) commit({ kind: 'rewind', restore, direction: 'redo' })
    },
    applyExternalGraph: ({ base, next }) => commit({ kind: 'external', base, next }),
    restoreGraph: (nodes, edges) => commit({ kind: 'put-back', nodes, edges }),
    restoreNodeFields: (nodeId, meta, prompt) => commit({ kind: 'node-fields', nodeId, meta, prompt }),
  }
}
