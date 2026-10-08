import { resolveGenerationShotScope } from '../../../electron/shared/agentCapabilities/generationShotScope'
import { stableProjectAgentJson } from '../../../electron/shared/legacyAgentJson'
import { preloadModelOptions } from '../../config/useModelOptions'
import { withProjectAction } from '../project/projectCanvasReadSurface'
import { useWorkbenchStore } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { deriveStoryboardBatch, deriveStoryboardRowRuntimes, deriveAnchorCardRuntimes } from '../creation/storyboard/exec/storyboardRowStatus'
import { getDesktopBridge } from '../../desktop/bridge'
import { resolveGeneratableGate } from '../creation/storyboard/strategyGate'
import { generateAnchorCard, runStoryboardBatch } from '../creation/storyboard/exec/storyboardRowActions'
import { mergeRunOutcomes, type GenerationRunOutcome } from '../generationCanvas/runner/generationRunOutcome'

/** 他说了「不」那一支的回包：形状与成功那一支逐字相同，只有 `decision` 不一样。 */
export type StoryboardPresentResult = {
  status: 'presented'
  designId: string
  shotIds: readonly string[]
  decision: GenerationRunOutcome
  operations?: string[]
}

function declined(designId: string, shotIds: readonly string[], outcomes: readonly GenerationRunOutcome[]): StoryboardPresentResult {
  return { status: 'presented' as const, designId, shotIds, decision: mergeRunOutcomes(outcomes) }
}

/** 方案正本住在项目记录里；本地内容 token 与编辑器自己的所有权闸用的是同一套比对。 */
function readDesign(documentId: string, designId: string) {
  const design = (useWorkbenchStore.getState().storyboardDesignsByDocumentId[documentId] ?? [])
    .find(value => value.id === designId)
  if (!design) throw new Error('storyboard_design_missing')
  return design
}

function contentOf(documentId: string, designId: string): string {
  return stableProjectAgentJson(JSON.parse(JSON.stringify(readDesign(documentId, designId).plan)))
}

/** The existing renderer bridge supplies identity; original actions still own all paid behavior. */
export async function presentStoryboard(data: Record<string, unknown>): Promise<StoryboardPresentResult> {
  const { projectId, designId, sourceDocumentId } = data
  if (typeof projectId !== 'string' || typeof designId !== 'string' || typeof sourceDocumentId !== 'string') {
    throw new Error('storyboard_target_required')
  }
  return withProjectAction(async project => {
    project.assertCurrent()
    if (project.binding.projectId !== projectId) throw new Error('storyboard_project_changed')
    const plan = readDesign(sourceDocumentId, designId).plan
    const captured = contentOf(sourceDocumentId, designId)
    const ids = [...plan.anchors.map(anchor => anchor.id), ...plan.shots.map(shot => shot.shotId!)]
    const scope = resolveGenerationShotScope(ids, data.shotIds)
    const [imageModelOptions, videoModelOptions] = await Promise.all([preloadModelOptions('image', 'any-published'), preloadModelOptions('video', 'any-published')])
    project.assertCurrent()
    const assertAuthorCurrent = async () => {
      if (contentOf(sourceDocumentId, designId) !== captured) throw new Error('storyboard_content_conflict')
    }
    const assertCurrent = async () => { project.assertCurrent(); await assertAuthorCurrent(); project.assertCurrent() }
    await assertCurrent()
    const canvas = useGenerationCanvasStore.getState()
    const context = { documentId: sourceDocumentId, designId, plan, assertCurrent, assertAuthorCurrent,
      gesture: { source: 'agent' as const, txnId: crypto.randomUUID(), canWrite: () => { project.assertCurrent(); return !project.signal.aborted } } }
    const runtimes = () => deriveStoryboardRowRuntimes({ plan, designId,
      nodes: useGenerationCanvasStore.getState().nodes, imageModelOptions, videoModelOptions })
    const anchors = deriveAnchorCardRuntimes({ plan, designId, nodes: canvas.nodes })
    // 每一次问都可能被他拒掉，所以逐次收结局，最后合成一个（规则见 `mergeRunOutcomes`）。
    const outcomes: GenerationRunOutcome[] = []
    for (const entry of anchors.filter(value => scope.includes(value.anchor.id))) {
      if (!entry.visual || entry.locked || entry.resultUrl || entry.generating || entry.recoverable) continue
      await assertCurrent()
      outcomes.push(await generateAnchorCard(context, entry.anchor))
      // 他对锚卡说了「不」，就别再拿下一张卡追问他——这一次 present 到此为止。
      if (outcomes[outcomes.length - 1] === 'declined') return declined(designId, scope, outcomes)
    }
    const rows = deriveStoryboardBatch(runtimes().filter(row => scope.includes(row.shot.shotId!))).runnable
    const blocker = await resolveGeneratableGate(plan, projectId, getDesktopBridge()?.generationStrategy,
      rows.map(row => row.shot.shotId!))
    if (blocker) throw new Error('storyboard_strategy_blocked')
    await assertCurrent()
    // 整批：他在卡上点了确认、每一镜的出价开好那一刻就交回（发动机收敛第一刀第 3 步「交回 operation」）——不再等整批跑完才回话。
    // 之后的派发、结果、每一镜的结局都在各自的单镜 Run 里（`operations`），批量照常在画布上跑完。
    let operations: string[] | undefined
    if (rows.length) {
      let consented: (runIds: string[]) => void = () => undefined
      const onConsent = new Promise<{ consented: string[] }>((resolve) => { consented = (runIds) => resolve({ consented: runIds }) })
      const batch = runStoryboardBatch(context, rows, undefined, consented)
      const first = await Promise.race([batch.then((outcome) => ({ outcome })), onConsent])
      if ('consented' in first) {
        operations = first.consented
        outcomes.push('started')
        // 已经交回了：整批在后台跑，跑挂由批量自己的失败汇总说话（runPlanWithToasts），这里不再有人等它的结果。
        void batch.catch(() => undefined)
      } else {
        outcomes.push(first.outcome)
      }
    }
    // 2026-09-22：这里原来写着「Original confirmation returns void for both acceptance and
    // cancellation」，然后无条件回 `presented`——**结局被扔在这一行**。于是 Agent 的 `generate`
    // 读不到任何结论，只好以 `generation_approval_unavailable` 的**错误形状**回给模型并进熔断
    // （run5：A1 一次、A3 两次，与答框次数一一对应）。现在把它带回去。
    return { status: 'presented' as const, designId, shotIds: scope, decision: mergeRunOutcomes(outcomes), ...(operations ? { operations } : {}) }
  }, () => { throw new Error('storyboard_project_unavailable') })
}
