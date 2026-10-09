// 整笔撤销(harness S6-5,N13)——按 proposalId 把一笔已 commit 的提议作为整体回退。
// 与 Cmd+Z 的区别:Cmd+Z 是日志前缀重放(回退「之后的一切」),整笔撤销是**补偿事务**
// (只回退这笔提议的效果,期间用户自己的工作保留)。
// 入口三约束(总方案 §8.1b S6,①经审计 A6 修订):① committed 卡存活到下一笔提议
// 或被撤销——**随 conversations.json 落盘,app 重启后撤销入口仍在**(此前是内存
// 单槽,一次 reload 撤销入口永久蒸发);② 画布 toast 第二入口;③ 切项目/清空对话
// 时清内存槽(各项目各自文件,重开该项目时从盘种回)。
// 补偿事件进 Cmd+Z 栈(一个 barrier):撤销「撤销」= 一次 Cmd+Z,AI 节点回来。
import React from 'react'
import { flushEmbeddedEditors } from './embeddedEditorFlush'
import {
  parseProjectAgentCommittedProposal,
  type ProjectAgentCommittedProposalRecord,
  type ProjectAgentProposalCompensation,
  type ProjectAgentProposalReceiptLifecycle,
  type ProjectAgentProposalReceiptTransition,
  type ProjectAgentProposalReceiptView,
} from '../../../../electron/shared/projectAgentProposalReceipt'
import type { ProjectBinding } from '../../../../electron/shared/projectBinding'
import { sameProjectAgentBinding } from '../../../../electron/shared/projectBinding'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import { withCanvasGestureContext } from '../events/canvasGestureContext'
import { pushUndoSnapshot } from '../events/canvasUndoJournal'
import { findCanvasChange } from '../events/canvasUndoJournal'
import { makeChangeId, parseChangeId } from '../../../../electron/shared/agentCapabilities/changeId'
import { ownPendingCanvasWrite } from '../events/canvasWriteBoundary'
import type { GenerationCanvasEdge, GenerationCanvasNode, TiptapDocJson } from '../model/generationCanvasTypes'
import { laneReceiptClient } from '../../ai/lane/laneReceiptClient'
import { laneClient } from '../../ai/lane/laneClient'
import { compensationFromBeforeImage } from './beforeImageCompensation'

export type CommittedProposalRecord = ProjectAgentCommittedProposalRecord

// ---- committed 记录 mini-store(单笔:下一笔覆盖上一笔;约束 ①) ----
let current: CommittedProposalRecord | null = null
let currentReceipt: ProjectAgentProposalReceiptView | null = null
const listeners = new Set<() => void>()
const locallyUndoneChangeIds = new Set<string>()

function notify(): void {
  listeners.forEach((listener) => listener())
}

export function setCommittedProposal(record: CommittedProposalRecord): void {
  const parsed = parseProjectAgentCommittedProposal(record)
  if (!parsed) throw new Error('Project Agent proposal receipt is invalid')
  current = parsed
  locallyUndoneChangeIds.delete(makeChangeId('canvas', parsed.proposalId))
  notify()
}

/** 约束 ③：切项目/清空当前作品时只清 renderer 的临时 receipt 视图。 */
export function clearCommittedProposal(): void {
  if (!current && !currentReceipt) return
  current = null
  currentReceipt = null
  notify()
}

export function useCommittedProposal(): CommittedProposalRecord | null {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
  )
}

// ---- 持久化接口:Project Agent receipt service 把单槽按项目绑定落盘 ----

export function getCommittedProposal(): CommittedProposalRecord | null {
  return current
}

