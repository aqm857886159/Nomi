import type { StoryboardDesign } from '../../../workbenchTypes'
import type { useGenerationCanvasStore } from '../../../generationCanvas/store/generationCanvasStore'
import { findShotNode, findShotKeyframeNode } from './storyboardNodeBinding'
import { buildAgentModelEntries } from '../../../generationCanvas/agent/availableModels'
import { buildModelEntryIndex } from '../../../generationCanvas/agent/plannedNodeMeta'
import { resolveArchetypeForModel } from '../../../../../electron/shared/modelArchetypes'
import type { GenerationCanvasNode } from '../../../generationCanvas/model/generationCanvasTypes'
import { overriddenShotFields, nodeShotField } from '../../../generationCanvas/model/storyboardOverrides'
import { effectiveShotValue } from '../shotRow/shotRowModel'
import { buildPlannedNodeMeta } from '../../../generationCanvas/agent/plannedNodeMeta'
import type { AgentModelEntry } from '../../../generationCanvas/agent/availableModels'
import { renderShotNodePrompt, renderShotKeyframePrompt, effectiveShotDurationSec, stableShotId, type PlanShot, type StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'
import { shotReferenceMetaPatch } from '../shotRow/shotReferenceSlots'
import { compileShotOutbound } from '../../../generationCanvas/agent/storyboardPromptCompiler'
import { resolveKeyframeParams, resolveShotParams, shotModeControls } from '../../../generationCanvas/agent/storyboardShotScope'
import { aspectRatioControlsOf, placeAspectRatio } from '../../../../../electron/shared/aspectRatioValue'
import type { ArchetypeMode } from '../../../../../electron/shared/modelArchetypes/types'
const PRIMITIVE = new Set(['string', 'number', 'boolean'])

/** Shared projection for plan writes and generation; canvas overrides are never reset. */
export function projectShotNode(
  plan: StoryboardPlan, shot: PlanShot, node: GenerationCanvasNode,
  part: 'shot' | 'keyframe', entryByKey: ReadonlyMap<string, AgentModelEntry>, mode?: ArchetypeMode | null,
): Partial<GenerationCanvasNode> {
  const isImageShot = shot.shotKind === 'image'
  const fields = part === 'shot' ? overriddenShotFields(node) : []
  const prompt = fields.includes('prompt') ? String(effectiveShotValue(shot, node, 'prompt') ?? '')
    : part === 'shot' ? renderShotNodePrompt(plan, shot) : renderShotKeyframePrompt(plan, shot)
  const meta: Record<string, unknown> = { ...(node.meta || {}) }
  const rowModelKey = part === 'shot' ? effectiveShotValue(shot, node, 'modelKey') as string | undefined : shot.keyframe?.modelKey
  const rowModelVendor = part === 'shot' ? effectiveShotValue(shot, node, 'modelVendor') as string | undefined : shot.keyframe?.modelVendor
  const rowModeId = part === 'shot' ? effectiveShotValue(shot, node, 'modeId') as string | undefined : shot.keyframe?.modeId
  // 整片默认（画幅…）与行覆盖的合并只有一个口：storyboardShotScope 的 resolver。
  // 这里曾直接读 `shot.params`，于是「继承整片默认」的行写回节点时把画幅丢了——
  // 与落画布那一处是同一个 bug 的两个出口（2026-09-12 根因合同）。
  const rowParams = part === 'shot' ? resolveShotParams(plan, shot) : resolveKeyframeParams(plan, shot)
  const metaModeId = (meta.archetype as { modeId?: unknown } | undefined)?.modeId
  if (rowModelKey && (meta.modelKey !== rowModelKey || (rowModelVendor && meta.modelVendor !== rowModelVendor) || (rowModeId && metaModeId !== rowModeId))) {
    // 行上选的 vendor 一起递进去：同名模型来自不同供应商是两个模型（身份唯一键）。
    const planned = buildPlannedNodeMeta(
      { modelKey: rowModelKey, ...(rowModelVendor ? { modelVendor: rowModelVendor } : {}), modeId: rowModeId, params: rowParams },
      entryByKey,
    )
    if (planned) Object.assign(meta, planned)
  } else {
    // 模型没换：参数直接写回节点。比例意图同样先按节点这个模式的比例控件翻成真实键（与落画布同一个判据），
    // 不然 Z-Image 节点上会多一个它不认的 `aspect_ratio`，而真正发出去的 `size` 还是旧值。
    const controls = shotModeControls({ modelKey: typeof meta.modelKey === 'string' ? meta.modelKey : undefined,
      modelVendor: typeof meta.modelVendor === 'string' ? meta.modelVendor : undefined,
      modeId: typeof metaModeId === 'string' ? metaModeId : undefined, meta })
    const placed = controls ? placeAspectRatio(rowParams, aspectRatioControlsOf(controls)).parameters : rowParams
    for (const [key, value] of Object.entries(placed)) {
      if (PRIMITIVE.has(typeof value)) meta[key] = value
    }
  }
  if (part === 'shot' && !isImageShot && Number.isFinite(shot.durationSec) && shot.durationSec > 0) {
    meta.duration = shot.durationSec
  }
  if (part === 'shot' && isImageShot) {
    meta.imageDurationSec = effectiveShotDurationSec(shot)
  }
  // 按槽参考绑定 → 节点 meta（存储键与画布同一张表 referenceSlotStorage）。请求体仍由
  // buildArchetypeInputParams 按档案的 inputKey/asArray 构造 —— 分镜侧零供应商分支（P4）。
  // 空绑定也写空值：用户刚删掉的首帧不能还留在节点上被发出去。
  if (part === 'shot' && mode !== undefined) {
    Object.assign(meta, shotReferenceMetaPatch(mode, compileShotOutbound(shot, 'shot').referenceBindings))
  }
  for (const field of fields) {
    if (field === 'prompt') continue
    const value = nodeShotField(node, field)
    if (field === 'modeId') meta.archetype = { ...(meta.archetype as object), modeId: value }
    else meta[field.startsWith('params.') ? field.slice(7) : field] = value
  }
  const patch: { prompt?: string; meta: Record<string, unknown> } = { meta }
  if ((node.prompt || '') !== prompt) patch.prompt = prompt
  return patch
}

/**
 * 一镜按它**当前选的模型 / 模式**投影进一个已存在的节点（prompt + 参考图的落节点写入点）。
 * 投影方案时（projectStoryboardDesign）与 production.materialize-storyboard 落地后共用这一处，
 * 不各自解析模式——两条路上同一镜的提示词和参考图因此逐字节相同（shotOutbound.parity.test.ts）。
 */
export function projectShotOntoNodeByPlanMode(plan: StoryboardPlan, shot: PlanShot, node: GenerationCanvasNode): Partial<GenerationCanvasNode> {
  const entries = buildModelEntryIndex(buildAgentModelEntries(shot.modelKey ? [{ value: shot.modelKey, label: shot.modelKey, vendor: shot.modelVendor, kind: shot.shotKind ?? 'video' }] : []))
  const profile = resolveArchetypeForModel({ modelKey: shot.modelKey ?? '', vendorKey: shot.modelVendor })
  const mode = profile?.modes.find(candidate => candidate.id === (shot.modeId ?? profile.defaultModeId)) ?? null
  return projectShotNode(plan, shot, node, 'shot', entries, mode)
}

/** 整方案落画布之后：把每一镜按当前模型 / 模式投影进它落出来的节点（nodeIdOf：clientId → 真实节点 id）。 */
export function projectPlanShotsOntoCreatedNodes(plan: StoryboardPlan, nodeIdOf: (clientId: string) => string, store: ReturnType<typeof useGenerationCanvasStore.getState>): void {
  for (const shot of plan.shots) {
    const node = store.nodes.find((candidate) => candidate.id === nodeIdOf(stableShotId(shot)))
    if (node) store.updateNode(node.id, projectShotOntoNodeByPlanMode(plan, shot, node), { origin: 'storyboard-projection', history: false })
  }
}

/** Called only for explicit plan edits, never project hydration. Dependency supplied by the composition root. */
export function projectStoryboardDesign(design: Pick<StoryboardDesign, 'id' | 'plan'>, canvas: ReturnType<typeof useGenerationCanvasStore.getState>): void {
  for (const shot of design.plan.shots) {
    const entries = buildModelEntryIndex(buildAgentModelEntries(shot.modelKey ? [{ value: shot.modelKey, label: shot.modelKey, vendor: shot.modelVendor, kind: shot.shotKind ?? 'video' }] : []))
    const node = findShotNode(canvas.nodes, design.id, shot)
    if (node && !node.regeneratedFrom && !node.derivedFrom) canvas.updateNode(node.id, projectShotOntoNodeByPlanMode(design.plan, shot, node), { origin: 'storyboard-projection', history: false })
    const keyframe = findShotKeyframeNode(canvas.nodes, design.id, shot)
    if (keyframe) canvas.updateNode(keyframe.id, projectShotNode(design.plan, shot, keyframe, 'keyframe', entries), { origin: 'storyboard-projection', history: false })
  }
}
