import type { CropGridSize, CropRect } from './ImageCropGridOverlay'

/** 纯裁剪：1 行 1 列，没有内线。 */
export const CROP_ONLY: CropGridSize = { rows: 1, cols: 1 }

// 可调切图的纯几何：把「外框 rect + 框内分割线」换算成一组 image 归一化 cell。
// cols/rows 是「框内」切分分数（0~1，升序，长度 = gridSize-1；裁剪时为空）。
// 输出 cell 的 x/y/w/h 是「整图」归一化坐标，直接喂给 cropImageRegion。
// 裁剪 = 0 条线 = 1 个 cell（即外框本身）；这让裁剪与切图共用同一条确认路径（P1，不留两套）。

export type GridCell = {
  x: number
  y: number
  w: number
  h: number
  row: number
  column: number
}

function edges(start: number, span: number, cuts: number[]): number[] {
  const sorted = [...cuts].sort((a, b) => a - b)
  const result = [start]
  for (const cut of sorted) result.push(start + cut * span)
  result.push(start + span)
  return result
}

export type TileBox = { x: number; y: number; width: number; height: number }

/**
 * 把切图瓦片摆成行列对齐的紧凑方块（相对块原点 0,0，调用方再加 baseX/baseY）。
 *
 * 契约：**尺寸不由这里决定**——`sizes[i]` 必须是卡片**真正会渲染成的**宽高
 * （调用方拿 `resolveNodeVisualSize` 问壳要，见 useNodeImageEditing）。这里只负责排布：
 * 列宽取该列最宽、行高取该行最高，间距 gap，于是**任何两张卡都不会重叠**。
 *
 * 为什么把尺寸踢出去（2026-08-20 用户「布局很乱」的根因）：旧版自己按比例算格宽
 * （minTileWidth 默认 96），可壳把每张卡的宽度地板价钉在 MIN_NODE_WIDTH=240。
 * 于是 3×3 按 129px 的步距摆，卡片却各渲染成 240 宽——九张互相压掉 110px，
 * 看上去就是糊成一团。布局和渲染各算各的尺寸 = 必然错位；真相源只能有一个。
 */
export function computeSplitLayout(
  cells: GridCell[],
  sizes: readonly { width: number; height: number }[],
  options?: { gap?: number },
): TileBox[] {
  if (cells.length === 0) return []
  const gap = options?.gap ?? 16
  const colCount = Math.max(...cells.map((c) => c.column)) + 1
  const rowCount = Math.max(...cells.map((c) => c.row)) + 1
  const sizeAt = (index: number) => ({
    width: Math.max(1, Math.round(sizes[index]?.width || 0)),
    height: Math.max(1, Math.round(sizes[index]?.height || 0)),
  })
  const colWidths = Array.from({ length: colCount }, (_, c) =>
    Math.max(1, ...cells.map((cell, i) => (cell.column === c ? sizeAt(i).width : 0))))
  const rowHeights = Array.from({ length: rowCount }, (_, r) =>
    Math.max(1, ...cells.map((cell, i) => (cell.row === r ? sizeAt(i).height : 0))))
  const colX = colWidths.map((_, c) => colWidths.slice(0, c).reduce((sum, w) => sum + w + gap, 0))
  const rowY = rowHeights.map((_, r) => rowHeights.slice(0, r).reduce((sum, h) => sum + h + gap, 0))
  return cells.map((cell, i) => ({
    x: colX[cell.column],
    y: rowY[cell.row],
    width: sizeAt(i).width,
    height: sizeAt(i).height,
  }))
}

export function computeGridCells(rect: CropRect, cols: number[], rows: number[]): GridCell[] {
  const xEdges = edges(rect.x, rect.w, cols)
  const yEdges = edges(rect.y, rect.h, rows)
  const cells: GridCell[] = []
  for (let row = 0; row < yEdges.length - 1; row += 1) {
    for (let column = 0; column < xEdges.length - 1; column += 1) {
      cells.push({
        x: xEdges[column],
        y: yEdges[row],
        w: xEdges[column + 1] - xEdges[column],
        h: yEdges[row + 1] - yEdges[row],
        row,
        column,
      })
    }
  }
  return cells
}
