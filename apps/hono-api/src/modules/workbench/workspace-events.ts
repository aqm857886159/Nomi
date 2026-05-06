type WorkspaceEventType = 'canvas.updated' | 'timeline.updated' | 'creation.updated'

export type WorkspaceEvent = {
  type: WorkspaceEventType
  projectId: string
  ts: string
}

type Subscriber = (event: WorkspaceEvent) => void

const subscribers = new Map<string, Set<Subscriber>>()

export function subscribeWorkspaceEvents(projectId: string, cb: Subscriber): () => void {
  if (!subscribers.has(projectId)) subscribers.set(projectId, new Set())
  subscribers.get(projectId)!.add(cb)
  return () => subscribers.get(projectId)?.delete(cb)
}

export function publishWorkspaceEvent(event: WorkspaceEvent): void {
  subscribers.get(event.projectId)?.forEach(cb => cb(event))
}
