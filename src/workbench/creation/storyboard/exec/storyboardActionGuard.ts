import { withProjectAction } from '../../../project/projectCanvasReadSurface'
import { isRunTargetLoaded, readRunProjectRecord } from '../../../generationCanvas/runner/runProjectDelivery'
import { useWorkbenchStore } from '../../../workbenchStore'
import type { RowActionContext } from './storyboardRowActions'
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
  const approvalContent = (plan: StoryboardPlan, targets: ReadonlySet<string>) => {
    const { shots, ...global } = plan
    return stableProjectAgentJson({ ...global, shots: shots.filter(shot => targets.has(stableShotId(shot))) })
  }
  const currentPlan = async () => {
    const plan = await input.readPlan()
    if (!plan) throw new Error('storyboard_content_conflict')
    return plan
  }
  return {
    async assertCurrent(targetIds?: readonly string[]) {
      const targets = targetIds ? new Set(targetIds) : scope
      if (approvalContent(await currentPlan(), targets) !== approvalContent(baseline, targets)) throw new Error('storyboard_content_conflict')
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

/** Construct a fresh project-bound action; the editor owns only table/row pending state. */
export async function runStoryboardAction({ projectId, documentId, designId, plan, shotIds, action, unavailable, actionKey, activeKeys, onPendingChange, onStart, onFailure }: {
  projectId?: string | null
  documentId: string
  designId: string
  plan: StoryboardPlan
  shotIds: readonly string[]
  action: (context: RowActionContext) => Promise<unknown>
  unavailable: () => never
  actionKey: string
  activeKeys: Set<string>
  onPendingChange: (keys: ReadonlySet<string>) => void
  onStart: () => void
  onFailure: (error: unknown) => void
}): Promise<unknown> {
  if (activeKeys.has(actionKey)) return
  activeKeys.add(actionKey)
  onPendingChange(new Set(activeKeys))
  onStart()
  try {
    return await withProjectAction(async project => {
    project.assertCurrent()
    if (projectId && project.binding.projectId !== projectId) throw new Error('Storyboard project changed')
    project.assertCurrent()
    const gesture = { source: 'user' as const, txnId: crypto.randomUUID(), canWrite: () => { project.assertCurrent(); return !project.signal.aborted } }
    const actionGuard = createStoryboardActionGuard({ plan, designId, shotIds,
      readPlan: async () => {
        const designs = isRunTargetLoaded(project.binding)
          ? useWorkbenchStore.getState().storyboardDesignsByDocumentId
          : (await readRunProjectRecord(project.binding))?.payload.storyboardDesignsByDocumentId
        return designs?.[documentId]?.find(value => value.id === designId)?.plan
      },
      writePlan: next => { project.assertCurrent(); useWorkbenchStore.getState().setStoryboardPlan(next, documentId, designId) },
    })
    const assertAuthorCurrent = actionGuard.assertAuthorCurrent
    const assertCurrent = async () => {
      project.assertCurrent()
      await actionGuard.assertCurrent()
      project.assertCurrent()
    }
    await assertCurrent()
    return action({ documentId, designId, plan, gesture, assertCurrent, assertAuthorCurrent, actionGuard })
    }, unavailable)
  } catch (error) {
    onFailure(error)
  } finally {
    activeKeys.delete(actionKey)
    onPendingChange(new Set(activeKeys))
  }
}
