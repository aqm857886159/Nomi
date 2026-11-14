import type { GenerationCanvasNode } from './generationCanvasTypes'
import { EVERY_VARIANT, resolveModelArchetype } from '../../../../electron/shared/modelArchetypes'

/** Variants are independent branches; only original shot nodes own plan overrides. */
export function isStoryboardOriginal(node: GenerationCanvasNode): boolean {
  const identified = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
  return ((identified(node.meta?.shotId) && identified(node.meta?.storyboardDesignId))
    || (identified(node.meta?.productionRunId) && identified(node.meta?.productionShotId) && node.meta?.productionShotRole !== 'anchor'))
    && !node.meta?.storyboardKeyframe && !node.regeneratedFrom && !node.derivedFrom
}

export function overriddenShotFields(node: GenerationCanvasNode | null | undefined): string[] {
  if (!node || !isStoryboardOriginal(node)) return []
  const fields = node.meta?.overriddenFields
  return Array.isArray(fields) ? fields.filter((field): field is string => typeof field === 'string' && field !== 'durationSec' && field !== 'params.duration') : []
}

export function nodeShotField(node: GenerationCanvasNode, field: string): unknown {
  if (field === 'prompt') return node.prompt ?? ''
  if (field === 'modeId') return (node.meta?.archetype as { modeId?: string } | undefined)?.modeId
  return node.meta?.[field.startsWith('params.') ? field.slice(7) : field]
}

/** All user/Agent canvas content writes converge here. System projections pass their origin explicitly. */
export function markStoryboardOverrides(node: GenerationCanvasNode, patch: Partial<GenerationCanvasNode>): Partial<GenerationCanvasNode> {
  if (!isStoryboardOriginal(node)) return patch
  const fields = new Set(overriddenShotFields(node))
  const next = { ...node, ...patch }
  if ('prompt' in patch && patch.prompt !== node.prompt) fields.add('prompt')
  if (patch.meta) {
    for (const field of ['modelKey', 'modelVendor', 'modeId']) {
      if (nodeShotField(next, field) !== nodeShotField(node, field)) fields.add(field)
    }
    const archetype = resolveModelArchetype({ modelKey: String(next.meta?.modelKey ?? ''), vendorKey: String(next.meta?.modelVendor ?? ''), meta: next.meta }, { variant: EVERY_VARIANT })
    const paramKeys = new Set(archetype?.modes.flatMap(mode => mode.params.map(param => param.key)) ?? [])
    for (const key of paramKeys) {
      if (key !== 'duration' && key !== 'durationSec' && key in patch.meta && patch.meta[key] !== node.meta?.[key]) fields.add(`params.${key}`)
    }
  }
  if (!fields.size) return patch
  return { ...patch, meta: { ...(patch.meta ?? node.meta), overriddenFields: [...fields] } }
}
