// 画布落点布局 · 渲染层与 electron 能力核**共用的唯一布局纯函数**（P1：单插避让 + 批量分层）。
//
// 住 electron/ 的理由同 canvasNodeFactory.ts（rootDir 反向 import 约束）。渲染层的
// store/resolveInsertionPosition.ts 与 agent/trajectoryLayout.ts **改成薄封装**委托到这里
// （注入 registry 足迹），函数名/签名/行为不变——「渲染层继续用同名函数」成立，且两路零分叉。
//
// 铁律：本文件零 import（不碰 registry / React / node builtins）。per-kind「渲染足迹」（名义尺寸 +
// 安全余量，吸收「渲染 > 名义」的增量）由调用方**注入** `footprint(kind)`——它自带余量即是间距，
// 单插避让与批量布局共用同一足迹，绝不各搞一套（那正是「有的路径会重叠」的病根）。

export type Size = { width: number; height: number }
export type Point = { x: number; y: number }
/** 注入的足迹解析器：kind（+可选显式 size）→ 含安全余量的包围盒尺寸。 */
export type FootprintResolver = (kind: string, size?: Size) => Size

export type NodeBox = {
  kind: string
  position: { x: number; y: number }
  size?: { width: number; height: number }
}

// ── 单插碰撞避让（原 store/resolveInsertionPosition.ts 的数学，footprint 注入化）─────────

const GAP = 48

/** 两个轴对齐矩形是否相交。 */
function overlaps(aPos: Point, aSize: Size, bPos: Point, bSize: Size): boolean {
  return (
    aPos.x < bPos.x + bSize.width &&
    aPos.x + aSize.width > bPos.x &&
    aPos.y < bPos.y + bSize.height &&
    aPos.y + aSize.height > bPos.y
  )
}

function collidesAny(pos: Point, size: Size, existing: readonly NodeBox[], footprint: FootprintResolver): boolean {
  return existing.some((node) => overlaps(pos, size, node.position, footprint(node.kind, node.size)))
}

/**
 * 在一块区域（用户此刻看得见的那块画布）里找离 base 最近的空位：整张卡都在区域内、且不压任何已有节点。
 * 找不到返回 null，由调用方退回螺旋避让。
 *
 * 为什么不直接用螺旋：螺旋一步跨一整张卡（足迹 + GAP），窄画布上第一圈候选就出了屏——2026-09-25 真机：
 * 重置到 100% 后点「新建图片」，可见区中心被已有卡占着，新卡被推到屏幕下方外面。用户拍板「新建尽量直接落在
 * 当前可见区域」，所以落点本来就在可见区里时，先在可见区里按小步距找空位。
 */
