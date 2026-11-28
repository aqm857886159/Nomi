import { getGenerationNodeFootprintSize, getNodeBaseSize } from '../model/generationNodeKinds'
import type { GenerationCanvasNode, GenerationNodeKind } from '../model/generationCanvasTypes'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import {
  resolveInsertionPositionInAreaWith,
  resolveInsertionPositionWith,
  resolveGroupInsertionDeltaWith,
  type NodeBox as SharedNodeBox,
} from '../../../../electron/shared/canvas/canvasNodeLayout'

/**
 * 新建节点落点真碰撞避让（审计 A4 根治）——**薄封装**：数学在共享层
 * `electron/capabilityCore/canvasNodeLayout`（与 electron 能力核共用同一份，杜绝两路分叉），
 * 这里只注入渲染层的**渲染足迹**（registry 名义尺寸 + NODE_RENDER_SAFETY，吸收「渲染 > 名义」增量）。
 * 函数名/签名/行为与旧版逐字节一致——「渲染层继续用同名函数」不变，既有调用方与测试零改动。
 */

// 注入的足迹解析器：kind（+可选显式 size）→ 含安全余量的包围盒尺寸（单一真相源在 registry）。
const footprint = (kind: string, size?: { width: number; height: number }) =>
  getGenerationNodeFootprintSize(kind as GenerationNodeKind, size)

/**
 * 一个占位盒。除 kind / position / size 外，带上 `meta` / `result` / `renderKind` 等渲染事实就能算出节点**真实渲染尺寸**
 * （竖版图、有结果的视频、固定宽的卡片都比名义 size 大）——传完整节点即可，不用自己挑字段。
 */
export type NodeBox = {
  kind: GenerationNodeKind
  position: { x: number; y: number }
  size?: { width: number; height: number }
} & Partial<Pick<GenerationCanvasNode, 'renderKind' | 'categoryId' | 'meta' | 'result'>>

type Size = { width: number; height: number }

/**
 * 一个盒子在画布上**真正占的地方**：渲染尺寸（`resolveNodeVisualSize`，几何子系统共用的唯一真相源）与名义尺寸取各轴较大者。
 * 避让只认名义 `node.size` 时（旧做法），竖版图 / 有媒体结果的卡渲染出来比名义高一大截，新节点就落进它的下半身里
 * （2026-10-18 走查：视频浮条「拆解 ▾ → 镜头表」建出的表压在旁边一排竖图上）。取较大者 = 永远不比旧版更松。
 */
export function occupiedSize(box: Pick<NodeBox, 'kind' | 'size'> & Partial<NodeBox>): Size {
  const base = getNodeBaseSize(box)
  const visual = resolveNodeVisualSize({ ...box, size: base })
  return { width: Math.max(base.width, Math.ceil(visual.width)), height: Math.max(base.height, Math.ceil(visual.height)) }
}

const withOccupiedSize = (box: NodeBox): NodeBox => ({ ...box, size: occupiedSize(box) })

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
  /** 新节点的真实占位（`occupiedSize(新节点)`）；不给 = 名义尺寸。 */
  newSize?: Size,
): Point {
  // 已有节点一律按真实占位比：每次调用只算一遍，后面的螺旋 / 可见区扫描反复比的是现成的盒子。
  const occupied = existing.map(withOccupiedSize) as readonly SharedNodeBox[]
  const baseInView = visibleArea
    && base.x >= visibleArea.x && base.x <= visibleArea.x + visibleArea.width
    && base.y >= visibleArea.y && base.y <= visibleArea.y + visibleArea.height
  if (visibleArea && baseInView) {
    // 判「整张卡在可见区里」要新节点自己的大小：调用方没给就按这一种的名义大小量（不拿带间距的足迹顶替）。
    const inView = resolveInsertionPositionInAreaWith(footprint, newKind, base, occupied, visibleArea, newSize ?? occupiedSize({ kind: newKind }))
    if (inView) return inView
  }
  return resolveInsertionPositionWith(footprint, newKind, base, occupied, maxRings, newSize)
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
  return resolveGroupInsertionDeltaWith(footprint, boxes.map(withOccupiedSize) as readonly SharedNodeBox[], existing.map(withOccupiedSize) as readonly SharedNodeBox[], maxRings)
}
