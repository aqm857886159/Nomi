import { getGenerationNodeFootprintSize } from '../model/generationNodeKinds'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'
import {
  resolveInsertionPositionInAreaWith,
  resolveInsertionPositionWith,
  resolveGroupInsertionDeltaWith,
  type NodeBox as SharedNodeBox,
} from '../../../../electron/capabilityCore/canvasNodeLayout'

/**
 * 新建节点落点真碰撞避让（审计 A4 根治）——**薄封装**：数学在共享层
 * `electron/capabilityCore/canvasNodeLayout`（与 electron 能力核共用同一份，杜绝两路分叉），
 * 这里只注入渲染层的**渲染足迹**（registry 名义尺寸 + NODE_RENDER_SAFETY，吸收「渲染 > 名义」增量）。
 * 函数名/签名/行为与旧版逐字节一致——「渲染层继续用同名函数」不变，既有调用方与测试零改动。
 */

// 注入的足迹解析器：kind（+可选显式 size）→ 含安全余量的包围盒尺寸（单一真相源在 registry）。
const footprint = (kind: string, size?: { width: number; height: number }) =>
  getGenerationNodeFootprintSize(kind as GenerationNodeKind, size)

export type NodeBox = {
  kind: GenerationNodeKind
  position: { x: number; y: number }
  size?: { width: number; height: number }
}

type Point = { x: number; y: number }

/**
 * 从 base 起按螺旋顺序找第一个不与任何已有节点重叠的落点（真 AABB 判重叠）。
 * `existing` 只应传**同分类**（同屏可见）节点：跨分类不同屏、不遮挡，拿它们避让只会无谓推远。
 */
export function resolveInsertionPosition(
  newKind: GenerationNodeKind,
  base: Point,
  existing: readonly NodeBox[],
  maxRings = 6,
  /**
   * 用户此刻看得见的那块（画布坐标）。给了、且 base 本来就在里面 → 先在这块里找离 base 最近的空位
   * （2026-09-25「新建尽量直接落在当前可见区域」）；找不到才退回螺旋。
   */
  visibleArea?: { x: number; y: number; width: number; height: number } | null,
): Point {
  const baseInView = visibleArea
    && base.x >= visibleArea.x && base.x <= visibleArea.x + visibleArea.width
    && base.y >= visibleArea.y && base.y <= visibleArea.y + visibleArea.height
  if (visibleArea && baseInView) {
    const inView = resolveInsertionPositionInAreaWith(footprint, newKind, base, existing as readonly SharedNodeBox[], visibleArea)
    if (inView) return inView
  }
  return resolveInsertionPositionWith(footprint, newKind, base, existing as readonly SharedNodeBox[], maxRings)
}

/**
 * 整组落点避让（粘贴多节点用）：整簇当刚体求统一位移 delta，使位移后无一张卡压住 existing——
 * 保住簇内相对排布（单一位移不变形）。不冲突 → {0,0}；极端密集 → 最后一个候选（行为可预期）。
 */
export function resolveGroupInsertionDelta(
  boxes: readonly NodeBox[],
  existing: readonly NodeBox[],
  maxRings = 6,
): Point {
  return resolveGroupInsertionDeltaWith(footprint, boxes as readonly SharedNodeBox[], existing as readonly SharedNodeBox[], maxRings)
}