export function subscribeCommittedProposal(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 从盘上数据还原 record:形状校验失败返回 null(损坏数据不种回,撤销入口宁缺勿错)。 */
export function parseCommittedProposalRecord(input: unknown): CommittedProposalRecord | null {
  return parseProjectAgentCommittedProposal(input)
}

// C2：这三维正是 owner 的 `sameProjectAgentBinding`，逐字抄了一遍。改成 import。
function sameBinding(left: ProjectBinding | null, right: ProjectBinding): boolean {
  return Boolean(left) && sameProjectAgentBinding(left as ProjectBinding, right)
}

function sameProposal(left: CommittedProposalRecord, right: CommittedProposalRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function receiptForBinding(
  receipt: ProjectAgentProposalReceiptView | null,
  binding: ProjectBinding,
): ProjectAgentProposalReceiptView | null {
  if (
    !receipt ||
    !sameBinding(receipt.binding, binding) ||
    !Number.isSafeInteger(receipt.revision) ||
    receipt.revision < 1 ||
    !['preparing', 'committed', 'undoing', 'undone'].includes(receipt.lifecycle) ||
    typeof receipt.operationId !== 'string' ||
    !receipt.operationId.trim()
  ) return null
  const proposal = parseProjectAgentCommittedProposal(receipt.proposal)
  if (!proposal || receipt.proposalId !== proposal.proposalId) return null
  return Object.freeze({ ...receipt, binding: Object.freeze({ ...receipt.binding }), proposal })
}

function installReceipt(receipt: ProjectAgentProposalReceiptView): void {
  currentReceipt = receipt
  current =
    (receipt.lifecycle === 'committed' || receipt.lifecycle === 'undoing') && receipt.proposal.compensation.length > 0
      ? receipt.proposal
      : null
  notify()
}

function activeReceiptContext(): Readonly<{
  subscriptionId: string
  binding: ProjectBinding
}> {
  const projection = laneClient.context()
  if (!projection?.subscriptionId || !projection.binding) throw new Error('project_agent_unavailable')
  return Object.freeze({ subscriptionId: projection.subscriptionId, binding: projection.binding })
}

function contextIsCurrent(context: Readonly<{ subscriptionId: string; binding: ProjectBinding }>): boolean {
  const latest = laneClient.context()
  return latest?.subscriptionId === context.subscriptionId && sameBinding(latest.binding, context.binding)
}

async function readReceipt(
  context: Readonly<{ subscriptionId: string; binding: ProjectBinding }>,
): Promise<ProjectAgentProposalReceiptView | null> {
  const receipt = receiptForBinding(
    await laneReceiptClient.readProposalReceipt(context.subscriptionId),
    context.binding,
  )
  return contextIsCurrent(context) ? receipt : null
}

/** Seeds only a validated receipt for the currently installed Host projection. */
export function hydrateCommittedProposalReceipt(receipt: ProjectAgentProposalReceiptView | null): boolean {
  const binding = laneClient.context()?.binding
  if (!binding) return false
  const parsed = receiptForBinding(receipt, binding)
  if (!parsed) return false
  installReceipt(parsed)
  return true
}

async function adoptWriteReadback(
  context: Readonly<{ subscriptionId: string; binding: ProjectBinding }>,
  expected: Readonly<{
    lifecycle: ProjectAgentProposalReceiptLifecycle
    proposal: CommittedProposalRecord
    operationId: string
  }>,
): Promise<ProjectAgentProposalReceiptView | null> {
  const readback = await readReceipt(context)
  if (
    !readback ||
    readback.lifecycle !== expected.lifecycle ||
    readback.operationId !== expected.operationId ||
    !sameProposal(readback.proposal, expected.proposal)
  ) return null
  return readback
}

/** Durable preparation precedes every reversible Canvas mutation. */
export async function prepareProposalReceipt(record: CommittedProposalRecord): Promise<boolean> {
  const proposal = parseProjectAgentCommittedProposal(record)
  if (!proposal) throw new Error('Project Agent proposal receipt is invalid')
  const context = activeReceiptContext()
  const existing = await readReceipt(context)
  if (!contextIsCurrent(context)) return false
  const operationId = `proposal-prepare:${proposal.proposalId}`
  let written: ProjectAgentProposalReceiptView
  try {
    written = await laneReceiptClient.writeProposalReceipt(context.subscriptionId, {
      expectedRevision: existing?.revision ?? 0,
      proposalId: proposal.proposalId,
      operationId,
      lifecycle: 'preparing',
      proposal,
    })
  } catch (error) {
    const readback = await adoptWriteReadback(context, { lifecycle: 'preparing', proposal, operationId })
    if (!readback) throw error
    written = readback
  }
  if (!contextIsCurrent(context)) return false
  const validated = receiptForBinding(written, context.binding)
  if (!validated || validated.lifecycle !== 'preparing' || !sameProposal(validated.proposal, proposal)) {
    throw new Error('Project Agent proposal receipt is invalid')
  }
  installReceipt(validated)
  return true
}

/** Undo becomes visible only after the precise committed record is durable. */
export async function commitProposalReceipt(record: CommittedProposalRecord): Promise<boolean> {
  const proposal = parseProjectAgentCommittedProposal(record)
  if (!proposal) throw new Error('Project Agent proposal receipt is invalid')
  const context = activeReceiptContext()
  let prepared = currentReceipt
  if (!prepared || prepared.lifecycle !== 'preparing' || prepared.proposalId !== proposal.proposalId) {
    prepared = await readReceipt(context)
  }
  if (!prepared || prepared.lifecycle !== 'preparing' || prepared.proposalId !== proposal.proposalId) {
    throw new Error('Project Agent proposal receipt preparation is unavailable')
  }
  const operationId = `proposal-commit:${proposal.proposalId}`
  let written: ProjectAgentProposalReceiptView
  try {
    written = await laneReceiptClient.writeProposalReceipt(context.subscriptionId, {
      expectedRevision: prepared.revision,
      proposalId: proposal.proposalId,
      operationId,
      lifecycle: 'committed',
      proposal,
    })
  } catch (error) {
    const readback = await adoptWriteReadback(context, { lifecycle: 'committed', proposal, operationId })
    if (!readback) throw error
    written = readback
  }
  if (!contextIsCurrent(context)) return false
  const validated = receiptForBinding(written, context.binding)
  if (!validated || validated.lifecycle !== 'committed' || !sameProposal(validated.proposal, proposal)) {
    throw new Error('Project Agent proposal receipt is invalid')
  }
  installReceipt(validated)
  return true
}

export async function abortPreparedProposalReceipt(proposalId: string): Promise<void> {
  const context = activeReceiptContext()
  let prepared = currentReceipt
  if (!prepared || prepared.lifecycle !== 'preparing' || prepared.proposalId !== proposalId) {
    prepared = await readReceipt(context)
  }
  if (!prepared || prepared.lifecycle === 'undone') return
  if (prepared.lifecycle !== 'preparing' || prepared.proposalId !== proposalId) {
    throw new Error('Project Agent proposal receipt preparation is unavailable')
  }
  const operationId = `proposal-abort:${proposalId}`
  let completed: ProjectAgentProposalReceiptView
  try {
    completed = await laneReceiptClient.transitionProposalReceipt(context.subscriptionId, {
      expectedRevision: prepared.revision,
      proposalId,
      operationId,
      lifecycle: 'undone',
    })
  } catch (error) {
    const readback = await readReceipt(context)
    if (!readback || readback.lifecycle !== 'undone' || readback.operationId !== operationId) throw error
    completed = readback
  }
  if (!contextIsCurrent(context)) return
  const validated = receiptForBinding(completed, context.binding)
  if (!validated || validated.lifecycle !== 'undone' || validated.proposalId !== proposalId) {
    throw new Error('Project Agent proposal receipt is invalid')
  }
  installReceipt(validated)
}

export type ProposalReceiptMetadata = Readonly<{
  summary: string
  stepLabels: readonly string[]
  hostApprovalId?: string
  hostActionHash?: string
  categoryCounts?: CommittedProposalRecord['categoryCounts']
  anchorMessageId?: string
  anchorTextOffset?: number
  prepareCompensation?: 'canvas_snapshot' | 'none'
}>

export type ProposalReceiptDisposition = ProjectAgentProposalReceiptLifecycle | 'missing' | 'superseded'

export type ProposalReceiptCoordinator = Readonly<{
  prepare: (
    proposalId: string,
    before: Readonly<{ nodes: readonly unknown[]; edges: readonly unknown[]; groups: readonly unknown[] }>,
  ) => Promise<boolean>
  commit: (input: Readonly<{
    proposalId: string
    compensation: readonly ProjectAgentProposalCompensation[]
    watchNodes: CommittedProposalRecord['watchNodes']
    reconciliationOk: boolean
  }>) => Promise<boolean>
  abort: (proposalId: string) => Promise<void>
  disposition: (proposalId: string) => Promise<ProposalReceiptDisposition>
}>

async function readProposalReceiptDisposition(proposalId: string): Promise<ProposalReceiptDisposition> {
  const context = activeReceiptContext()
  const receipt = await readReceipt(context)
  if (!receipt) return 'missing'
  installReceipt(receipt)
  return receipt.proposalId === proposalId ? receipt.lifecycle : 'superseded'
}

export function createProposalReceiptCoordinator(metadata: ProposalReceiptMetadata): ProposalReceiptCoordinator {
  const base = (proposalId: string) => ({
    proposalId,
    ...(metadata.hostApprovalId !== undefined && metadata.hostActionHash !== undefined
      ? { hostApprovalId: metadata.hostApprovalId, hostActionHash: metadata.hostActionHash }
      : {}),
    summary: metadata.summary,
    stepLabels: metadata.stepLabels,
    ...(metadata.categoryCounts ? { categoryCounts: metadata.categoryCounts } : {}),
    ...(metadata.anchorMessageId !== undefined && metadata.anchorTextOffset !== undefined
      ? { anchorMessageId: metadata.anchorMessageId, anchorTextOffset: metadata.anchorTextOffset }
      : {}),
  })
  return Object.freeze({
    async prepare(proposalId: string, before: Readonly<{ nodes: readonly unknown[]; edges: readonly unknown[]; groups: readonly unknown[] }>) {
      const snapshot = JSON.parse(JSON.stringify({ nodes: before.nodes, edges: before.edges, groups: before.groups })) as {
        nodes: unknown[]
        edges: unknown[]
        groups: unknown[]
      }
      return prepareProposalReceipt({
        ...base(proposalId),
        compensation: metadata.prepareCompensation === 'none' ? [] : [{ kind: 'restore-snapshot', snapshot }],
        watchNodes: [],
        reconciliationOk: true,
      })
    },
    async commit(input: Readonly<{
      proposalId: string
      compensation: readonly ProjectAgentProposalCompensation[]
      watchNodes: CommittedProposalRecord['watchNodes']
      reconciliationOk: boolean
    }>) {
      return commitProposalReceipt({ ...base(input.proposalId), ...input })
    },
    abort: abortPreparedProposalReceipt,
    disposition: readProposalReceiptDisposition,
  })
}

/** Compatibility helper for non-transaction tests; production prepares before Canvas apply. */
export async function persistCommittedProposal(record: CommittedProposalRecord): Promise<boolean> {
  if (!(await prepareProposalReceipt(record))) return false
  return commitProposalReceipt(record)
}

/** 撤销前哨检:用户 commit 后改过的提议节点(提示词/标题)——列明再丢,不静默吞(N13)。 */
export function detectLostUserEdits(record: CommittedProposalRecord): string[] {
  const nodes = useGenerationCanvasStore.getState().nodes
  const lost: string[] = []
  for (const watch of record.watchNodes) {
    const node = nodes.find((candidate) => candidate.id === watch.nodeId)
    if (!node) continue // 用户已删 → 无可丢
    if ((node.prompt || '') !== watch.prompt) lost.push(`「${node.title}」的提示词已被你修改`)
    else if (node.title !== watch.title) lost.push(`「${watch.title}」的标题已被你改为「${node.title}」`)
  }
  return lost
}

/**
 * 整份放回节点字段的补偿（今天只有 3D-BOX 的 stage_shot 用：工程 + 计划 + 预演一起放回）会把提交之后这个节点上的
 * 一切改动一并抹掉——包括用户在导演台里的手调。提交之后它又被别的事务改过 → 不撤，说明原因（统一撤销的冲突规则）。
 * 调用前先 flushEmbeddedEditors()，没落盘的手调也算「改过」。
 */
export function wholeNodeRestoreConflict(record: CommittedProposalRecord): string | null {
  const restored = record.compensation.flatMap((op) => (op.kind === 'restore-node-fields' ? [op.nodeId] : []))
  if (!restored.length) return null
  const change = findCanvasChange(makeChangeId('canvas', record.proposalId))
  const hit = restored.find((nodeId) => change?.conflictingObjectIds.includes(nodeId))
  if (!hit) return null
  const title = useGenerationCanvasStore.getState().nodes.find((node) => node.id === hit)?.title || hit
  return `「${title}」在这笔改动之后又被你改过，撤销会把那些改动一起抹掉`
}

/** Synchronous dispatcher used by the shared `undo` surface.  The normal UI
 * path keeps its durable receipt CAS; this path reuses the same compensation
 * owner and journal conflict evidence without creating another history. */
export function runProposalUndoByChangeId(changeId: string): void {
  // An open embedded editor's unsaved hand edits must reach the journal first, so the
  // conflict check below sees them instead of the compensation silently erasing them.
  flushEmbeddedEditors()
  const parsed = parseChangeId(changeId)
  if (!parsed || parsed.kind !== 'canvas') {
    throw Object.assign(new Error('undo_change_not_found'), { code: 'undo_change_not_found' })
  }
  const record = current
  if (!record || record.proposalId !== parsed.id) {
    throw Object.assign(new Error('undo_change_not_found'), { code: 'undo_change_not_found' })
  }
  if (locallyUndoneChangeIds.has(changeId)) {
    throw Object.assign(new Error('undo_change_not_found'), { code: 'undo_change_not_found' })
  }
  const journalChange = findCanvasChange(changeId)
  const lost = detectLostUserEdits(record)
  if (journalChange?.conflictingEventTypes.length || lost.length) {
    const reason = lost[0] ?? `同一对象已有后续改动（${journalChange?.conflictingEventTypes.join(', ') || 'unknown'}）`
    throw Object.assign(new Error(`undo_conflict: ${reason}`), { code: 'undo_conflict' })
  }
  const ctx = {
    source: 'user' as const,
    txnId: `txn_undo_${record.proposalId}`,
    proposalId: record.proposalId,
    suppressUndoBarriers: false,
  }
  withCanvasGestureContext(ctx, () => {
    pushUndoSnapshot()
    applyCompensationOps(record.compensation)
    emitCanvasGesture([{ type: 'agent.txn.reverted', payload: { proposalId: record.proposalId, changeId, ops: record.compensation.length } }])
  })
  locallyUndoneChangeIds.add(changeId)
}

/**
 * 倒序应用补偿计划;对已消失目标全部容忍 no-op(用户先删了某个 AI 节点不会让回滚失败)。
 * **整笔撤销(runProposalUndo)与事务 abort 回滚共用此唯一执行体**(I3 同源,守 P1 不留第二份)。
 * 调用方负责包好 gesture context 与 barrier。
 */
export function applyCompensationOps(compensation: readonly ProjectAgentProposalCompensation[]): void {
  for (const op of [...compensation].reverse()) {
    if (op.kind === 'delete-nodes') {
      const existing = new Set(useGenerationCanvasStore.getState().nodes.map((node) => node.id))
      op.nodeIds.filter((id) => existing.has(id)).forEach((id) => useGenerationCanvasStore.getState().deleteNode(id))
    } else if (op.kind === 'disconnect-edges') {
      for (const pair of op.pairs) {
        const edge = useGenerationCanvasStore
          .getState()
          .edges.find((candidate) => candidate.source === pair.source && candidate.target === pair.target)
        if (edge) useGenerationCanvasStore.getState().disconnectEdge(edge.id)
      }
    } else if (op.kind === 'restore-prompt') {
      useGenerationCanvasStore.getState().updateNodePrompt(op.nodeId, op.prompt, op.promptOverridden)
    } else if (op.kind === 'restore-text') {
      // 正文放回提议之前的样子（和 Agent 写入同一个写口）；节点已被删 = no-op。
      useGenerationCanvasStore.getState().restoreNodeBody(op.nodeId, op.contentJson as TiptapDocJson | null)
    } else if (op.kind === 'restore-node-fields') {
      // 整节点放回只放编辑层；结果、运行态、跟主图走的媒体尺寸取此刻的（统一提交口）。节点已被删 = no-op。
      useGenerationCanvasStore.getState().restoreNodeFields(op.nodeId, op.meta, op.prompt)
    } else if (op.kind === 'restore-graph') {
      useGenerationCanvasStore
        .getState()
        .restoreGraph(op.nodes as GenerationCanvasNode[], op.edges as GenerationCanvasEdge[])
    } else if (op.kind === 'restore-snapshot') {
      // 准备中收据存的「提议之前的整张图」从不整图放回：逐对象比出差异，交给上面这些按对象补偿去做（V-1072）。
      const { nodes, edges } = useGenerationCanvasStore.getState()
      applyCompensationOps(compensationFromBeforeImage(op.snapshot, { nodes, edges }))
    }
  }
}

async function transitionReceipt(
  context: Readonly<{ subscriptionId: string; binding: ProjectBinding }>,
  receipt: ProjectAgentProposalReceiptView,
  lifecycle: ProjectAgentProposalReceiptTransition['lifecycle'],
  operationId: string,
): Promise<ProjectAgentProposalReceiptView> {
  let transitioned: ProjectAgentProposalReceiptView
  try {
    transitioned = await laneReceiptClient.transitionProposalReceipt(context.subscriptionId, {
      expectedRevision: receipt.revision,
      proposalId: receipt.proposalId,
      operationId,
      lifecycle,
    })
  } catch (error) {
    const readback = await readReceipt(context)
    if (
      !readback ||
      readback.lifecycle !== lifecycle ||
      readback.operationId !== operationId ||
      readback.proposalId !== receipt.proposalId ||
      !sameProposal(readback.proposal, receipt.proposal)
    ) throw error
    transitioned = readback
  }
  if (!contextIsCurrent(context)) throw new Error('project_agent_unavailable')
  const validated = receiptForBinding(transitioned, context.binding)
  if (
    !validated ||
    validated.lifecycle !== lifecycle ||
    validated.proposalId !== receipt.proposalId ||
    !sameProposal(validated.proposal, receipt.proposal)
  ) throw new Error('Project Agent proposal receipt is invalid')
  return validated
}

function applyProposalCompensation(record: CommittedProposalRecord, userInitiated: boolean): void {
  const ctx = {
    source: userInitiated ? ('user' as const) : ('agent' as const),
    txnId: `${userInitiated ? 'txn_undo' : 'txn_recover'}_${record.proposalId}`,
    proposalId: record.proposalId,
    suppressUndoBarriers: true,
    ...(!userInitiated ? { allowDuringCleanup: true } : {}),
  }
  if (userInitiated) {
    withCanvasGestureContext({ ...ctx, suppressUndoBarriers: false }, () => pushUndoSnapshot())
  }
  withCanvasGestureContext(ctx, () => {
    applyCompensationOps(record.compensation)
    emitCanvasGesture([
      {
        type: 'agent.txn.reverted',
        payload: { proposalId: record.proposalId, ops: record.compensation.length },
      },
    ])
  })
}

async function ownReceiptRecoveryWindow(proposalId: string): Promise<() => void> {
  const ownership = ownPendingCanvasWrite(proposalId, () => false)
  return typeof ownership === 'function' ? ownership : ownership
}

/**
 * 执行整笔撤销:补偿计划倒序应用。对已消失目标全部容忍 no-op(用户先删了某个 AI 节点
 * 不会让撤销失败)。一个 barrier:撤销「撤销」= Cmd+Z。
 */
export async function runProposalUndo(record: CommittedProposalRecord): Promise<void> {
  const proposal = parseProjectAgentCommittedProposal(record)
  if (!proposal) throw new Error('Project Agent proposal receipt is invalid')
  // 与 Agent 撤销同一个落盘点：开着的导演台里没保存的手调先进日志，下面的冲突判据才看得见它们
  flushEmbeddedEditors()
  const wholeNodeConflict = wholeNodeRestoreConflict(proposal)
  if (wholeNodeConflict) throw Object.assign(new Error(`undo_conflict: ${wholeNodeConflict}`), { code: 'undo_conflict' })
  const release = await ownReceiptRecoveryWindow(proposal.proposalId)
  let recoveryEvidenceLive = false
  let durablyCompleted = false
  try {
    const context = activeReceiptContext()
    let receipt = currentReceipt
    if (!receipt || receipt.proposalId !== proposal.proposalId) receipt = await readReceipt(context)
    if (
      !receipt ||
      receipt.proposalId !== proposal.proposalId ||
      !sameProposal(receipt.proposal, proposal)
    ) {
      throw new Error('Project Agent proposal receipt proposal mismatch')
    }
    if (receipt.lifecycle === 'committed') {
      try {
        receipt = await transitionReceipt(context, receipt, 'undoing', `proposal-undo:${proposal.proposalId}`)
        recoveryEvidenceLive = true
        installReceipt(receipt)
      } catch (error) {
        let readback: ProjectAgentProposalReceiptView | null
        try {
          readback = await readReceipt(context)
        } catch {
          recoveryEvidenceLive = true
          throw error
        }
        if (
          !readback ||
          readback.proposalId !== proposal.proposalId ||
          !sameProposal(readback.proposal, proposal)
        ) throw error
        if (readback.lifecycle === 'undone') {
          installReceipt(readback)
          durablyCompleted = true
          return
        }
        if (readback.lifecycle !== 'undoing') throw error
        receipt = readback
        recoveryEvidenceLive = true
        installReceipt(receipt)
      }
    } else if (receipt.lifecycle === 'undoing') {
      recoveryEvidenceLive = true
    } else {
      throw new Error('Project Agent proposal receipt is not undoable')
    }
    applyProposalCompensation(proposal, true)
    const completed = await transitionReceipt(
      context,
      receipt,
      'undone',
      `proposal-undo-complete:${proposal.proposalId}`,
    )
    installReceipt(completed)
    durablyCompleted = true
  } finally {
    if (durablyCompleted || !recoveryEvidenceLive) release()
  }
}

/** Reopen recovery for an interrupted apply or Undo. Compensation is idempotent. */
export async function recoverPendingProposalReceipt(): Promise<boolean> {
  const context = activeReceiptContext()
  let receipt = currentReceipt
  if (!receipt) receipt = await readReceipt(context)
  if (!receipt) return false
  // The durable journal is shared with MCP's main-process receipt owner. A
  // transport-owned proposal has no Host approval/action correlation and must
  // never be compensated by renderer recovery while its write is in flight;
  // doing so would race the MCP commit CAS and falsely undo a real effect.
  if (!receipt.proposal.hostApprovalId?.trim() || !receipt.proposal.hostActionHash?.trim()) return false
  if (receipt.lifecycle === 'committed' || receipt.lifecycle === 'undone') {
    installReceipt(receipt)
    return false
  }
  // A document/export receipt without Canvas compensation is evidence of an
  // unknown effect, not evidence that Canvas recovery can undo that effect.
  if (receipt.proposal.compensation.length === 0) return false
  installReceipt(receipt)
  const release = await ownReceiptRecoveryWindow(receipt.proposalId)
  let durablyCompleted = false
  try {
    applyProposalCompensation(receipt.proposal, false)
    const completed = await transitionReceipt(
      context,
      receipt,
      'undone',
      `proposal-recover:${receipt.operationId}`,
    )
    installReceipt(completed)
    durablyCompleted = true
    return true
  } finally {
    if (durablyCompleted) release()
  }
}