export function resolveInsertionPositionInAreaWith(
  footprint: FootprintResolver,
  newKind: string,
  base: Point,
  existing: readonly NodeBox[],
  area: { x: number; y: number; width: number; height: number },
): Point | null {
  const size = footprint(newKind)
  if (size.width > area.width || size.height > area.height) return null
  const inArea = (pos: Point) => pos.x >= area.x && pos.y >= area.y && pos.x + size.width <= area.x + area.width && pos.y + size.height <= area.y + area.height
  if (inArea(base) && !collidesAny(base, size, existing, footprint)) return base
  // 步距取足迹的 1/4：够细能钻进卡与卡之间的空当，又不至于在大可见区里算上万个点。
  const step = Math.max(16, Math.round(Math.min(size.width, size.height) / 4))
  let best: Point | null = null
  let bestDistance = Infinity
  for (let y = area.y; y + size.height <= area.y + area.height; y += step) {
    for (let x = area.x; x + size.width <= area.x + area.width; x += step) {
      const distance = (x - base.x) ** 2 + (y - base.y) ** 2
      if (distance >= bestDistance) continue
      const candidate = { x: Math.round(x), y: Math.round(y) }
      if (collidesAny(candidate, size, existing, footprint)) continue
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

// 8 个方向（先右/下，再四角/左/上），保证优先往右下铺、视觉自然。两个螺旋解算器共用。
const SPIRAL_DIRS: readonly Point[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: -1, y: -1 },
]

/**
 * 从 base 起按螺旋顺序找第一个不与任何已有节点重叠的落点（真 AABB 判重叠，非整数点等值）。
 * 步距 = 新节点足迹 + GAP（一步跨过一张卡）。全命中（极端密集）→ 返回最后一个候选（行为可预期）。
 * `existing` 只应传**同分类**（同屏可见）节点——跨分类不同屏不遮挡，拿它们避让只会无谓推远。
 */
export function resolveInsertionPositionWith(
  footprint: FootprintResolver,
  newKind: string,
  base: Point,
  existing: readonly NodeBox[],
  maxRings = 6,
): Point {
  const size = footprint(newKind)
  if (!collidesAny(base, size, existing, footprint)) return base

  const stepX = Math.round(size.width + GAP)
  const stepY = Math.round(size.height + GAP)
  let last = base
  for (let ring = 1; ring <= maxRings; ring += 1) {
    for (const dir of SPIRAL_DIRS) {
      const candidate = {
        x: Math.round(base.x + dir.x * stepX * ring),
        y: Math.round(base.y + dir.y * stepY * ring),
      }
      last = candidate
      if (!collidesAny(candidate, size, existing, footprint)) return candidate
    }
  }
  return last
}

/**
 * 整组落点避让（粘贴多节点用）：整簇当刚体求统一位移 delta，使位移后无一张卡压住 existing。
 * 步距 = 整簇包围盒 + GAP。不冲突 → {0,0}；极端密集 → 最后一个候选（行为可预期）。
 */
export function resolveGroupInsertionDeltaWith(
  footprint: FootprintResolver,
  boxes: readonly NodeBox[],
  existing: readonly NodeBox[],
  maxRings = 6,
): Point {
  if (!boxes.length) return { x: 0, y: 0 }
  const groupCollides = (dx: number, dy: number): boolean =>
    boxes.some((box) => collidesAny({ x: box.position.x + dx, y: box.position.y + dy }, footprint(box.kind, box.size), existing, footprint))
  if (!groupCollides(0, 0)) return { x: 0, y: 0 }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const box of boxes) {
    const size = footprint(box.kind, box.size)
    minX = Math.min(minX, box.position.x)
    minY = Math.min(minY, box.position.y)
    maxX = Math.max(maxX, box.position.x + size.width)
    maxY = Math.max(maxY, box.position.y + size.height)
  }
  const stepX = Math.round(maxX - minX + GAP)
  const stepY = Math.round(maxY - minY + GAP)
  let last: Point = { x: 0, y: 0 }
  for (let ring = 1; ring <= maxRings; ring += 1) {
    for (const dir of SPIRAL_DIRS) {
      const delta = { x: dir.x * stepX * ring, y: dir.y * stepY * ring }
      last = delta
      if (!groupCollides(delta.x, delta.y)) return delta
    }
  }
  return last
}

// ── 批量分层布局（原 agent/trajectoryLayout.ts 的数学，footprint 注入化）──────────────

const ORIGIN_X = 160
const ORIGIN_Y = 160
const CLEARANCE_Y = 80
const FALLBACK_SIZE = { width: 340, height: 280 }
// 分镜网格每排镜头数（用户拍板 2026-06-15）。
const STORYBOARD_SHOTS_PER_ROW = 4

export type ExistingNodeLite = { kind: string; position?: { x: number; y: number } }

function layerForKind(kind: string): number | null {
  if (kind === 'character' || kind === 'scene') return 0
  if (kind === 'image') return 1
  if (kind === 'video') return 2
  return null
}

/** 原点：无已有节点用固定原点；有则落到全体包围盒下方（含足迹高 + 间距）。 */
export function trajectoryOriginWith(footprint: FootprintResolver, existing: readonly ExistingNodeLite[]): Point {
  let maxBottom = -Infinity
  for (const node of existing) {
    if (!node.position) continue
    const height = footprint(node.kind).height
    maxBottom = Math.max(maxBottom, node.position.y + height)
  }
  if (!Number.isFinite(maxBottom)) return { x: ORIGIN_X, y: ORIGIN_Y }
  return { x: ORIGIN_X, y: Math.max(ORIGIN_Y, maxBottom + CLEARANCE_Y) }
}

/**
 * 为一批计划节点算坐标（数组与入参等长、同序）。
 * 分层形态：列 = 层（参考/关键帧/视频，仅对本批出现的层分配列位），层内按出现顺序竖排；
 * 网格形态：列数 = ceil(sqrt(n))，格子尺寸由批内最大节点足迹 derive。
 * 凑不齐 ≥2 个不同层或混入不可推导 kind → 整批退网格。两形态原点都取已有节点包围盒下方空区。
 */
export function layoutPlannedNodesWith(
  footprint: FootprintResolver,
  plannedKinds: readonly string[],
  existing: readonly ExistingNodeLite[],
): Point[] {
  const origin = trajectoryOriginWith(footprint, existing)
  const layers = plannedKinds.map(layerForKind)
  const distinctLayers = new Set(layers.filter((layer) => layer !== null))
  const layered = !layers.includes(null) && distinctLayers.size >= 2

  if (!layered) {
    let cellWidth = 0
    let cellHeight = 0
    for (const kind of plannedKinds) {
      const size = footprint(kind)
      cellWidth = Math.max(cellWidth, size.width)
      cellHeight = Math.max(cellHeight, size.height)
    }
    cellWidth = cellWidth || FALLBACK_SIZE.width
    cellHeight = cellHeight || FALLBACK_SIZE.height
    const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, plannedKinds.length))))
    return plannedKinds.map((_, index) => ({
      x: origin.x + (index % cols) * cellWidth,
      y: origin.y + Math.floor(index / cols) * cellHeight,
    }))
  }

  const presentLayers = Array.from(distinctLayers).sort((a, b) => (a as number) - (b as number)) as number[]
  const columnWidth = new Map<number, number>()
  plannedKinds.forEach((kind, index) => {
    const layer = layers[index] as number
    columnWidth.set(layer, Math.max(columnWidth.get(layer) ?? 0, footprint(kind).width))
  })
  const columnX = new Map<number, number>()
  let x = origin.x
  for (const layer of presentLayers) {
    columnX.set(layer, x)
    x += columnWidth.get(layer) ?? FALLBACK_SIZE.width
  }

  const columnY = new Map<number, number>()
  return plannedKinds.map((kind, index) => {
    const layer = layers[index] as number
    const y = columnY.get(layer) ?? origin.y
    columnY.set(layer, y + footprint(kind).height)
    return { x: columnX.get(layer) ?? origin.x, y }
  })
}

