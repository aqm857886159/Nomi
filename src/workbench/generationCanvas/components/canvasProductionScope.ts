import type { ProfileKind } from '../../api/modelCatalogApi'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import {
  getGenerationNodeExecutionKind,
  type GenerationNodeExecutionKind,
  type GenerationNodeKind,
} from '../model/generationNodeKinds'
import { requiredModeForGenerationNode } from '../adapters/modelOptionsAdapter'

export const CANVAS_BATCH_CONCURRENCY_STORAGE_KEY = 'nomi.canvas.batch-concurrency'
export const DEFAULT_CANVAS_BATCH_CONCURRENCY = 6

export function canvasBatchDockScopeKey(eligibleIds: readonly string[]): string {
  return eligibleIds.join('\u0000')
}

type CanvasBatchConcurrencyStorage = Pick<Storage, 'getItem' | 'setItem'>

export type CanvasGenerationScope = {
  categoryId?: string
  nodeIds?: readonly string[]
}

export function resolveCanvasGenerationScope(
  activeCategoryId: string,
  selectedNodeIds: readonly string[],
): CanvasGenerationScope {
  return selectedNodeIds.length > 0 ? { nodeIds: selectedNodeIds } : { categoryId: activeCategoryId }
}

export function normalizeCanvasBatchConcurrency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CANVAS_BATCH_CONCURRENCY
  return Math.max(1, Math.min(8, Math.floor(value)))
}

function defaultStorage(): CanvasBatchConcurrencyStorage | undefined {
  return typeof window !== 'undefined' ? window.localStorage : undefined
}

export function readCanvasBatchConcurrency(storage = defaultStorage()): number {
  if (!storage) return DEFAULT_CANVAS_BATCH_CONCURRENCY
  try {
    const raw = storage.getItem(CANVAS_BATCH_CONCURRENCY_STORAGE_KEY)
    return normalizeCanvasBatchConcurrency(raw === null ? undefined : Number(raw))
  } catch {
    return DEFAULT_CANVAS_BATCH_CONCURRENCY
  }
}

export function writeCanvasBatchConcurrency(value: unknown, storage = defaultStorage()): number {
  const normalized = normalizeCanvasBatchConcurrency(value)
  try {
    storage?.setItem(CANVAS_BATCH_CONCURRENCY_STORAGE_KEY, String(normalized))
  } catch {
    // Hardened Electron sessions may block localStorage; the in-memory value still applies.
  }
  return normalized
}

export function nodesInCanvasProductionScope(
  nodes: readonly GenerationCanvasNode[],
  scope: CanvasGenerationScope = {},
): GenerationCanvasNode[] {
  const scopedIds = scope.nodeIds ? new Set(scope.nodeIds) : null
  return nodes.filter((node) => {
    if (scope.categoryId && (node.categoryId || 'shots') !== scope.categoryId) return false
    if (scopedIds && !scopedIds.has(node.id)) return false
    return true
  })
}

export function eligibleGenerationNodeIds(
  nodes: readonly GenerationCanvasNode[],
  scope: CanvasGenerationScope = {},
): string[] {
  return nodesInCanvasProductionScope(nodes, scope)
    .filter((node) => {
      if (!getGenerationNodeExecutionKind(node.kind)) return false
      const status = node.status ?? 'idle'
      return status === 'idle' || status === 'error'
    })
    .map((node) => node.id)
}

export function shouldShowCanvasBatchGenerateDock(input: {
  readOnly: boolean
  selectedCount: number
  eligibleCount: number
  eligibleScopeKey?: string
  dismissedScopeKey?: string | null
}): boolean {
  if (input.readOnly || input.selectedCount !== 0 || input.eligibleCount <= 0) return false
  return input.dismissedScopeKey === undefined || input.dismissedScopeKey !== input.eligibleScopeKey
}

export type CanvasGenerationExecutionGroup = {
  executionKind: GenerationNodeExecutionKind
  requiredMode: ProfileKind
  nodeIds: string[]
  representativeKind: GenerationNodeKind
}

export function groupGenerationNodesByExecutionKind(
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[] = [],
  contextNodes: readonly GenerationCanvasNode[] = nodes,
): CanvasGenerationExecutionGroup[] {
  const groups = new Map<string, CanvasGenerationExecutionGroup>()
  for (const node of nodes) {
    const executionKind = getGenerationNodeExecutionKind(node.kind)
    if (!executionKind) continue
    const requiredMode = requiredModeForGenerationNode(node, {
      nodes: contextNodes as GenerationCanvasNode[],
      edges: edges as GenerationCanvasEdge[],
    })
    const groupKey = `${executionKind}:${requiredMode}`
    const existing = groups.get(groupKey)
    if (existing) {
      existing.nodeIds.push(node.id)
      continue
    }
    groups.set(groupKey, { executionKind, requiredMode, nodeIds: [node.id], representativeKind: node.kind })
  }
  return [...groups.values()]
}
