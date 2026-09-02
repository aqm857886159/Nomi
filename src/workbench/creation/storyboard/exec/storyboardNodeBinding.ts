import type { GenerationCanvasNode } from '../../../generationCanvas/model/generationCanvasTypes'
import type { PlanAnchor, PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import { stableShotId } from '../../../generationCanvas/agent/storyboardPlan'

/**
 * 分镜表 ↔ 画布节点的**绑定层**（纯函数，v5 B）：表是节点的表格表示版，绑定键落在节点 meta 里
 * （落画布时由 storyboardPlan 转换器写入，随项目持久化、重启仍在）——
 * - 镜行 ↔ 节点：`meta.storyboardDesignId × meta.shotId`（首帧图节点另带 `meta.storyboardKeyframe`）；
 * - 参考卡 ↔ 节点：`meta.storyboardDesignId × meta.anchorId`（B 起写入；旧落的卡回退
 *   `meta.referenceSheet + title === anchor.name` 匹配，不丢老项目）。
 * 「基于此生成变体」会复制出同绑定键的新节点（regeneratedFrom 血缘）——绑定优先认**原节点**，
 * 变体是画布上的分支产物，不抢表行的身份。
 */

function metaOf(node: GenerationCanvasNode): Record<string, unknown> {
  const meta = node.meta
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {}
}

function belongsToDesign(node: GenerationCanvasNode, designId: string): boolean {
  return Boolean(designId) && metaOf(node).storyboardDesignId === designId
}

/** 同键多节点（变体复制）时优先无 regeneratedFrom 的原节点，其次第一个匹配。 */
function preferOriginal(matches: GenerationCanvasNode[]): GenerationCanvasNode | null {
  return matches.find((node) => !node.regeneratedFrom) ?? matches[0] ?? null
}

/** 该镜行绑定的画布节点（图片镜/视频镜本体；首帧图节点不算）。 */
export function findShotNode(
  nodes: readonly GenerationCanvasNode[],
  designId: string,
  shot: PlanShot,
): GenerationCanvasNode | null {
  const shotId = stableShotId(shot)
  return preferOriginal(nodes.filter((node) => {
    const meta = metaOf(node)
    return belongsToDesign(node, designId) && meta.shotId === shotId && meta.storyboardKeyframe !== true
  }))
}

/** 该镜行（图片+视频模式）绑定的首帧图节点。 */
export function findShotKeyframeNode(
  nodes: readonly GenerationCanvasNode[],
  designId: string,
  shot: PlanShot,
): GenerationCanvasNode | null {
  const shotId = stableShotId(shot)
  return preferOriginal(nodes.filter((node) => {
    const meta = metaOf(node)
    return belongsToDesign(node, designId) && meta.shotId === shotId && meta.storyboardKeyframe === true
  }))
}

/** 该参考卡绑定的画布节点（B 起按 meta.anchorId；旧项目回退 referenceSheet + 同名匹配）。 */
export function findAnchorNode(
  nodes: readonly GenerationCanvasNode[],
  designId: string,
  anchor: PlanAnchor,
): GenerationCanvasNode | null {
  const byAnchorId = preferOriginal(nodes.filter((node) => belongsToDesign(node, designId) && metaOf(node).anchorId === anchor.id))
  if (byAnchorId) return byAnchorId
  const name = anchor.name.trim()
  if (!name) return null
  return preferOriginal(nodes.filter((node) => {
    const meta = metaOf(node)
    return belongsToDesign(node, designId) && meta.referenceSheet === true && meta.anchorId === undefined && node.title.trim() === name
  }))
}

/** 已建节点的镜数（方案卡「已建 N 镜」与 committed 语义的 derive 源）。 */
export function materializedShotIds(nodes: readonly GenerationCanvasNode[], designId: string): Set<string> {
  const ids = new Set<string>()
  for (const node of nodes) {
    const meta = metaOf(node)
    if (belongsToDesign(node, designId) && typeof meta.shotId === 'string' && meta.storyboardKeyframe !== true) {
      ids.add(meta.shotId)
    }
  }
  return ids
}

/**
 * 方案「已落画布」的 v5 语义：**至少一镜已建节点**（derive 自画布，节点删光即回草稿——诚实）。
 * 旧项目（确认落画布时代、节点 meta 无 designId 可查）回退存量 committed 标记。
 */
export function designCommittedNow(
  design: { id: string; committed: boolean },
  nodes: readonly GenerationCanvasNode[],
): boolean {
  return materializedShotIds(nodes, design.id).size > 0 || design.committed
}