/**
 * 分镜方案专用布局（用户拍板 2026-06-15）：前 anchorCount 个参考卡顶部一排横排，其余镜头下方
 * 按阅读序每排 STORYBOARD_SHOTS_PER_ROW 个折行成网格。角色判定靠 anchorCount（道具锚 kind 也是
 * image，无法靠 kind 区分）。原点走 trajectoryOrigin 避让已有内容。间距一律用足迹。
 */
export function layoutStoryboardNodesWith(
  footprint: FootprintResolver,
  plannedKinds: readonly string[],
  anchorCount: number,
  existing: readonly ExistingNodeLite[],
): Point[] {
  const origin = trajectoryOriginWith(footprint, existing)
  const anchors = Math.max(0, Math.min(anchorCount, plannedKinds.length))
  const positions: Point[] = []

  let anchorX = origin.x
  let anchorMaxHeight = 0
  for (let i = 0; i < anchors; i += 1) {
    const size = footprint(plannedKinds[i])
    positions.push({ x: anchorX, y: origin.y })
    anchorX += size.width
    anchorMaxHeight = Math.max(anchorMaxHeight, size.height)
  }

  const shotTop = anchors > 0 ? origin.y + anchorMaxHeight + CLEARANCE_Y : origin.y
  let cellWidth = 0
  let cellHeight = 0
  for (let i = anchors; i < plannedKinds.length; i += 1) {
    const size = footprint(plannedKinds[i])
    cellWidth = Math.max(cellWidth, size.width)
    cellHeight = Math.max(cellHeight, size.height)
  }
  cellWidth = cellWidth || FALLBACK_SIZE.width
  cellHeight = cellHeight || FALLBACK_SIZE.height
  const shotCount = plannedKinds.length - anchors
  const perRow = Math.max(1, Math.min(STORYBOARD_SHOTS_PER_ROW, shotCount || 1))
  for (let j = 0; j < shotCount; j += 1) {
    const row = Math.floor(j / perRow)
    const col = j % perRow
    positions.push({ x: origin.x + col * cellWidth, y: shotTop + row * cellHeight })
  }
  return positions
}

/**
 * MCP 批量加节点的落点编排（能力核用）：≥2 节点走分层布局（层由 kind 推，凑不齐退网格），
 * 单节点走碰撞避让（对已有节点默认落点螺旋避让）。显式 x/y 由工厂在 spec 层优先，这里只管缺省落点。
 * base 默认落点：单节点用已有内容下方（trajectoryOrigin），与批量同口径、不压旧内容。
 */
export function layoutBatchWith(
  footprint: FootprintResolver,
  plannedKinds: readonly string[],
  existing: readonly NodeBox[],
): Point[] {
  if (plannedKinds.length === 0) return []
  if (plannedKinds.length === 1) {
    const base = trajectoryOriginWith(footprint, existing)
    return [resolveInsertionPositionWith(footprint, plannedKinds[0], base, existing)]
  }
  return layoutPlannedNodesWith(footprint, plannedKinds, existing)
}
