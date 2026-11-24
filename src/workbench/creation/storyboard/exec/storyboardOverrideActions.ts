import type { StoryboardPlan, PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import { projectShotNode } from './storyboardProjection'
import { buildAgentModelEntries } from '../../../generationCanvas/agent/availableModels'
import { buildModelEntryIndex } from '../../../generationCanvas/agent/plannedNodeMeta'
import { useWorkbenchStore } from '../../../workbenchStore'
import { useGenerationCanvasStore } from '../../../generationCanvas/store/generationCanvasStore'
import { overriddenShotFields } from '../../../generationCanvas/model/storyboardOverrides'
import { effectiveShotValue } from '../shotRow/shotRowModel'
import { renderShotNodePrompt, stableShotId } from '../../../generationCanvas/agent/storyboardPlan'
import { pushUndoSnapshot } from '../../../generationCanvas/events/canvasPatchHistory'

/** Resolve exactly one field on the bound original. Discard is one canvas undo step. */
export function resolveStoryboardOverride(nodeId: string, field: string, action: 'adopt' | 'discard', owner?: { plan: StoryboardPlan; shot: PlanShot; change(plan: StoryboardPlan): void }): void {
  const canvas = useGenerationCanvasStore.getState()
  const node = canvas.nodes.find(candidate => candidate.id === nodeId)
  if (!node || !overriddenShotFields(node).includes(field)) return
  const legacyOwner = () => {
    const store = useWorkbenchStore.getState()
    const design = Object.values(store.storyboardDesignsByDocumentId).flat().find(candidate => candidate.id === node.meta?.storyboardDesignId)
    const shot = design?.plan.shots.find(candidate => stableShotId(candidate) === node.meta?.shotId)
    return design && shot ? { plan: design.plan, shot, change: (plan: StoryboardPlan) => store.setStoryboardPlan(plan, design.documentId, design.id) } : null
  }
  const authority = owner ?? legacyOwner()
  if (!authority) return
  const { plan, shot, change } = authority
  const meta: Record<string, unknown> = { ...node.meta, overriddenFields: overriddenShotFields(node).filter(candidate => candidate !== field) }
  if (action === 'adopt') {
    const value = effectiveShotValue(shot, node, field)
    const nextShot = field.startsWith('params.')
      ? { ...shot, params: { ...shot.params, [field.slice(7)]: value } }
      : { ...shot, [field]: value, ...(field === 'prompt' ? { promptSegments: undefined } : {}) }
    change({ ...plan, shots: plan.shots.map(candidate => candidate === shot ? nextShot : candidate) })
    canvas.updateNode(nodeId, { meta }, { origin: 'storyboard-projection' })
    return
  }
  pushUndoSnapshot(canvas)
  if (field === 'modelKey' || field === 'modelVendor' || field === 'modeId') {
    const entries = buildModelEntryIndex(buildAgentModelEntries(shot.modelKey ? [{ value: shot.modelKey, label: shot.modelKey, vendor: shot.modelVendor, kind: shot.shotKind ?? 'video' }] : []))
    const cleared = { ...node, meta }
    const patch = projectShotNode(plan, shot, cleared, 'shot', entries)
    canvas.updateNode(nodeId, patch, { origin: 'storyboard-projection', history: false })
    return
  }
  const value = effectiveShotValue(shot, null, field)
  if (field === 'prompt') {
    canvas.updateNode(nodeId, { prompt: renderShotNodePrompt(plan, shot), meta }, { origin: 'storyboard-projection', history: false })
  } else {
    const restored: Record<string, unknown> = { ...meta }
    if (field === 'modeId') restored.archetype = { ...(meta.archetype as object), modeId: value }
    else restored[field.startsWith('params.') ? field.slice(7) : field] = value
    canvas.updateNode(nodeId, { meta: restored }, { origin: 'storyboard-projection', history: false })
  }
}
