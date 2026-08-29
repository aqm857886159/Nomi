// 提议事务执行器(harness S6-2)——状态机 approved→committed/aborted 的落地层。
// 一笔提议(plan card 的 create+connect 折叠,或单工具)= 一个 proposalId = 一次原子批量:
// 全成 → agent.txn.committed;中途失败 → 补偿回滚(删已建节点)+ agent.txn.aborted,零半截(I3)。
// 事务包裹在 applyCanvasToolCall 外面(它仍是工具→变更的单一真相源,§8.1b 不动项)。
// 撤销粒度:整笔提议打一个 barrier(批准是一次用户意志,§6.2);abort 时拔掉事务内 barrier,
// Cmd+Z 永远撤不出半截态。
import { applyCanvasToolCall, resolveCanvasToolNodeId } from './applyCanvasToolCall'
import { assertTurnCanWrite, type AgentTurnHandle } from '../../ai/agentTurnLifecycle'
import { applyCompensationOps, type ProposalReceiptCoordinator } from './proposalUndo'
import { readGenerationCanvasSnapshot } from './generationCanvasTools'
import { reconcileProposal, type ReconcileResult } from './reconcile'
import { findOrphanArrayReferences } from '../runner/referenceSlots'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import { withCanvasGestureContext, type CanvasGestureContext } from '../events/canvasGestureContext'
import { ownPendingCanvasWrite } from '../events/canvasWriteBoundary'
import {
  dropUndoBarriersAfter,
  getUndoJournalGeneration,
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

export type ProposalBatchAdmission = Readonly<{
  proposalId: string
  beforePrepare: () => void
}>

export function mintProposalId(): string {
  return `prop_${crypto.randomUUID().slice(0, 10)}`
}

/** Read the real post-state, including a synchronous mutation whose Promise
 * continuation has not run yet. Foreign document edits cannot enter until this
 * segment has been compensated, so these deltas belong to this step alone. */
function captureStepCompensation(
  step: ProposalStep,
  before: ReturnType<typeof readGenerationCanvasSnapshot>,
): CompensationOp[] {
  const after = readGenerationCanvasSnapshot()
  const ops: CompensationOp[] = []
  if (step.toolName === 'set_node_prompt') {
    const nodeId = resolveCanvasToolNodeId(String(step.effectiveArgs.nodeId || '').trim())
    const previous = before.nodes.find((node) => node.id === nodeId)
    const current = after.nodes.find((node) => node.id === nodeId)
    if (previous && current && previous.prompt !== current.prompt)
      ops.push({ kind: 'restore-prompt', nodeId, prompt: previous.prompt || '' })
  }
  if (step.toolName === 'delete_canvas_nodes') {
    const remaining = new Set(after.nodes.map((node) => node.id))
    const nodes = before.nodes.filter((node) => !remaining.has(node.id))
    const removed = new Set(nodes.map((node) => node.id))
    const edges = before.edges.filter((edge) => removed.has(edge.source) || removed.has(edge.target))
    if (nodes.length) ops.push({ kind: 'restore-graph', nodes, edges })
  }
  if (step.toolName === 'create_canvas_nodes') {
    const existing = new Set(before.nodes.map((node) => node.id))
    const nodeIds = after.nodes.filter((node) => !existing.has(node.id)).map((node) => node.id)
    if (nodeIds.length) ops.push({ kind: 'delete-nodes', nodeIds })
  }
  if (step.toolName === 'connect_canvas_edges' || step.toolName === 'create_canvas_nodes') {
    const existing = new Set(before.edges.map((edge) => `${edge.source}→${edge.target}`))
    const pairs = after.edges
      .filter((edge) => !existing.has(`${edge.source}→${edge.target}`))
      .map((edge) => ({ source: edge.source, target: edge.target }))
    if (pairs.length) ops.push({ kind: 'disconnect-edges', pairs })
  }
  return ops
}

/**
 * 原子应用一笔提议的全部步骤。调用方(确认面板/auto 路径)拿 outcome 后再逐步 resolve
 * LLM 的 confirm——先落地后回话,LLM 看到的成败与画布事实一致。
 * 新文档写入先同步接管未提交批次:补偿发生在新动作读状态/打 barrier 之前。
 * 只复用既有工具执行器、补偿操作和日志,不把异步准备变成第二个状态推进循环。
 */
export async function applyProposalBatch(
  steps: ProposalStep[],
  turn?: Pick<AgentTurnHandle, 'canWrite'>,
  receiptCoordinator?: ProposalReceiptCoordinator,
  admission?: ProposalBatchAdmission,
): Promise<ProposalOutcome> {
  if (turn) assertTurnCanWrite(turn.canWrite)
  const journalGeneration = getUndoJournalGeneration()
  const isSameCanvas = () => getUndoJournalGeneration() === journalGeneration
  let aborted: Extract<ProposalOutcome, { status: 'aborted' }> | undefined
  const canWrite = () => !aborted && isSameCanvas() && (!turn || turn.canWrite())
  const proposalId = admission ? admission.proposalId.trim() : mintProposalId()
  if (!proposalId) throw new Error('Project Agent proposal id is invalid')
  const ctx: CanvasGestureContext = {
    source: 'agent',
    txnId: `txn_${proposalId}`,
    proposalId,
    suppressUndoBarriers: true,
    canWrite,
  }
  const createdNodeIds: string[] = []
  const clientIdToNodeId: Record<string, string> = {}
  const results: unknown[] = []
  const compensation: CompensationOp[] = []
  let currentIndex = 0
  let pendingStep: { step: ProposalStep; before: ReturnType<typeof readGenerationCanvasSnapshot> } | undefined
  // A queued replacement can be superseded before its await continuation
  // receives the ownership handle. Keep that pre-write cancellation a normal
  // aborted outcome instead of touching temporal-dead-zone transaction state.
  let release: () => void = () => {}
  let journalStart: number | undefined = undefined
  let receiptPrepared = false
  let receiptCommitInFlight = false
  let retainWriteOwnerForRecovery = false
  const collectCurrentStep = () => {
    if (!pendingStep) return
    const ops = captureStepCompensation(pendingStep.step, pendingStep.before)
    compensation.push(...ops)
    for (const op of ops) if (op.kind === 'delete-nodes') createdNodeIds.push(...op.nodeIds)
    pendingStep = undefined
  }
  const abort = (reason: string): Extract<ProposalOutcome, { status: 'aborted' }> => {
    if (aborted) return aborted
    aborted = { status: 'aborted', proposalId, failedIndex: currentIndex, reason, compensatedNodeIds: [] }
    if (!isSameCanvas()) return aborted
    collectCurrentStep()
    const cleanupContext = { ...ctx, canWrite: undefined, allowDuringCleanup: true }
    const existedBefore = new Set(readGenerationCanvasSnapshot().nodes.map((node) => node.id))
    if (compensation.length) withCanvasGestureContext(cleanupContext, () => applyCompensationOps(compensation))
    const remaining = new Set(readGenerationCanvasSnapshot().nodes.map((node) => node.id))
    aborted.compensatedNodeIds = createdNodeIds.filter((id) => existedBefore.has(id) && !remaining.has(id))
    // The boundary has not admitted the next document write yet. There can be
    // no newer transaction's barrier in this compensatable segment.
    if (journalStart !== undefined) dropUndoBarriersAfter(journalStart)
    withCanvasGestureContext(cleanupContext, () =>
      emitCanvasGesture([
        {
          type: 'agent.txn.aborted',
          payload: {
            proposalId,
            reason,
            failedToolCallId: steps[currentIndex]?.toolCallId,
            failedToolName: steps[currentIndex]?.toolName,
            failedIndex: currentIndex,
            stepCount: steps.length,
            compensatedNodeIds: aborted?.compensatedNodeIds ?? [],
          },
        },
      ]),
    )
    return aborted
  }
  const abortAndFinalizeReceipt = async (
    reason: string,
  ): Promise<Extract<ProposalOutcome, { status: 'aborted' }>> => {
    const outcome = abort(reason)
    // Compensation happens first. If the durable completion marker fails, the
    // preparing receipt remains recovery evidence and reopen repeats the same
    // idempotent compensation.
    if (receiptCoordinator && receiptPrepared && isSameCanvas()) {
      try {
        await receiptCoordinator.abort(proposalId)
      } catch (error) {
        retainWriteOwnerForRecovery = true
        throw error
      }
    }
    return outcome
  }
  const currentAbortReason = (): string =>
    (aborted as Extract<ProposalOutcome, { status: 'aborted' }> | undefined)?.reason ?? 'Agent turn abandoned'
  const errorMessage = (error: unknown): string =>
    error instanceof Error && error.message ? error.message : String(error)
  // Claim before opening our own Undo point: acquiring a new batch first
  // cleans up the old one, even when both approvals came from the same turn.
  const ownership = ownPendingCanvasWrite(proposalId, () => {
    // With a durable coordinator, preparation itself can succeed after an IPC
    // acknowledgement is lost. Keep all foreign document writes outside the
    // recovery window until commit/abort disposition is durable.
    if (receiptCoordinator || receiptCommitInFlight) return false
    abort('Canvas edit superseded the pending proposal')
  })
  release = typeof ownership === 'function' ? ownership : await ownership
  try {
    if (aborted) return aborted
    try {
      admission?.beforePrepare()
    } catch (error: unknown) {
      return abort(errorMessage(error))
    }
    if (receiptCoordinator) {
      const before = readGenerationCanvasSnapshot()
      try {
        receiptPrepared = await receiptCoordinator.prepare(proposalId, before)
      } catch (error: unknown) {
        abort(errorMessage(error))
        // A lost preparation acknowledgement can still leave a durable
        // preparing record. Resolve that exact proposal before deciding
        // whether it is safe to retire the recovery evidence.
        let disposition
        try {
          disposition = await receiptCoordinator.disposition(proposalId)
        } catch {
          retainWriteOwnerForRecovery = true
          throw error
        }
        if (disposition !== 'preparing') throw error
        receiptPrepared = true
        return await abortAndFinalizeReceipt(errorMessage(error))
      }
      if (!receiptPrepared) return abort('Project Agent proposal receipt preparation is unavailable')
      if (aborted) return await abortAndFinalizeReceipt(currentAbortReason())
    }
    try {
      assertTurnCanWrite(canWrite)
      journalStart = getUndoJournalPosition()
      withCanvasGestureContext({ ...ctx, suppressUndoBarriers: false }, () => pushUndoSnapshot())
    } catch (error: unknown) {
      return await abortAndFinalizeReceipt(errorMessage(error))
    }
    for (let index = 0; index < steps.length; index += 1) {
      currentIndex = index
      const step = steps[index]
      try {
        assertTurnCanWrite(canWrite)
        pendingStep = { step, before: readGenerationCanvasSnapshot() }
        const result = await applyCanvasToolCall(step.toolName, step.effectiveArgs, ctx, canWrite)
        if (aborted) return await abortAndFinalizeReceipt(currentAbortReason())
        if (!isSameCanvas()) return await abortAndFinalizeReceipt('Agent turn abandoned')
        collectCurrentStep()
        if (step.toolName === 'create_canvas_nodes' && result && typeof result === 'object') {
          const record = result as { clientIdToNodeId?: Record<string, string> }
          Object.assign(clientIdToNodeId, record.clientIdToNodeId ?? {})
        }
        results.push(result)
        assertTurnCanWrite(canWrite)
      } catch (error: unknown) {
        return await abortAndFinalizeReceipt(errorMessage(error))
      }
    }

    // S6-3 对账(I4):commit 回执必带 reconciliation——执行后态 vs 批准快照逐字段比对,
    // 偏差不静默(UI 渲染「执行与批准有 N 处出入」),正常时用户什么都看不见(M1)。
    const snapshot = readGenerationCanvasSnapshot()
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
      // snapshot.nodes/edges 是完整 GenerationCanvasNode/Edge（事务后态），findOrphanArrayReferences
      // 需要完整图类型——在此适配 reconcile 的结构化 NodeLike/EdgeLike 注入签名。
      auditOrphanArrayReferences: () => findOrphanArrayReferences(snapshot.nodes, snapshot.edges),
    })
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

    if (receiptCoordinator) {
      receiptCommitInFlight = true
      try {
        try {
          const committed = await receiptCoordinator.commit({
            proposalId,
            compensation,
            watchNodes,
            reconciliationOk: reconciliation.ok,
          })
          if (!committed) throw new Error('Project Agent proposal receipt commit acknowledgement is unavailable')
        } catch (error: unknown) {
          // The commit IPC can lose its acknowledgement after main has already
          // fsynced the committed record. Never compensate until a readback says
          // this exact proposal is still only preparing.
          let disposition
          try {
            disposition = await receiptCoordinator.disposition(proposalId)
          } catch {
            throw error
          }
          if (disposition !== 'committed') {
            if (disposition === 'preparing') return await abortAndFinalizeReceipt(errorMessage(error))
            throw error
          }
        }
      } finally {
        receiptCommitInFlight = false
      }
    }

    release()
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

    return { status: 'committed', proposalId, results, clientIdToNodeId, reconciliation, compensation, watchNodes }
  } finally {
    if (!retainWriteOwnerForRecovery) release()
  }
}
