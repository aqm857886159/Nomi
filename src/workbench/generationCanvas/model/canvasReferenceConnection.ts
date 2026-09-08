import { canFitReferenceEdge } from '../runner/referenceSlots'
import type { GenerationCanvasEdge, GenerationCanvasEdgeMode, GenerationCanvasNode } from './generationCanvasTypes'
import { acceptsParameterReferenceSource, nextParameterReferenceKey, readParameterReferenceSlots } from './parameterReferenceSlots'
import { isTextPromptEdge, selectConnectionEdgeMode, validateReferenceEdge, type EdgeSkipReason } from '../agent/referenceEdgeCapability'

/** Manual, group and explicit-slot connections share declaration-based capacity and media validation. */
export function resolveCanvasReferenceConnection(
  source: GenerationCanvasNode,
  target: GenerationCanvasNode,
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
  requestedMode?: GenerationCanvasEdgeMode,
  requestedKey?: string,
): { ok: true; mode: GenerationCanvasEdgeMode; targetParamKey?: string } | { ok: false; reason: EdgeSkipReason } {
  const slots = readParameterReferenceSlots(target.meta)
  if (slots.length) {
    if (!requestedKey && isTextPromptEdge(source, target, requestedMode)) return { ok: true, mode: 'reference' }
    const key = requestedKey ?? nextParameterReferenceKey(target, nodes, edges, source.id, requestedMode)
    const slot = slots.find((candidate) => candidate.key === key)
    if (!slot || !acceptsParameterReferenceSource(slot, source, requestedMode)) return { ok: false, reason: 'unsupported_reference' }
    return { ok: true, mode: requestedMode ?? slot.group, targetParamKey: slot.key }
  }
  if (requestedKey) return { ok: false, reason: 'unsupported_reference' }
  const mode = requestedMode ?? selectConnectionEdgeMode(source, target, edges.filter((edge) => edge.target === target.id))
  const verdict = validateReferenceEdge(source, target, mode)
  if (!verdict.ok) return verdict
  const existing = edges.some((edge) => edge.source === source.id && edge.target === target.id && edge.mode === mode)
  if (!existing && !isTextPromptEdge(source, target, mode) && !canFitReferenceEdge(source, target, nodes, edges, mode)) return { ok: false, reason: 'unsupported_reference' }
  return { ok: true, mode }
}
