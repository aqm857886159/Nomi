// 设计实验室 · Agent 面板 v4 · **宿主数据 → 真面板**的取景台。
//
// 这一屏其余格子都是「给积木喂 view model，看它长什么样」——那是组件契约，很有用，
// 但它证明不了**接线**：props 是手写的，中间那一层（宿主快照怎么变成这些 props）
// 完全没被跑到。旧的 `agent-panel` 屏有这个证据（它把假快照 install 进真 store 再渲真面板），
// 删掉它就等于把这条证据一起删了。所以这套 `ShellStage` 是把那个手法搬过来。
//
// 三个细节是从旧屏那里继承的，每一个都踩过：
//   1. **`useMemo` 而不是 `useEffect`**：面板首帧就要读到快照。晚一帧灌，会先渲一次空态，
//      截图正好捕到那一帧，于是"面板是空的"成了一条假证据。
//   2. 时间戳全部是**冻结字面量**。`new Date()` 会让每张基线每次都不一样。
//   3. 卸载时 `clear()`：每格一个 iframe，不清会串。
import React from 'react'
import type {
  ProjectAgentHostState,
  ProjectAgentItem,
  ProjectAgentQueueItem,
  ProjectAgentStatus,
  ProjectAgentTurn,
  ProjectBinding,
} from '../../../../electron/shared/projectAgentContracts'
import { projectAgentProjectionStore } from '../../../workbench/ai/projectAgentProjectionStore'
import { agentPanelV4PendingTools } from '../../../workbench/ai/v4/agentPanelV4PendingTools'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import ProjectAgentResidentShell from '../../../workbench/ai/ProjectAgentResidentShell'
import type { ResidentSurface } from '../../../workbench/ai/resident/residentShellDisplay'
import { V4_PANEL_WIDTH } from './agentPanelV4LabKit'

const CLOCK = '2026-09-06T09:00:00.000Z'
const THREAD = 'thread-lab'
const TURN = 'turn-lab'

export const LAB_BINDING: ProjectBinding = Object.freeze({
  projectId: 'lab-project',
  immutableProjectUuid: '00000000-0000-4000-8000-000000000000',
  projectGeneration: 1,
})

const contextRef = Object.freeze({
  binding: Object.freeze({ project: LAB_BINDING, threadId: THREAD, sessionKey: `nomi:project-agent:${LAB_BINDING.immutableProjectUuid}:g1` as const }),
  contextRevision: 1,
  recordId: 'record-lab',
})

function record(status: ProjectAgentStatus = 'done') {
  return { status, retryable: false, deviated: false, createdAt: CLOCK, updatedAt: CLOCK }
}

export function labUserItem(itemId: string, text: string, turnId = TURN): ProjectAgentItem {
  return Object.freeze({ ...record(), itemId, threadId: THREAD, turnId, kind: 'user' as const, text })
}

export function labAssistantItem(itemId: string, text: string, status: ProjectAgentStatus = 'done'): ProjectAgentItem {
  return Object.freeze({ ...record(status), itemId, threadId: THREAD, turnId: TURN, kind: 'assistant' as const, text, textRevision: 1 })
}

export function labToolItem(itemId: string, capabilityId: string, status: ProjectAgentStatus = 'done'): ProjectAgentItem {
  return Object.freeze({
    ...record(status),
    itemId,
    threadId: THREAD,
    turnId: TURN,
    kind: 'tool' as const,
    toolCallId: itemId,
    invocationId: `inv-${itemId}`,
    capability: { id: capabilityId, version: 1 },
    resultRef: `result-${itemId}`,
  })
}

export function labFailureItem(itemId: string, message: string, nextAction?: string): ProjectAgentItem {
  return Object.freeze({
    ...record('failed'),
    itemId,
    threadId: THREAD,
    turnId: TURN,
    kind: 'failure' as const,
    code: 'vendor_error',
    message,
    ...(nextAction ? { nextAction } : {}),
  })
}

export function labQueueItem(queueItemId: string, turnId: string, status: ProjectAgentStatus): ProjectAgentQueueItem {
  return Object.freeze({
    queueItemId,
    threadId: THREAD,
    turnId,
    binding: LAB_BINDING,
    target: { kind: 'canvas' as const, nodeIds: Object.freeze([]) },
    preconditions: {},
    contextRef,
    model: { id: 'lab:model', version: 1 },
    skillVersions: Object.freeze([]),
    capabilityVersions: Object.freeze([]),
    policyRevision: 1,
    attachmentRefs: Object.freeze([]),
    originSurface: { surfaceId: 'project-agent-resident', kind: 'canvas' as const },
    enqueuedAt: CLOCK,
    status,
    retryable: false,
    deviated: false,
    updatedAt: CLOCK,
  })
}

function labTurn(status: ProjectAgentStatus, usage?: ProjectAgentTurn['usage']): ProjectAgentTurn {
  return Object.freeze({
    ...record(status),
    turnId: TURN,
    threadId: THREAD,
    executionToken: 'token-lab',
    model: { id: 'lab:model', version: 1 },
    skillVersions: Object.freeze([]),
    capabilityVersions: Object.freeze([]),
    contextRef,
    ...(usage ? { usage } : {}),
  })
}

export function labHostState(input: {
  items: readonly ProjectAgentItem[]
  queue?: readonly ProjectAgentQueueItem[]
  turnStatus?: ProjectAgentStatus
  usage?: ProjectAgentTurn['usage']
  extraTurns?: readonly ProjectAgentTurn[]
}): ProjectAgentHostState {
  return Object.freeze({
    binding: LAB_BINDING,
    hostRevision: 1,
    commandLedgerHighWater: 1,
    activeThreadId: THREAD,
    threads: Object.freeze([{ threadId: THREAD, createdAt: CLOCK, updatedAt: CLOCK }]),
    turns: Object.freeze([labTurn(input.turnStatus ?? 'done', input.usage), ...(input.extraTurns ?? [])]),
    items: Object.freeze([...input.items]),
    queue: Object.freeze([...(input.queue ?? [])]),
    proposalApprovals: Object.freeze([]),
    recentAppliedCommands: Object.freeze([]),
  })
}

/**
 * 装一份宿主快照，渲**真的**常驻面板。
 * `height` 默认 620：composer 的高度上限按面板高 derive，取景框改高了那一格的意思就变了。
 */
export function ShellStage({
  snapshot,
  surface = 'generation',
  draft = '',
  width = V4_PANEL_WIDTH,
  height = 620,
}: {
  snapshot: ProjectAgentHostState
  surface?: ResidentSurface
  draft?: string
  width?: number
  height?: number
}): JSX.Element {
  React.useMemo(() => {
    projectAgentProjectionStore.install('design-lab', 1, snapshot)
    agentPanelV4PendingTools.reset()
    useWorkbenchStore.setState({
      assistantWidth: width,
      projectAgentDockCollapsed: false,
      projectAgentDraft: draft,
      projectAgentAttachments: [],
      creationActiveSkill: null,
    })
    return null
  }, [draft, snapshot, width])
  React.useEffect(() => () => {
    projectAgentProjectionStore.clear()
    agentPanelV4PendingTools.reset()
  }, [])
  return (
    <div
      className="overflow-hidden rounded-nomi border border-nomi-line bg-nomi-bg"
      style={{ width, height }}
      data-design-lab-stage="shell"
    >
      <ProjectAgentResidentShell surface={surface} />
    </div>
  )
}
