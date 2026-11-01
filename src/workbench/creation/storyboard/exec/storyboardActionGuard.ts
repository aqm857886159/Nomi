import { stableProjectAgentJson } from '../../../../../electron/shared/legacyAgentJson'
import { stableShotId, type StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'
import type { RunGraph } from '../../../generationCanvas/runner/runProjectDelivery'
import { useGenerationCanvasStore } from '../../../generationCanvas/store/generationCanvasStore'
import { useGenerationQueueStore } from '../../../generationCanvas/runner/generationQueueStore'
import { findAnchorNode, findShotKeyframeNode, findShotNode } from './storyboardNodeBinding'
import { autoReferenceFromCanvas } from './storyboardAutoReference'

/** Approval owns its selected shots; execution owns only the row bound to that node. */
export function createStoryboardActionGuard(input: {
  plan: StoryboardPlan
  designId: string
  shotIds: readonly string[]
  readPlan: () => Promise<StoryboardPlan | undefined>
  writePlan: (plan: StoryboardPlan) => void
}) {
  let baseline = structuredClone(input.plan)
  const scope = new Set(input.shotIds)
  const approvalContent = (plan: StoryboardPlan) => {
    const { shots, ...global } = plan
    return stableProjectAgentJson({ ...global, shots: shots.filter(shot => scope.has(stableShotId(shot))) })
  }
  const currentPlan = async () => {
    const plan = await input.readPlan()
    if (!plan) throw new Error('storyboard_content_conflict')
    return plan
  }
  return {
    async assertCurrent() {
      if (approvalContent(await currentPlan()) !== approvalContent(baseline)) throw new Error('storyboard_content_conflict')
    },
    async assertAuthorCurrent(graph: RunGraph, executingNodeId: string) {
      const node = graph.nodes.find(value => value.id === executingNodeId)
      if (!node) return
      const shot = baseline.shots.find(value => findShotNode([node], input.designId, value) || findShotKeyframeNode([node], input.designId, value))
      const anchor = baseline.anchors.find(value => findAnchorNode([node], input.designId, value))
      if (!shot && !anchor) return
      const current = await currentPlan()
      const row = shot ? current.shots.find(value => stableShotId(value) === stableShotId(shot)) : current.anchors.find(value => value.id === anchor!.id)
      if (stableProjectAgentJson(row ?? null) !== stableProjectAgentJson(shot ?? anchor)) throw new Error('storyboard_content_conflict')
    },
    async refreshReferences() {
      const current = await currentPlan()
      const next = autoReferenceFromCanvas(current, input.designId, useGenerationCanvasStore.getState().nodes, useGenerationQueueStore.getState().entries)
      if (next !== current) input.writePlan(next)
      // Re-read the canonical plan after the write; the editor effect can have committed first.
      baseline = structuredClone(await currentPlan())
      return baseline
    },
  }
}
export type StoryboardActionGuard = ReturnType<typeof createStoryboardActionGuard>
