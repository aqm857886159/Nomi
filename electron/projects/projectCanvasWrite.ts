import pLimit from "p-limit"
import { readProject, saveProject, type ProjectRecord } from './repository'
import { sameProjectAgentBinding, type ProjectBinding } from '../shared/projectBinding'

type CanvasRecord = {
  nodes?: Array<Record<string, unknown>>
  [key: string]: unknown
}

const limits = new Map<string, ReturnType<typeof pLimit>>()

export async function serializeProjectCanvasWrite<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
  const limit = limits.get(projectId) ?? pLimit(1)
  limits.set(projectId, limit)
  try {
    return await limit(operation)
  } finally {
    if (limits.get(projectId) === limit && limit.activeCount === 0 && limit.pendingCount === 0) limits.delete(projectId)
  }
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
