import { withCanvasGestureContext, type CanvasGestureContext } from '../../../generationCanvas/events/canvasGestureContext'
import { pushUndoSnapshot, getUndoJournalGeneration } from '../../../generationCanvas/events/canvasUndoJournal'
import { projectShotNode } from './storyboardProjection'
import { ignoredShotAnchors, type IgnoredAnchor } from '../../../generationCanvas/agent/storyboardAnchorPolicy'
import type { GenerationCanvasNode } from '../../../generationCanvas/model/generationCanvasTypes'
import type { ArchetypeMode } from '../../../../config/modelArchetypes/types'
import type { PlanAnchor, PlanShot, StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'
import { buildAnchorSheetPrompt } from '../../../generationCanvas/agent/storyboardPromptCompiler'
import {
  stableShotId,
  storyboardAnchorToCreateNodesArgs,
  storyboardShotToCreateNodesArgs,
  type PlanCreateNodesArgs,
  type StoryboardShotRowArgsOptions,
} from '../../../generationCanvas/agent/storyboardPlan'
import {
  listAvailableModelsForAgent,
  resolveStoryboardImageDefault,
  resolveStoryboardVideoDefault,
} from '../../../generationCanvas/agent/availableModels'
import { applyCanvasToolCall } from '../../../generationCanvas/agent/applyCanvasToolCall'
import { useGenerationCanvasStore } from '../../../generationCanvas/store/generationCanvasStore'
import { buildDependencyWaves, hasUsableResult } from '../../../generationCanvas/runner/dependencyWaves'
import { confirmAndRunNode, confirmAndRunNodeVariants, regenerateNodeInPlace } from '../../../generationCanvas/runner/generationRunController'
import { confirmAndRunPlan } from '../../../generationCanvas/components/batchPlanPreview'
import i18n from '../../../../i18n'
import { buildModelEntryIndex } from '../../../generationCanvas/agent/plannedNodeMeta'
import { ANCHOR_META_KEYS, isAnchorFrozen, type AnchorFrozenMark } from '../../../generationCanvas/model/anchorBibleKeys'
import { findAnchorNode, findShotKeyframeNode, findShotNode } from './storyboardNodeBinding'
import { rowConsumesReferences, type StoryboardRowRuntime } from './storyboardRowStatus'

/**
 * 分镜表的**执行动作层**（v5 B）：行内/批量生成 = 按需 materialize（没建过的节点此刻建）+
 * 既有 canvas runner 通路（confirmAndRunNode / confirmAndRunNodeVariants / regenerateNodeInPlace /
 * confirmAndRunPlan）。**只有这一条执行通路**：spendConfirm、付费令牌、失败即停、队列刹车、
 * undo journal 全部沿用，不另起循环（check:batch-machines 钉死 runGenerationNode 不外扩）。
 *
 * 运行前通过 projectShotNode 投影方案；节点明确覆写的字段保留画布值。
 * 方案是内容正本，行内采纳/丢弃控制字段归属，生成不静默夺回覆写字段。
 */

type RowActionContext = {
  documentId: string
  designId: string
  plan: StoryboardPlan
  gesture?: CanvasGestureContext
}

async function resolveDefaults(): Promise<Pick<StoryboardShotRowArgsOptions,
  'defaultImageModelKey' | 'defaultImageModeId' | 'defaultImageRefModeId' | 'defaultVideoModelKey' | 'defaultVideoModeId'>> {
  // 与整方案落画布同一套默认模型解析（图片偏好 GPT Image 2、视频偏好 Seedance；解析失败=空，不阻断）。
  const [imageDefault, videoDefault] = await Promise.all([
    resolveStoryboardImageDefault(),
    resolveStoryboardVideoDefault(),
  ])
  return {
    ...(imageDefault.modelKey ? { defaultImageModelKey: imageDefault.modelKey } : {}),
    ...(imageDefault.modelVendor ? { defaultImageModelVendor: imageDefault.modelVendor } : {}),
    ...(imageDefault.modeId ? { defaultImageModeId: imageDefault.modeId } : {}),
    ...(imageDefault.refModeId ? { defaultImageRefModeId: imageDefault.refModeId } : {}),
    ...(videoDefault.modelKey ? { defaultVideoModelKey: videoDefault.modelKey } : {}),
    ...(videoDefault.modelVendor ? { defaultVideoModelVendor: videoDefault.modelVendor } : {}),
    ...(videoDefault.modeId ? { defaultVideoModeId: videoDefault.modeId } : {}),
  }
}

function canvasState(): { nodes: GenerationCanvasNode[]; edges: ReturnType<typeof useGenerationCanvasStore.getState>['edges'] } {
  const state = useGenerationCanvasStore.getState()
  return { nodes: state.nodes, edges: state.edges }
}

/** 该行已建过的依赖节点映射（锚 → 真实 id；重复 materialize 时复用不重建）。 */
function existingRowBindings(ctx: RowActionContext, shot: PlanShot): {
  shotNode: GenerationCanvasNode | null
  keyframeNode: GenerationCanvasNode | null
  anchorNodeIdByAnchorId: Record<string, string>
} {
  const { nodes } = canvasState()
  const anchorNodeIdByAnchorId: Record<string, string> = {}
  for (const anchorId of shot.anchorIds) {
    const anchor = ctx.plan.anchors.find((candidate) => candidate.id === anchorId)
    if (!anchor) continue
    const node = findAnchorNode(nodes, ctx.designId, anchor)
    if (node) anchorNodeIdByAnchorId[anchorId] = node.id
  }
  return {
    shotNode: findShotNode(nodes, ctx.designId, shot),
    keyframeNode: findShotKeyframeNode(nodes, ctx.designId, shot),
    anchorNodeIdByAnchorId,
  }
}

type CreateNodesResult = { createdNodeIds?: string[]; clientIdToNodeId?: Record<string, string> }

async function applyCreate(args: PlanCreateNodesArgs, gesture?: CanvasGestureContext): Promise<Record<string, string>> {
  if (gesture?.canWrite && !gesture.canWrite()) throw new Error('Canvas changed before storyboard landing')
  const result = (await applyCanvasToolCall('create_canvas_nodes', args, gesture, gesture?.canWrite)) as CreateNodesResult
  return result?.clientIdToNodeId ?? {}
}

// ── 行编辑写回节点（跑之前的唯一收口）──

async function syncShotNodeWithRow(ctx: RowActionContext, shot: PlanShot, node: GenerationCanvasNode, part: 'shot' | 'keyframe', mode?: ArchetypeMode | null): Promise<void> {
  const entries = buildModelEntryIndex(await listAvailableModelsForAgent())
  if (ctx.gesture?.canWrite && !ctx.gesture.canWrite()) throw new Error('Canvas changed before storyboard update')
  const current = useGenerationCanvasStore.getState().nodes.find(candidate => candidate.id === node.id)
  if (!current) return
  const patch = projectShotNode(ctx.plan, shot, current, part, entries, mode)
  const write = () => useGenerationCanvasStore.getState().updateNode(node.id, patch, { origin: 'storyboard-projection' })
  if (ctx.gesture) withCanvasGestureContext(ctx.gesture, write)
  else write()
}

/**
 * 按需 materialize 一行：缺什么建什么（该行引用且没建过的锚卡 / 首帧图 / 本体节点），
 * 建过的写回行编辑后复用。返回本体与首帧图的真实节点 id。
 */
export async function materializeShotRow(
  ctx: RowActionContext,
  shot: PlanShot,
  mode: ArchetypeMode | null,
): Promise<{ shotNodeId: string; keyframeNodeId: string | null; ignoredAnchors: IgnoredAnchor[] }> {
  const ignoredAnchors = ignoredShotAnchors(ctx.plan, shot, mode)
  const existing = existingRowBindings(ctx, shot)
  const keyframeEnabled = shot.shotKind !== 'image' && shot.keyframe?.enabled === true
  if (existing.shotNode && (!keyframeEnabled || existing.keyframeNode)) {
    await syncShotNodeWithRow(ctx, shot, existing.shotNode, 'shot', mode)
    if (existing.keyframeNode) await syncShotNodeWithRow(ctx, shot, existing.keyframeNode, 'keyframe')
    return { ignoredAnchors, shotNodeId: existing.shotNode.id, keyframeNodeId: existing.keyframeNode?.id ?? null }
  }
  const defaults = await resolveDefaults()
  if (ctx.gesture?.canWrite && !ctx.gesture.canWrite()) throw new Error('Canvas changed before storyboard materialization')
  const args = storyboardShotToCreateNodesArgs(ctx.plan, shot, {
    ...defaults,
    creationDocumentId: ctx.documentId,
    storyboardDesignId: ctx.designId,
    existingAnchorNodeIdByAnchorId: existing.anchorNodeIdByAnchorId,
    ...(existing.keyframeNode ? { existingKeyframeNodeId: existing.keyframeNode.id } : {}),
    ...(rowConsumesReferences(mode) ? {} : { omitAnchorReferenceEdges: true }),
  })
  const clientIdToNodeId = await applyCreate(args, ctx.gesture)
  const shotNodeId = existing.shotNode?.id ?? clientIdToNodeId[stableShotId(shot)]
  if (!shotNodeId) throw new Error('materialize failed: shot node missing')
  const keyframeNodeId = existing.keyframeNode?.id
    ?? (keyframeEnabled ? clientIdToNodeId[`${stableShotId(shot)}-keyframe`] ?? null : null)
  // 刚建出来的节点同样要过一遍写回 —— 参考绑定不在 create_canvas_nodes 的参数面里，
  // 只在这条写回边界上进 meta；漏掉它 = 第一次生成不带参考、第二次才带（最阴的静默陷阱）。
  const created = canvasState().nodes.find((node) => node.id === shotNodeId)
  if (created) await syncShotNodeWithRow(ctx, shot, created, 'shot', mode)
  if (existing.keyframeNode) await syncShotNodeWithRow(ctx, shot, existing.keyframeNode, 'keyframe')
  return { shotNodeId, keyframeNodeId, ignoredAnchors }
}

/**
 * 行内「生成」：单行 materialize → 既有单发通路。图片+视频镜（首帧还没出）走依赖波次
 * （首帧先、视频后，一次确认；未定妆锚会被 W2 冻结门人话拦下——与画布批量同语义）。
 */
export async function generateShotRow(
  ctx: RowActionContext,
  shot: PlanShot,
  mode: ArchetypeMode | null,
): Promise<void> {
  const { shotNodeId, keyframeNodeId } = await materializeShotRow(ctx, shot, mode)
  const { nodes, edges } = canvasState()
  const keyframeNode = keyframeNodeId ? nodes.find((node) => node.id === keyframeNodeId) ?? null : null
  if (keyframeNode && !hasUsableResult(keyframeNode)) {
    await confirmAndRunPlan(buildDependencyWaves([keyframeNodeId!, shotNodeId], { nodes, edges }))
    return
  }
  await confirmAndRunNode(shotNodeId)
}

/** 悬停浮条 ↻：写回行编辑 + 原地重生成（同节点、不换 id、时间轴回填闸沿用）。 */
export async function regenerateShotRow(
  ctx: RowActionContext,
  shot: PlanShot,
  node: GenerationCanvasNode,
  mode: ArchetypeMode | null,
  confirmOpts?: { title?: string; confirmLabel?: string },
): Promise<void> {
  await syncShotNodeWithRow(ctx, shot, node, 'shot', mode)
  await regenerateNodeInPlace(node.id, confirmOpts)
}

/**
 * 「用新图重跑」（参考已变链，B3）：参考直接连在本体上 → 原地重生成即用新图；
 * 锚边连在首帧图上（图片+视频镜）→ 首帧、本体按波次连跑（首帧先出新图、视频再用它），
 * 一次花钱确认。提交时 runner 重新打 refSnapshot 戳 → 亮标自然消。
 */
export async function rerunShotRowWithFreshRefs(
  ctx: RowActionContext,
  shot: PlanShot,
  exec: { node: GenerationCanvasNode | null; keyframeNode: GenerationCanvasNode | null },
  mode: ArchetypeMode | null,
): Promise<void> {
  if (!exec.node) return
  if (!exec.keyframeNode) {
    // 确认卡回声按钮文案「用新图重跑」——警示行刚说完「此镜用的还是旧图」，通用「重新生成」
    // 卡会让人迟疑这一下到底用没用新图（图+视频分支走批量波次卡，卡上列出首帧+视频，语义自明）。
    const rerunLabel = i18n.t('storyboardEditor.row.rerunFreshRefs')
    await regenerateShotRow(ctx, shot, exec.node, mode, { title: rerunLabel, confirmLabel: rerunLabel })
    return
  }
  await syncShotNodeWithRow(ctx, shot, exec.keyframeNode, 'keyframe')
  await syncShotNodeWithRow(ctx, shot, exec.node, 'shot', mode)
  const { nodes, edges } = canvasState()
  await confirmAndRunPlan(buildDependencyWaves([exec.keyframeNode.id, exec.node.id], { nodes, edges }))
}

/** 悬停浮条 ×3：写回行编辑 + 同镜连出 3 版（结果堆叠进历史，失败即停不连烧）。 */
export async function generateShotRowVariants(ctx: RowActionContext, shot: PlanShot, node: GenerationCanvasNode, mode: ArchetypeMode | null): Promise<void> {
  await syncShotNodeWithRow(ctx, shot, node, 'shot', mode)
  await confirmAndRunNodeVariants(node.id, 3)
}

/**
 * 节点锁定开关（B2 镜行 / B3 参考卡共用）：与画布定妆**同一把锁**（meta.frozen 同键同形，
 * anchorBibleKeys 单源）。锁 = 满意了别动它：不进批量、不被表内重跑。只有已生成的可锁。
 */
export function toggleNodeLock(nodeId: string): void {
  const store = useGenerationCanvasStore.getState()
  const node = store.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return
  if (isAnchorFrozen(node)) {
    const nextMeta = { ...(node.meta || {}) }
    delete nextMeta[ANCHOR_META_KEYS.frozen]
    store.updateNode(nodeId, { meta: nextMeta })
    return
  }
  if (!hasUsableResult(node)) return
  const frozen: AnchorFrozenMark = { at: Date.now(), by: 'user' }
  store.updateNode(nodeId, { meta: { ...(node.meta || {}), [ANCHOR_META_KEYS.frozen]: frozen } })
}

// ── 参考卡（锚）的就地生成（B3 图卡用；B1 先落通路）──

/** 锚卡「生成」：没建过则 materialize，再走单发通路（参考卡不吃参考，无波次）。 */
export async function generateAnchorCard(ctx: RowActionContext, anchor: PlanAnchor): Promise<void> {
  const { nodes } = canvasState()
  const node = findAnchorNode(nodes, ctx.designId, anchor)
  if (!node) {
    const defaults = await resolveDefaults()
    const args = storyboardAnchorToCreateNodesArgs(ctx.plan, anchor, {
      ...defaults,
      creationDocumentId: ctx.documentId,
      storyboardDesignId: ctx.designId,
    })
    if (!args) return // 文本锚不生成图（按钮态就不该出现）
    const clientIdToNodeId = await applyCreate(args)
    const nodeId = clientIdToNodeId[anchor.id]
    if (!nodeId) throw new Error('materialize failed: anchor node missing')
    await confirmAndRunNode(nodeId)
    return
  }
  syncAnchorNodeWithCard(anchor, node)
  await confirmAndRunNode(node.id)
}

/** 锚卡「重生成」：写回描述编辑 + 原地重出（引用它的镜之后经「参考已变」提示重跑，绝不自动跑）。 */
export async function regenerateAnchorCard(ctx: RowActionContext, anchor: PlanAnchor, node: GenerationCanvasNode): Promise<void> {
  syncAnchorNodeWithCard(anchor, node)
  await regenerateNodeInPlace(node.id)
}

/** 锚卡编辑写回节点（描述/静动特征改了再生成，出的是改后的卡）。 */
function syncAnchorNodeWithCard(anchor: PlanAnchor, node: GenerationCanvasNode): void {
  const prompt = buildAnchorSheetPrompt(anchor)
  const meta: Record<string, unknown> = { ...(node.meta || {}) }
  const staticFeatures = (anchor.staticFeatures || '').trim()
  const dynamicFeatures = (anchor.dynamicFeatures || '').trim()
  if (staticFeatures) meta[ANCHOR_META_KEYS.staticFeatures] = staticFeatures
  if (dynamicFeatures) meta[ANCHOR_META_KEYS.dynamicFeatures] = dynamicFeatures
  const patch: { prompt?: string; title?: string; meta: Record<string, unknown> } = { meta }
  if ((node.prompt || '') !== prompt) patch.prompt = prompt
  if (anchor.name.trim() && node.title !== anchor.name.trim()) patch.title = anchor.name.trim()
  useGenerationCanvasStore.getState().updateNode(node.id, patch, { origin: 'storyboard-projection' })
}

// ── 批量（footer 主按钮）──

/**
 * 「生成未生成的 N 镜」：把就绪行（含失败重试）一次 materialize，再交给既有批量通路
 * confirmAndRunPlan（一次花钱确认 + 依赖波次「首帧先、镜头后」+ 失败汇总/重试）。
 * 等待/缺料/待锁定/已锁/生成中的行由 deriveStoryboardBatch 提前排除，footer 写明原因。
 */
export async function runStoryboardBatch(
  ctx: RowActionContext,
  rows: readonly StoryboardRowRuntime[],
  landing?: { groupTitle: string },
): Promise<void> {
  if (rows.length === 0) return
  const existingNodeIds = new Set(canvasState().nodes.map(node => node.id))
  if (landing) {
    const generation = getUndoJournalGeneration()
    pushUndoSnapshot()
    ctx = { ...ctx, gesture: { source: 'user', txnId: `shot-table-batch-${crypto.randomUUID()}`, suppressUndoBarriers: true, canWrite: () => getUndoJournalGeneration() === generation } }
  }
  const runIds: string[] = []
  for (const row of rows) {
    if (ctx.gesture?.canWrite && !ctx.gesture.canWrite()) throw new Error('Canvas changed before storyboard batch')
    const { shotNodeId, keyframeNodeId } = await materializeShotRow(ctx, row.shot, row.mode)
    const { nodes } = canvasState()
    const keyframeNode = keyframeNodeId ? nodes.find((node) => node.id === keyframeNodeId) ?? null : null
    if (keyframeNode && !hasUsableResult(keyframeNode)) runIds.push(keyframeNode.id)
    runIds.push(shotNodeId)
  }
  if (landing && ctx.gesture) {
    withCanvasGestureContext(ctx.gesture, () => {
      const store = useGenerationCanvasStore.getState()
      if (ctx.gesture?.canWrite && !ctx.gesture.canWrite()) throw new Error('Canvas changed before storyboard grouping')
      const createdIds = runIds.filter(id => !existingNodeIds.has(id))
      if (createdIds.length) store.createGroup('shots', landing.groupTitle, { nodeIds: createdIds })
    })
  }
  if (ctx.gesture?.canWrite && !ctx.gesture.canWrite()) throw new Error('Canvas changed before storyboard confirmation')
  const { nodes, edges } = canvasState()
  await confirmAndRunPlan(buildDependencyWaves(runIds, { nodes, edges }))
}
