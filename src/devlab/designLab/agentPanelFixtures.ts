// 设计实验室 · Agent 面板夹具（fixtures）
//
// 这里造的是**Host 快照**，不是假 UI。实验室把它灌进 `projectAgentProjectionStore`，
// 现役 `ProjectAgentResidentShell` 照常从 store 读、照常渲染——所以实验室里看到的
// 就是真机里会看到的那个面板，只是数据来自盘上而不是 Host 进程。
//
// 纪律：
//   1. 不发网络、不碰 Host IPC。灌 store 用的是 store 自己的公开方法（install/applySnapshot）。
//   2. 类型全部来自 `electron/shared/projectAgentContracts`——契约变了这里当场编译红，
//      不会出现「实验室还在按老形状画」的静默漂移。
//   3. 时间戳全部固定字面量。视觉基线要逐像素稳定，`new Date()` 会让每次截图都不一样。
import type {
  ProjectAgentContextRef,
  ProjectAgentHostState,
  ProjectAgentItem,
  ProjectAgentQueueItem,
  ProjectAgentStatus,
  ProjectAgentThread,
  ProjectAgentTurn,
  ProjectBinding,
} from '../../../electron/shared/projectAgentContracts'
import type { ProjectAgentCommittedProposalRecord } from '../../../electron/shared/projectAgentProposalReceipt'

/** 固定时钟。视觉基线逐像素比对，任何「现在几点」都会让基线永远红。 */
export const LAB_CLOCK = '2026-09-06T09:00:00.000Z'
const LATER = '2026-09-06T09:00:12.000Z'

export const LAB_BINDING: ProjectBinding = Object.freeze({
  projectId: 'design-lab-project',
  immutableProjectUuid: '11111111-2222-4333-8444-555555555555',
  projectGeneration: 1,
})

const THREAD_ID = 'lab-thread'
const TURN_ID = 'lab-turn'
const LAB_RECEIPT_ID = 'lab-proposal'

const LAB_MODEL_REF = Object.freeze({ id: 'kimi-k2', version: '1' })
const LAB_TARGET = Object.freeze({ kind: 'canvas', nodeIds: ['lab-node-1'] } as const)
const LAB_CONTEXT_REF: ProjectAgentContextRef = Object.freeze({
  binding: {
    project: LAB_BINDING,
    threadId: THREAD_ID,
    sessionKey: `nomi:project-agent:${LAB_BINDING.immutableProjectUuid}:g${LAB_BINDING.projectGeneration}` as const,
  },
  contextRevision: 1,
  recordId: 'lab-context',
})

const thread: ProjectAgentThread = {
  threadId: THREAD_ID,
  title: '雨夜追逐',
  createdAt: LAB_CLOCK,
  updatedAt: LATER,
}

function turn(status: ProjectAgentStatus): ProjectAgentTurn {
  return {
    turnId: TURN_ID,
    threadId: THREAD_ID,
    executionToken: 'lab-token',
    status,
    retryable: false,
    deviated: false,
    createdAt: LAB_CLOCK,
    updatedAt: LATER,
    model: LAB_MODEL_REF,
    skillVersions: [{ id: '编剧·Kasdan', version: '1' }],
    capabilityVersions: [],
    contextRef: LAB_CONTEXT_REF,
  }
}

type ItemBase = Readonly<{ itemId: string; status?: ProjectAgentStatus }>

function base(itemId: string, status: ProjectAgentStatus = 'done') {
  return {
    itemId,
    threadId: THREAD_ID,
    turnId: TURN_ID,
    status,
    retryable: false,
    deviated: false,
    createdAt: LAB_CLOCK,
    updatedAt: LATER,
  } as const
}

export function userItem(text: string, options: ItemBase = { itemId: 'lab-user' }): ProjectAgentItem {
  return { ...base(options.itemId, options.status ?? 'done'), kind: 'user', text }
}

export function assistantItem(text: string, options: ItemBase = { itemId: 'lab-assistant' }): ProjectAgentItem {
  return { ...base(options.itemId, options.status ?? 'done'), kind: 'assistant', text, textRevision: 1 }
}

