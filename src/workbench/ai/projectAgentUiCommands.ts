import type {
  ProjectAgentHostState,
  ProjectAgentMutationType,
  ProjectAgentThread,
  ProjectBinding,
} from '../../../electron/shared/projectAgentContracts'
import { projectAgentClient } from './projectAgentClient'
import { projectAgentProjectionStore } from './projectAgentProjectionStore'

function currentSnapshot(): ProjectAgentHostState {
  const snapshot = projectAgentProjectionStore.getState().snapshot
  if (!snapshot) throw new Error('project_agent_unavailable')
  return snapshot
}

function currentSubscription(): string {
  const subscriptionId = projectAgentProjectionStore.getState().subscriptionId
  if (!subscriptionId) throw new Error('project_agent_unavailable')
  return subscriptionId
}

function commandId(prefix: string): string {
  return `ui-${prefix}-${globalThis.crypto.randomUUID()}`
}

async function dispatch(type: ProjectAgentMutationType, payload: unknown): Promise<ProjectAgentHostState> {
  const snapshot = currentSnapshot()
  const result = await projectAgentClient.command({
    subscriptionId: currentSubscription(),
    clientCommandId: commandId(type),
    knownRevision: snapshot.hostRevision,
    type,
    payload,
  })
  projectAgentProjectionStore.applySnapshot(result.state)
  return result.state
}

function newThread(now: string): ProjectAgentThread {
  return Object.freeze({
    threadId: `thread-${globalThis.crypto.randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  })
}

/** Project-level history commands. These are the only desktop history mutations after cutover. */
export async function createProjectAgentThread(): Promise<ProjectAgentHostState> {
  const snapshot = currentSnapshot()
  const active = snapshot.threads.find((thread) => thread.threadId === snapshot.activeThreadId)
  if (active && !snapshot.items.some((item) => item.threadId === active.threadId)) {
    return snapshot
  }
  const now = new Date().toISOString()
  return dispatch('thread.put', { thread: newThread(now), makeActive: true })
}

export async function activateProjectAgentThread(threadId: string): Promise<ProjectAgentHostState> {
  return dispatch('thread.activate', { threadId, occurredAt: new Date().toISOString() })
}

export async function removeProjectAgentThread(threadId: string): Promise<ProjectAgentHostState> {
  return dispatch('thread.remove', { threadId, occurredAt: new Date().toISOString() })
}

/** Edit a queued user turn through the Host; queue text is never owned by the shell. */
export async function editProjectAgentQueueItem(input: Readonly<{
  queueItemId: string
  userItemId: string
  text: string
}>): Promise<ProjectAgentHostState> {
  return dispatch('queue.edit', { ...input, occurredAt: new Date().toISOString() })
}

/** Queue controls remain Host mutations; the resident shell only projects them. */
export async function deleteProjectAgentQueueItem(queueItemId: string): Promise<ProjectAgentHostState> {
  return dispatch('queue.delete', { queueItemId, occurredAt: new Date().toISOString() })
}

export async function moveProjectAgentQueueItem(
  queueItemId: string,
  direction: 'up' | 'down',
): Promise<ProjectAgentHostState> {
  return dispatch(direction === 'up' ? 'queue.move_up' : 'queue.move_down', {
    queueItemId,
    occurredAt: new Date().toISOString(),
  })
}

export async function pauseProjectAgentQueueItem(queueItemId: string): Promise<ProjectAgentHostState> {
  return dispatch('queue.pause', { queueItemId, occurredAt: new Date().toISOString() })
}

export async function resumeProjectAgentQueueItem(queueItemId: string): Promise<ProjectAgentHostState> {
  return dispatch('queue.resume', { queueItemId, occurredAt: new Date().toISOString() })
}

export function projectAgentIsReady(): boolean {
  return Boolean(
    projectAgentProjectionStore.getState().snapshot && projectAgentProjectionStore.getState().subscriptionId,
  )
}

export function projectAgentThreads(): readonly ProjectAgentThread[] {
  return currentSnapshot().threads
}

export function projectAgentActiveThreadId(): string | null {
  return currentSnapshot().activeThreadId
}

export function projectAgentBinding(): ProjectBinding {
  return currentSnapshot().binding
}
