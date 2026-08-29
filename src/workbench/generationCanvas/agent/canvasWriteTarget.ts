import {
  CanvasWriteEvidenceError,
  canvasWriteRawEvidenceSchema,
  type CanvasWriteRawEvidence,
} from '../../../../electron/shared/agentCapabilities/canvasWriteEvidence'
import type { GenerationCanvasSnapshot, GenerationNodeResult } from '../model/generationCanvasTypes'
import { resolveCanvasToolNodeId } from './clientIdRegistry'

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function firstString(meta: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = trimmedString(meta[key])
    if (value) return value
  }
  return null
}

function resultPointer(result: GenerationNodeResult | undefined): CanvasWriteRawEvidence['node']['currentResult'] {
  if (!result) return null
  return {
    id: result.id,
    type: result.type,
    ...(trimmedString(result.taskId) ? { taskId: trimmedString(result.taskId)! } : {}),
    ...(trimmedString(result.assetId) ? { assetId: trimmedString(result.assetId)! } : {}),
    ...(trimmedString(result.assetRefId) ? { assetRefId: trimmedString(result.assetRefId)! } : {}),
  }
}

export function captureCanvasWriteRawEvidence(
  snapshot: GenerationCanvasSnapshot,
  requestedNodeId: string,
  resolveNodeId: (nodeId: string) => string = resolveCanvasToolNodeId,
): CanvasWriteRawEvidence {
  const canonicalNodeId = resolveNodeId(requestedNodeId.trim())
  const node = snapshot.nodes.find((candidate) => candidate.id === canonicalNodeId)
  if (!node) throw new CanvasWriteEvidenceError('capability_target_stale')

  const meta = node.meta ?? {}
  const archetype = meta.archetype && typeof meta.archetype === 'object' && !Array.isArray(meta.archetype)
    ? meta.archetype as Record<string, unknown>
    : {}
  const evidence = {
    node: {
      id: node.id,
      kind: node.kind,
      title: node.title,
      prompt: node.prompt ?? '',
      locked: Boolean(node.locked),
      categoryId: trimmedString(node.categoryId),
      groupId: trimmedString(node.groupId),
      model: {
        modelKey: firstString(meta, ['modelKey', 'modelAlias', 'imageModel', 'videoModel']),
        vendorKey: firstString(meta, ['modelVendor', 'vendor', 'imageModelVendor', 'videoModelVendor']),
        archetypeId: trimmedString(archetype.id),
        modeId: trimmedString(archetype.modeId),
        variantId: trimmedString(archetype.variantId),
      },
      currentResult: resultPointer(node.result),
    },
    groups: snapshot.groups
      .filter((group) => group.id === node.groupId || group.nodeIds.includes(node.id))
      .map((group) => ({ id: group.id, categoryId: group.categoryId, nodeIds: [...group.nodeIds] })),
  }
  const parsed = canvasWriteRawEvidenceSchema.safeParse(evidence)
  if (!parsed.success) throw new CanvasWriteEvidenceError('capability_input_invalid')
  return parsed.data
}
