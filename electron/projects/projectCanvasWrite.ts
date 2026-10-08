import { readProject, saveProject, type ProjectRecord } from './repository'
import { sameProjectAgentBinding, type ProjectBinding } from '../shared/projectBinding'

type CanvasRecord = {
  nodes?: Array<Record<string, unknown>>
  [key: string]: unknown
}

const queues = new Map<string, Promise<unknown>>()

export function serializeProjectCanvasWrite<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(projectId) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(operation)
  const tail = result.then(() => undefined, () => undefined)
  queues.set(projectId, tail)
  void tail.finally(() => {
    if (queues.get(projectId) === tail) queues.delete(projectId)
  })
  return result
}

function projectBindingOf(record: ProjectRecord): ProjectBinding {
  const raw = record as ProjectRecord & { immutableProjectUuid?: string; projectGeneration?: number }
  return {
    projectId: record.id,
    immutableProjectUuid: raw.immutableProjectUuid ?? '',
    projectGeneration: raw.projectGeneration ?? 0,
  }
}

export async function applyCanvasNodePatch(input: {
  projectId: string
  nodeId: string
  patch: Record<string, unknown>
  expectedBinding?: ProjectBinding
}): Promise<{ applied: boolean }> {
  return serializeProjectCanvasWrite(input.projectId, async () => {
    const record = readProject(input.projectId)
    if (!record) return { applied: false }
    if (input.expectedBinding && !sameProjectAgentBinding(input.expectedBinding, projectBindingOf(record))) {
      throw new Error('project_binding_stale')
    }
    const payload = record.payload && typeof record.payload === 'object'
      ? { ...(record.payload as Record<string, unknown>) }
      : {}
    const rawCanvas = payload.generationCanvas && typeof payload.generationCanvas === 'object'
      ? payload.generationCanvas as CanvasRecord
      : null
    const nodes = Array.isArray(rawCanvas?.nodes) ? rawCanvas.nodes : []
    const index = nodes.findIndex((node) => node && node.id === input.nodeId)
    if (index < 0 || !rawCanvas) return { applied: false }
    const nextNodes = nodes.map((node, candidateIndex) => candidateIndex === index ? { ...node, ...input.patch } : node)
    payload.generationCanvas = { ...rawCanvas, nodes: nextNodes }
    await saveProject(input.projectId, { ...record, payload })
    return { applied: true }
  })
}