export function failureItem(
  code: string,
  message: string,
  options: ItemBase = { itemId: 'lab-failure' },
): ProjectAgentItem {
  return { ...base(options.itemId, options.status ?? 'failed'), kind: 'failure', code, message }
}

export function toolItem(
  name: string,
  status: ProjectAgentStatus,
  options: Readonly<{ itemId: string; toolCallId?: string; skill?: string }>,
): ProjectAgentItem {
  return {
    ...base(options.itemId, status),
    kind: 'tool',
    toolCallId: options.toolCallId ?? `${options.itemId}-call`,
    invocationId: `${options.itemId}-invocation`,
    capability: { id: name, version: '1' },
    ...(options.skill
      ? { skillLoad: { name: options.skill, packageVersion: '1.0.0', contentHash: 'labhash' } }
      : {}),
  }
}

export function proposalItem(
  status: Extract<ProjectAgentStatus, 'proposed' | 'done'>,
  options: Readonly<{ itemId: string; receiptProposalId?: string }>,
): ProjectAgentItem {
  return {
    ...base(options.itemId, status),
    kind: 'proposal',
    approval: {
      approvalId: `${options.itemId}-approval`,
      receiptProposalId: options.receiptProposalId ?? LAB_RECEIPT_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
      toolCallId: `${options.itemId}-call`,
      policyRevision: 1,
      inputHash: 'labinput',
      actionHash: 'labaction',
      target: LAB_TARGET,
      preconditions: {},
      expiresAt: '2026-09-06T09:30:00.000Z',
    },
  }
}

export function queueItem(
  queueItemId: string,
  status: Extract<ProjectAgentStatus, 'queued' | 'running'>,
): ProjectAgentQueueItem {
  return {
    queueItemId,
    threadId: THREAD_ID,
    turnId: `${TURN_ID}-${queueItemId}`,
    binding: LAB_BINDING,
    target: LAB_TARGET,
    preconditions: {},
    contextRef: LAB_CONTEXT_REF,
    model: LAB_MODEL_REF,
    skillVersions: [],
    capabilityVersions: [],
    policyRevision: 1,
    attachmentRefs: [],
    originSurface: { surfaceId: 'generation', kind: 'canvas' },
    enqueuedAt: LAB_CLOCK,
    status,
    retryable: false,
    deviated: false,
    updatedAt: LATER,
  }
}

/** 一条 turn + 若干 item + 若干队列项 = 一个完整的 Host 快照。 */
export function hostState(
  options: Readonly<{
    items?: readonly ProjectAgentItem[]
    queue?: readonly ProjectAgentQueueItem[]
    turnStatus?: ProjectAgentStatus
    extraTurns?: readonly ProjectAgentTurn[]
  }> = {},
): ProjectAgentHostState {
  const mainTurn = turn(options.turnStatus ?? 'done')
  return {
    binding: LAB_BINDING,
    hostRevision: 1,
    commandLedgerHighWater: 1,
    activeThreadId: THREAD_ID,
    threads: [thread],
    turns: [mainTurn, ...(options.extraTurns ?? [])],
    items: options.items ?? [],
    queue: options.queue ?? [],
    proposalApprovals: [],
    recentAppliedCommands: [],
  }
}

/** 写入回执（形态 10）的固定卡记录。 */
export const LAB_RECEIPT: ProjectAgentCommittedProposalRecord = {
  proposalId: 'lab-proposal',
  summary: '拆解结果 · 5 镜',
  stepLabels: ['镜 1 雨夜街口', '镜 2 追逐起步', '镜 3 巷口急转', '镜 4 雨幕特写', '镜 5 车灯扫过'],
  categoryCounts: [{ categoryId: 'shot', label: '画面', count: 5 }],
  compensation: [],
  watchNodes: [
    { nodeId: 'lab-node-1', title: '镜 1 雨夜街口', prompt: '雨夜街口，霓虹反射在积水上' },
    { nodeId: 'lab-node-2', title: '镜 2 追逐起步', prompt: '主角冲出便利店，雨衣被风掀起' },
  ],
  reconciliationOk: true,
}
