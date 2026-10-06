// 版本卡片铺开成宫格的几何——纯函数，画布坐标（相对节点左上角），不量 DOM、不进 store。
//
// 用户 2026-10-06：「和原来的图片一样的东西，而且排列按照宫格排列，要不然就会一长排」。规则：
// - 每张卡和节点一样大；
// - 张数排成接近正方形的宫格：列数 = ⌈√n⌉、行数 = ⌈n / 列⌉（2 张 1×2、3–4 张 2×2、5–6 张 3×2、7–9 张 3×3）；
// - 收着的时候最多 9 格；超过 9 版时前 8 格放最新的 8 版、第 9 格是「+N」，点开后全部铺开（同一条规则排）；
// - 最新一版离节点最近：从贴着节点的那一角开始，先横后竖；往左铺时整块镜像；
// - 生成中占位卡排在最前（新的一版会落在那里）。

export type VersionGridPlacement = 'right' | 'left'

export type VersionGridItem<T> =
  | Readonly<{ kind: 'pending' }>
  | Readonly<{ kind: 'version'; version: T }>
  | Readonly<{ kind: 'more'; hidden: readonly T[] }>

export type VersionGridCell<T> = VersionGridItem<T> & Readonly<{ x: number; y: number; column: number; row: number }>

export type VersionGridLayout<T> = Readonly<{
  cells: readonly VersionGridCell<T>[]
  columns: number
  rows: number
  /** 整块宫格的外框（相对节点左上角），供遮挡判定与「往左还是往右」用。 */
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>
}>

export const VERSION_GRID_COLLAPSED_LIMIT = 9
/** 节点与第一列之间、格与格之间的间距（画布单位）。节点侧留宽一点：那里是节点的连线「+」圈。 */
export const VERSION_GRID_NODE_GAP = 44
export const VERSION_GRID_GAP = 16
/** 每格上方留给「第 N 版」小字和悬停条的高度。 */
export const VERSION_GRID_LABEL_SPACE = 28

export function versionGridShape(count: number): { columns: number; rows: number } {
  if (count <= 0) return { columns: 0, rows: 0 }
  const columns = Math.ceil(Math.sqrt(count))
  return { columns, rows: Math.ceil(count / columns) }
}

/** 新 → 旧排好的版本 → 要摆的格子（含占位 / 「+N」）。 */
export function versionGridItems<T>(newestFirst: readonly T[], options: { pending?: boolean; showAll?: boolean } = {}): VersionGridItem<T>[] {
  const head: VersionGridItem<T>[] = options.pending ? [{ kind: 'pending' }] : []
  const room = VERSION_GRID_COLLAPSED_LIMIT - head.length
  if (options.showAll || newestFirst.length <= room) {
    return [...head, ...newestFirst.map((version): VersionGridItem<T> => ({ kind: 'version', version }))]
  }
  const shown = newestFirst.slice(0, room - 1)
  return [
    ...head,
    ...shown.map((version): VersionGridItem<T> => ({ kind: 'version', version })),
    { kind: 'more', hidden: newestFirst.slice(room - 1) },
  ]
}

export function layoutVersionGrid<T>(
  items: readonly VersionGridItem<T>[],
  node: Readonly<{ width: number; height: number }>,
  placement: VersionGridPlacement,
): VersionGridLayout<T> {
  const { columns, rows } = versionGridShape(items.length)
  const pitchX = node.width + VERSION_GRID_GAP
  const pitchY = node.height + VERSION_GRID_LABEL_SPACE + VERSION_GRID_GAP
  const cells = items.map((item, index): VersionGridCell<T> => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = placement === 'right'
      ? node.width + VERSION_GRID_NODE_GAP + column * pitchX
      : -VERSION_GRID_NODE_GAP - node.width - column * pitchX
    return { ...item, column, row, x, y: row * pitchY }
  })
  const width = columns === 0 ? 0 : columns * node.width + (columns - 1) * VERSION_GRID_GAP
  const height = rows === 0 ? 0 : rows * node.height + (rows - 1) * (VERSION_GRID_LABEL_SPACE + VERSION_GRID_GAP)
  const left = placement === 'right' ? node.width + VERSION_GRID_NODE_GAP : -VERSION_GRID_NODE_GAP - width
  return { cells, columns, rows, bounds: { x: left, y: 0, width, height } }
}

/**
 * 右边放得下就往右，放不下而左边放得下就往左，两边都放不下选空的多的那边。只看可见画布，
 * 不挪任何节点、不动视口（09-25 拍板）。单位都是屏幕像素。
 */
export function chooseVersionGridPlacement(input: { requiredWidth: number; rightSpace: number; leftSpace: number }): VersionGridPlacement {
  if (input.rightSpace >= input.requiredWidth) return 'right'
  if (input.leftSpace >= input.requiredWidth) return 'left'
  return input.rightSpace >= input.leftSpace ? 'right' : 'left'
}

type Rect = Readonly<{ x: number; y: number; width: number; height: number }>

/**
 * 被铺开的宫格压住的邻居，它的标题先藏起来（09-28 样张第 7 条：被压住的标题会从卡片缝里漏出来，
 * 读起来像是哪张版本卡的标题）。邻居的「标题条 + 卡身」和任何一格相交就算被压住。
 * 全在画布坐标里算。
 */
export function isNodeLabelCoveredByGrid(neighbour: Rect, gridOrigin: Readonly<{ x: number; y: number }>, cells: readonly Rect[], labelHeight = VERSION_GRID_LABEL_SPACE + 6): boolean {
  const label = { x: neighbour.x, y: neighbour.y - labelHeight, width: neighbour.width, height: labelHeight + neighbour.height }
  return cells.some((cell) => {
    const x = gridOrigin.x + cell.x
    const y = gridOrigin.y + cell.y
    return x < label.x + label.width && label.x < x + cell.width && y < label.y + label.height && label.y < y + cell.height
  })
}
