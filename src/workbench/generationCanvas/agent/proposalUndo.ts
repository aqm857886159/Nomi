// 整笔撤销(harness S6-5,N13)——按 proposalId 把一笔已 commit 的提议作为整体回退。
// 与 Cmd+Z 的区别:Cmd+Z 是日志前缀重放(回退「之后的一切」),整笔撤销是**补偿事务**
// (只回退这笔提议的效果,期间用户自己的工作保留)。
// 入口三约束(总方案 §8.1b S6,①经审计 A6 修订):① committed 卡存活到下一笔提议
// 或被撤销——**随 conversations.json 落盘,app 重启后撤销入口仍在**(此前是内存
// 单槽,一次 reload 撤销入口永久蒸发);② 画布 toast 第二入口;③ 切项目/清空对话
// 时清内存槽(各项目各自文件,重开该项目时从盘种回)。
// 补偿事件进 Cmd+Z 栈(一个 barrier):撤销「撤销」= 一次 Cmd+Z,AI 节点回来。
import React from 'react'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import { withCanvasGestureContext } from '../events/canvasGestureContext'
import { pushUndoSnapshot } from '../events/canvasUndoJournal'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { CompensationOp, ProposalWatchNode } from './proposalTxn'

export type CommittedProposalRecord = {
  proposalId: string
  /** 人话摘要:「创建 4 个节点 · 连接 3 条边」(committed 卡标题)。 */
  summary: string
  /** 轨迹步骤(人话标签,查看步骤直接渲染)。审计 A16 后为逐节点/逐边明细行。 */
  stepLabels: string[]
  /** 落点回报(审计 A1):本笔创建的节点按分类分组计数,卡上渲染可点的跳转 chip。 */
  categoryCounts?: Array<{ categoryId: string; label: string; count: number }>
  compensation: CompensationOp[]
  watchNodes: ProposalWatchNode[]
  reconciliationOk: boolean
}

// ---- committed 记录 mini-store(单笔:下一笔覆盖上一笔;约束 ①) ----
let current: CommittedProposalRecord | null = null
const listeners = new Set<() => void>()

export function setCommittedProposal(record: CommittedProposalRecord): void {
  current = record
  listeners.forEach((listener) => listener())
}

/** 约束 ③:切项目/清空对话时清场(swapGenerationAiProject / handleNewConversation 调)。 */
export function clearCommittedProposal(): void {
  if (!current) return
  current = null
  listeners.forEach((listener) => listener())
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

// ---- 持久化接口(审计 A6):conversationPersistence 把单槽随 conversations.json 落盘 ----

export function getCommittedProposal(): CommittedProposalRecord | null {
  return current
}

export function subscribeCommittedProposal(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 从盘上数据还原 record:形状校验失败返回 null(损坏数据不种回,撤销入口宁缺勿错)。 */
export function parseCommittedProposalRecord(input: unknown): CommittedProposalRecord | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  if (typeof raw.proposalId !== 'string' || !raw.proposalId) return null
  if (typeof raw.summary !== 'string') return null
  if (!Array.isArray(raw.stepLabels) || !raw.stepLabels.every((label) => typeof label === 'string')) return null
  if (!Array.isArray(raw.compensation) || !Array.isArray(raw.watchNodes)) return null
  return {
    proposalId: raw.proposalId,
    summary: raw.summary,
    stepLabels: raw.stepLabels as string[],
    ...(Array.isArray(raw.categoryCounts)
      ? { categoryCounts: raw.categoryCounts as CommittedProposalRecord['categoryCounts'] }
      : {}),
    compensation: raw.compensation as CompensationOp[],
    watchNodes: raw.watchNodes as ProposalWatchNode[],
    reconciliationOk: raw.reconciliationOk !== false,
  }
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
 * 执行整笔撤销:补偿计划倒序应用。对已消失目标全部容忍 no-op(用户先删了某个 AI 节点
 * 不会让撤销失败)。一个 barrier:撤销「撤销」= Cmd+Z。
 */
export function runProposalUndo(record: CommittedProposalRecord): void {
  const ctx = {
    source: 'user' as const, // 撤销是用户意志;proposalId 保留可 join 回原事务
    txnId: `txn_undo_${record.proposalId}`,
    proposalId: record.proposalId,
    suppressUndoBarriers: true,
  }
  pushUndoSnapshot()
  withCanvasGestureContext(ctx, () => {
    for (const op of [...record.compensation].reverse()) {
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
        useGenerationCanvasStore.getState().updateNodePrompt(op.nodeId, op.prompt)
      } else if (op.kind === 'restore-graph') {
        useGenerationCanvasStore
          .getState()
          .restoreGraph(op.nodes as GenerationCanvasNode[], op.edges as GenerationCanvasEdge[])
      }
    }
    emitCanvasGesture([
      {
        type: 'agent.txn.reverted',
        payload: { proposalId: record.proposalId, ops: record.compensation.length },
      },
    ])
  })
  clearCommittedProposal()
}
