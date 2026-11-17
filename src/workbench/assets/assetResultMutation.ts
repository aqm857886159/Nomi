import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import type { NodeResultLifecyclePatch } from '../generationCanvas/model/nodeResultLifecycle'

const deletionQueues = new Map<string, Promise<void>>()

export function serializeProjectDeletion<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
  const previous = deletionQueues.get(projectId) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(operation)
  const tail = result.then(() => undefined, () => undefined)
  deletionQueues.set(projectId, tail)
  void tail.finally(() => {
    if (deletionQueues.get(projectId) === tail) deletionQueues.delete(projectId)
  })
  return result
}

function lifecycleFingerprint(value: Pick<GenerationCanvasNode, 'result' | 'history' | 'status' | 'error'>): string {
  return JSON.stringify({
    result: value.result,
    history: value.history ?? [],
    status: value.status,
    error: value.error,
  })
}

export function rollbackAppliedPatches(
  rollbacks: Array<{ nodeId: string; before: NodeResultLifecyclePatch; applied: NodeResultLifecyclePatch }>,
): void {
  const store = useGenerationCanvasStore.getState()
  for (const rollback of rollbacks) {
    const current = store.nodes.find((node) => node.id === rollback.nodeId)
    if (!current || lifecycleFingerprint(current) !== lifecycleFingerprint(rollback.applied)) continue
    store.updateNode(rollback.nodeId, rollback.before)
  }
}
