import type {
  ProjectAgentHostState,
  ProjectAgentItem,
  ProjectAgentStatus,
} from '../../../electron/shared/projectAgentContracts'
import type { WorkbenchAiMessage } from './workbenchAiTypes'
import { useWorkbenchStore } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'

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

function itemMessage(item: ProjectAgentItem): WorkbenchAiMessage | null {
  switch (item.kind) {
    case 'user':
      return { id: item.itemId, role: 'user', content: item.text, status: uiStatus(item.status) }
    case 'assistant':
      return { id: item.itemId, role: 'assistant', content: item.text, status: uiStatus(item.status) }
    case 'tool':
      return {
        id: item.itemId,
        role: 'tool',
        content: item.text ?? `[${item.capability.id}]`,
        status: uiStatus(item.status),
      }
    case 'failure':
      return { id: item.itemId, role: 'assistant', content: item.message, status: 'error' }
    case 'artifact':
      return {
        id: item.itemId,
        role: 'assistant',
        content: `artifact:${item.artifact.artifactId}`,
        status: uiStatus(item.status),
      }
    case 'task':
      return { id: item.itemId, role: 'assistant', content: `task:${item.task.runId}`, status: 'done' }
    case 'proposal':
      return {
        id: item.itemId,
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
  return state.items
    .filter((item) => item.threadId === threadId)
    .sort(
      (left, right) =>
        (turnOrder.get(left.turnId) ?? 0) - (turnOrder.get(right.turnId) ?? 0) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.itemId.localeCompare(right.itemId),
    )
    .map(itemMessage)
    .filter((message): message is WorkbenchAiMessage => message !== null)
}

/** Keeps the existing panel render adapters in lockstep with the Host snapshot. */
export function installProjectAgentSnapshotToUi(state: ProjectAgentHostState): void {
  const messages = projectAgentThreadMessages(state)
  useWorkbenchStore.getState().setCreationAiMessages(messages)
  useGenerationCanvasStore.getState().setGenerationAiMessages(messages)
}

export function projectAgentActiveThreadId(state: ProjectAgentHostState): string | null {
  return state.activeThreadId
}

export function projectAgentLegacyThreadIsReadOnly(state: ProjectAgentHostState, threadId: string): boolean {
  return state.threads.some((thread) => thread.threadId === threadId && thread.provenance?.kind === 'legacy')
}
