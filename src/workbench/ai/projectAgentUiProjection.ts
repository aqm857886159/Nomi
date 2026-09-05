import type {
  ProjectAgentHostState,
  ProjectAgentItem,
  ProjectAgentQueueItem,
  ProjectAgentStatus,
  ProjectAgentTurn,
} from '../../../electron/shared/projectAgentContracts'
import type { WorkbenchAiMessage } from './workbenchAiTypes'
import { composerAttachmentsFromProjectAgentRefs } from './projectAgentAttachments'

function uiStatus(status: ProjectAgentStatus): WorkbenchAiMessage['status'] {
  switch (status) {
    case 'queued':
    case 'drafting':
    case 'proposed':
      return 'pending'
    case 'running':
      return 'streaming'
    case 'failed':
      return 'error'
    case 'stopped':
    case 'declined':
      return 'cancelled'
    case 'done':
      return 'done'
  }
}

function itemMessage(
  item: ProjectAgentItem,
  turn: ProjectAgentTurn | undefined,
  queueItem: ProjectAgentQueueItem | undefined,
): WorkbenchAiMessage | null {
  const base = { id: item.itemId, turnId: item.turnId }
  switch (item.kind) {
    case 'user':
      return {
        ...base,
        role: 'user',
        content: item.text,
        status: uiStatus(item.status),
        ...(queueItem?.attachmentRefs.length
          ? { attachments: composerAttachmentsFromProjectAgentRefs(queueItem.attachmentRefs) }
          : {}),
      }
    case 'assistant':
      return {
        ...base,
        role: 'assistant',
        content: item.text,
        status: uiStatus(item.status),
        ...(turn?.skillVersions.some((skill) => skill.id === 'workbench.storyboard.planner')
          ? { storyboardArtifact: true as const }
          : {}),
      }
    case 'tool':
      return {
        ...base,
        role: 'tool',
        content: item.text ?? `[${item.capability.id}]`,
        status: uiStatus(item.status),
      }
    case 'failure':
      return { ...base, role: 'assistant', content: item.message, status: 'error' }
    case 'artifact':
      return {
        ...base,
        role: 'assistant',
        content: `artifact:${item.artifact.artifactId}`,
        status: uiStatus(item.status),
      }
    case 'task':
      return {
        ...base,
        role: 'assistant',
        content: `task:${item.task.kind === 'production-run' ? item.task.runId : item.task.jobId}`,
        status: 'done',
      }
    case 'proposal':
      return {
        ...base,
        role: 'assistant',
        content: item.approval ? `approval:${item.approval.approvalId}` : `approval:${item.humanApproval.challengeId}`,
        status: uiStatus(item.status),
      }
  }
}

/** Converts one canonical Host thread into the legacy panel's display DTO. */
export function projectAgentThreadMessages(
  state: ProjectAgentHostState,
  threadId = state.activeThreadId,
): WorkbenchAiMessage[] {
  if (!threadId || !state.threads.some((thread) => thread.threadId === threadId)) return []
  const turnOrder = new Map(state.turns.map((turn, index) => [turn.turnId, index]))
  const itemOrder = new Map(state.items.map((item, index) => [item.itemId, index]))
  const turns = new Map(state.turns.map((turn) => [turn.turnId, turn]))
  const queueItems = new Map(state.queue.map((item) => [item.turnId, item]))
  const failureTurnIds = new Set(state.items.filter((item) => item.kind === 'failure').map((item) => item.turnId))
  return state.items
    .filter((item) => item.threadId === threadId)
    .filter((item) => item.kind !== 'assistant' || item.status !== 'failed' || !failureTurnIds.has(item.turnId))
    .sort(
      (left, right) =>
        (turnOrder.get(left.turnId) ?? 0) - (turnOrder.get(right.turnId) ?? 0) ||
        left.createdAt.localeCompare(right.createdAt) ||
        (itemOrder.get(left.itemId) ?? 0) - (itemOrder.get(right.itemId) ?? 0),
    )
    .map((item) => itemMessage(item, turns.get(item.turnId), queueItems.get(item.turnId)))
    .filter((message): message is WorkbenchAiMessage => message !== null)
}

export function projectAgentActiveThreadId(state: ProjectAgentHostState): string | null {
  return state.activeThreadId
}
