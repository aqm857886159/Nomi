// 提议事务执行器(harness S6-2)——状态机 approved→committed/aborted 的落地层。
// 一笔提议(plan card 的 create+connect 折叠,或单工具)= 一个 proposalId = 一次原子批量:
// 全成 → agent.txn.committed;中途失败 → 补偿回滚(删已建节点)+ agent.txn.aborted,零半截(I3)。
// 事务包裹在 applyCanvasToolCall 外面(它仍是工具→变更的单一真相源,§8.1b 不动项)。
// 撤销粒度:整笔提议打一个 barrier(批准是一次用户意志,§6.2);abort 时拔掉事务内 barrier,
// Cmd+Z 永远撤不出半截态。
import { applyCanvasToolCall, resolveCanvasToolNodeId } from './applyCanvasToolCall'
import { applyCompensationOps } from './proposalUndo'
import { generationCanvasTools } from './generationCanvasTools'
import { reconcileProposal, type ReconcileResult } from './reconcile'
import { findOrphanArrayReferences } from '../runner/referenceSlots'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import { withCanvasGestureContext, type CanvasGestureContext } from '../events/canvasGestureContext'
import {
  dropUndoBarriersAfter,
  getUndoJournalPosition,
  pushUndoSnapshot,
} from '../events/canvasUndoJournal'

export type ProposalStep = {
  toolCallId: string
  toolName: string
  effectiveArgs: Record<string, unknown>
}

/** S6-5 整笔撤销的补偿计划:随事务逐步捕获,执行时倒序应用;对已消失目标全部容忍 no-op。 */
export type CompensationOp =
  | { kind: 'delete-nodes'; nodeIds: string[] }
  | { kind: 'disconnect-edges'; pairs: { source: string; target: string }[] }
  | { kind: 'restore-prompt'; nodeId: string; prompt: string }
  | { kind: 'restore-graph'; nodes: unknown[]; edges: unknown[] }

/** 编辑哨点:commit 时记下 AI 落地的节点状态,整笔撤销前对比——用户改过的要列明再丢。 */
export type ProposalWatchNode = { nodeId: string; title: string; prompt: string }

export type ProposalOutcome =
  | {
      status: 'committed'
      proposalId: string
      results: unknown[]
      clientIdToNodeId: Record<string, string>
      /** S6-3 对账(N12):执行后态 vs 批准的 effectiveArgs 逐字段比对;I4=committed 必带它。 */
      reconciliation: ReconcileResult
      /** S6-5 整笔撤销的米:补偿计划(按应用序,执行时倒序)+ 编辑哨点。 */
      compensation: CompensationOp[]
      watchNodes: ProposalWatchNode[]
    }
  | { status: 'aborted'; proposalId: string; failedIndex: number; reason: string; compensatedNodeIds: string[] }

export function mintProposalId(): string {
  return `prop_${crypto.randomUUID().slice(0, 10)}`
}

/**
 * 原子应用一笔提议的全部步骤。调用方(确认面板/auto 路径)拿 outcome 后再逐步 resolve
 * LLM 的 confirm——先落地后回话,LLM 看到的成败与画布事实一致。
 * 补偿边界:目前唯一的多步形态是 create→connect,connect 端点校验在前(skip 不抛)、
 * 唯一可补偿副作用是已建节点;删节点连带删其边,故"删已建节点"即完整补偿。
 */
