import { getGenerationNodeFootprintSize } from '../model/generationNodeKinds'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'
import {
  layoutPlannedNodesWith,
  layoutStoryboardNodesWith,
  trajectoryOriginWith,
  type ExistingNodeLite as SharedExistingNodeLite,
} from '../../../../electron/shared/canvas/canvasNodeLayout'

/**
 * 轨迹分层布局（T4 + 审计 A3/A5②）——**薄封装**：数学在共享层
 * `electron/capabilityCore/canvasNodeLayout`（与 electron 能力核共用同一份，杜绝两路分叉），
 * 这里只注入渲染层**渲染足迹**（registry 名义 + NODE_RENDER_SAFETY，足迹自带余量即是间距，
 * 与单插避让 resolveInsertionPosition 共用同一余量、不漏网）。函数名/签名/行为与旧版逐字节一致。
 * - 分层：character/scene→参考列；image→关键帧列；video→视频列；凑不齐 ≥2 层或混不可推导 kind → 退网格。
 * - 分镜专用：参考行在上、镜头折行网格（角色判定靠 anchorCount，道具锚 kind 也是 image）。
 * 两形态原点都取已有节点包围盒下方空区——新计划永远不压旧内容。
 */

const footprint = (kind: string) => getGenerationNodeFootprintSize(kind as GenerationNodeKind)

type ExistingNodeLite = { kind: GenerationNodeKind; position?: { x: number; y: number } }

/** 原点：无已有节点用固定原点；有则落到全体包围盒下方（含节点默认高度 + 间距）。 */
export function trajectoryOrigin(existing: readonly ExistingNodeLite[]): { x: number; y: number } {
  return trajectoryOriginWith(footprint, existing as readonly SharedExistingNodeLite[])
}

/** 为一批计划节点算坐标（数组与入参等长、同序）：分层竖排 / 网格回退。 */
export function layoutPlannedNodes(
  plannedKinds: readonly GenerationNodeKind[],
  existing: readonly ExistingNodeLite[],
): Array<{ x: number; y: number }> {
  return layoutPlannedNodesWith(footprint, plannedKinds, existing as readonly SharedExistingNodeLite[])
}

/** 分镜方案专用布局：前 anchorCount 个参考卡顶部一排，其余镜头下方折行网格。 */
export function layoutStoryboardNodes(
  plannedKinds: readonly GenerationNodeKind[],
  anchorCount: number,
  existing: readonly ExistingNodeLite[],
): Array<{ x: number; y: number }> {
  return layoutStoryboardNodesWith(footprint, plannedKinds, anchorCount, existing as readonly SharedExistingNodeLite[])
}