export async function applyProposalBatch(steps: ProposalStep[]): Promise<ProposalOutcome> {
  const proposalId = mintProposalId()
  const ctx: CanvasGestureContext = {
    source: 'agent',
    txnId: `txn_${proposalId}`,
    proposalId,
    suppressUndoBarriers: true,
  }
  const journalStart = getUndoJournalPosition()
  // 事务自己的 barrier(在上下文外打,不被抑制):commit 后一次 Cmd+Z 撤整笔。
  pushUndoSnapshot()

  const createdNodeIds: string[] = []
  const clientIdToNodeId: Record<string, string> = {}
  const results: unknown[] = []
  // S6-5:边应用边攒补偿计划(undo 时倒序执行)。捕获必须在应用前后两侧完成——
  // 删除步靠应用前快照(restore-graph),连接步靠前后边集差(disconnect)。
  const compensation: CompensationOp[] = []

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    // 本步开始前的补偿水位:set_node_prompt/delete 的补偿在 apply 前抢先 push,
    // 若本步 apply 抛错则该补偿是假的(操作没真发生)→ 回滚时截到此水位,只回滚已完成步骤。
    const compensationMark = compensation.length
    try {
      const before = generationCanvasTools.read_canvas()
      if (step.toolName === 'set_node_prompt') {
        const nodeId = resolveCanvasToolNodeId(String(step.effectiveArgs.nodeId || '').trim())
        const node = before.nodes.find((candidate) => candidate.id === nodeId)
        if (node) compensation.push({ kind: 'restore-prompt', nodeId, prompt: node.prompt || '' })
      }
      if (step.toolName === 'delete_canvas_nodes') {
        const targetIds = new Set(
          (Array.isArray(step.effectiveArgs.nodeIds) ? step.effectiveArgs.nodeIds : [])
            .map((raw) => resolveCanvasToolNodeId(String(raw || '').trim()))
            .filter(Boolean),
        )
        const nodes = before.nodes.filter((node) => targetIds.has(node.id))
        const edges = before.edges.filter((edge) => targetIds.has(edge.source) || targetIds.has(edge.target))
        if (nodes.length) {
          compensation.push({
            kind: 'restore-graph',
            nodes: JSON.parse(JSON.stringify(nodes)) as unknown[],
            edges: JSON.parse(JSON.stringify(edges)) as unknown[],
          })
        }
      }
      const result = await applyCanvasToolCall(step.toolName, step.effectiveArgs, ctx)
      if (step.toolName === 'create_canvas_nodes' && result && typeof result === 'object') {
        const record = result as { createdNodeIds?: unknown; clientIdToNodeId?: Record<string, string> }
        if (Array.isArray(record.createdNodeIds)) {
          const ids = record.createdNodeIds.filter((id): id is string => typeof id === 'string')
          createdNodeIds.push(...ids)
          if (ids.length) compensation.push({ kind: 'delete-nodes', nodeIds: ids })
        }
        Object.assign(clientIdToNodeId, record.clientIdToNodeId ?? {})
      }
      // 新边补偿：connect 步，或 create 步随计划携带的边（节点+边一次批准）。删已建节点
      // 会连带删其边，但边可能连接两个既有节点 → disconnect 补偿仍需单独捕获。
      if (
        step.toolName === 'connect_canvas_edges' ||
        (step.toolName === 'create_canvas_nodes' && Array.isArray(step.effectiveArgs.edges) && step.effectiveArgs.edges.length)
      ) {
        const had = new Set(before.edges.map((edge) => `${edge.source}→${edge.target}`))
        const pairs = generationCanvasTools
          .read_canvas()
          .edges.filter((edge) => !had.has(`${edge.source}→${edge.target}`))
          .map((edge) => ({ source: edge.source, target: edge.target }))
        if (pairs.length) compensation.push({ kind: 'disconnect-edges', pairs })
      }
      results.push(result)
    } catch (error: unknown) {
      const reason = error instanceof Error && error.message ? error.message : String(error)
      // 截掉失败步抢先 push 的假补偿,只保留已完成步骤的补偿。
      compensation.length = compensationMark
      // 补偿回滚:倒序应用全部已完成步骤的补偿(删新建节点 + 还原改过的 prompt + 恢复删掉的节点 +
      // 断开新连的边),画布逐字节回到提议前投影(I3)。与「整笔撤销」共用 applyCompensationOps(P1)。
      const existedBefore = new Set(generationCanvasTools.read_canvas().nodes.map((node) => node.id))
      if (compensation.length) withCanvasGestureContext(ctx, () => applyCompensationOps(compensation))
      // compensatedNodeIds = 本事务新建且确被删掉的节点(事件回执沿用此语义)。
      const stillExists = new Set(generationCanvasTools.read_canvas().nodes.map((node) => node.id))
      const compensatedNodeIds = createdNodeIds.filter((id) => existedBefore.has(id) && !stillExists.has(id))
      // 拔掉指向事务中段的 barrier(含事务自己那个)——净零事件留在 journal 无害(前缀重放
      // 容忍),但 Cmd+Z 不许停在半截态上。
      dropUndoBarriersAfter(journalStart)
      withCanvasGestureContext(ctx, () =>
        emitCanvasGesture([
          {
            type: 'agent.txn.aborted',
            payload: {
              proposalId,
              reason,
              failedToolCallId: step.toolCallId,
              failedToolName: step.toolName,
              failedIndex: index,
              stepCount: steps.length,
              compensatedNodeIds,
            },
          },
        ]),
      )
      return { status: 'aborted', proposalId, failedIndex: index, reason, compensatedNodeIds }
    }
  }

  // S6-3 对账(I4):commit 回执必带 reconciliation——执行后态 vs 批准快照逐字段比对,
  // 偏差不静默(UI 渲染「执行与批准有 N 处出入」),正常时用户什么都看不见(M1)。
  const snapshot = generationCanvasTools.read_canvas()
  const reconciliation = reconcileProposal({
    steps: steps.map((step, index) => ({
      toolName: step.toolName,
      effectiveArgs: step.effectiveArgs,
      result: results[index],
    })),
    clientIdToNodeId,
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    // 跨提议 clientId 回退：与执行侧同一个全局 registry（修对账误报「未连接」，bug A）。
    resolveExternalId: resolveCanvasToolNodeId,
    // 地基收口（§1c+§1d）：显示出的数组参考必须有对应已提交边，无边有图的 meta-only 孤儿如实报。
    // snapshot.nodes/edges 是完整 GenerationCanvasNode/Edge（read_canvas 后态），findOrphanArrayReferences
    // 需要完整图类型——在此适配 reconcile 的结构化 NodeLike/EdgeLike 注入签名。
    auditOrphanArrayReferences: () => findOrphanArrayReferences(snapshot.nodes, snapshot.edges),
  })
  withCanvasGestureContext(ctx, () =>
    emitCanvasGesture([
      {
        type: 'agent.txn.committed',
        payload: {
          proposalId,
          steps: steps.map((step) => ({ toolCallId: step.toolCallId, toolName: step.toolName })),
          ...(Object.keys(clientIdToNodeId).length ? { clientIdToNodeId } : {}),
          reconciliation: {
            ok: reconciliation.ok,
            // payload ≤4KB 纪律:偏差列表截前 20 条(全量进 outcome 给 UI)。
            deviations: reconciliation.deviations.slice(0, 20),
          },
        },
      },
    ]),
  )
  // 编辑哨点:AI 落地的节点此刻状态(创建的 + 改过 prompt 的);整笔撤销前对比,改过的列明再丢。
  const watchIds = new Set<string>(createdNodeIds)
  for (const step of steps) {
    if (step.toolName === 'set_node_prompt') {
      watchIds.add(resolveCanvasToolNodeId(String(step.effectiveArgs.nodeId || '').trim()))
    }
  }
  const watchNodes: ProposalWatchNode[] = snapshot.nodes
    .filter((node) => watchIds.has(node.id))
    .map((node) => ({ nodeId: node.id, title: node.title, prompt: node.prompt || '' }))

  return { status: 'committed', proposalId, results, clientIdToNodeId, reconciliation, compensation, watchNodes }
}
