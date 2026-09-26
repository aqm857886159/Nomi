import { useWorkbenchStore } from '../../workbenchStore'

/**
 * 「用户此刻在画布上看得见哪一块」——新东西该落在哪、落下后要不要在边缘提示，都读这一份（2026-09-25）。
 *
 * 用户拍板：程序不再主动平移 / 缩放画布；新建和导入尽量直接落在当前可见区域，落不下就在边缘提示。
 * 所以落点不能再是写死的画布坐标（以前 addNode 默认 (120, 360)、素材库上传 (120, 90)、空态新建 (240, 240)
 * ——视口一挪开，新东西就落在屏外，再靠「落地后把画布挪过去」补救，那一挪就是用户说的「闪一下找不到」）。
 *
 * 两个输入各有唯一来源：
 *   - 舞台尺寸：画布宿主量到的真实尺寸（`useGenerationCanvasReactFlowHostEffects` 的 ResizeObserver），经
 *     `publishCanvasStageSize` 发布到这里——store 层的 addNode 够不到 React 组件，只能读这份发布值；
 *   - 视口：`workbenchStore.categoryViewports[分类]`（按分类记忆，用户移动结束时写）。
 * 画布从没挂载过（例如一直在「创作」页）时舞台尺寸是 0，没有「可见区」可言，返回 null 由调用方用它自己的布局。
 */
type Size = { width: number; height: number }
export type CanvasRect = { x: number; y: number; width: number; height: number }

let publishedStage: Size = { width: 0, height: 0 }

/**
 * 量到 0×0（画布被藏在「创作」页、切页重挂那一帧）不覆盖：那时用户回到画布看到的仍是上一次那么大的一块，
 * Agent 在别的页替他建的卡照样该落进那一块里。
 */
export function publishCanvasStageSize(size: Size): void {
  if (!(size.width > 0 && size.height > 0)) return
  publishedStage = { width: size.width, height: size.height }
}

function viewportFor(categoryId: string): { zoom: number; offset: { x: number; y: number } } {
  const stored = useWorkbenchStore.getState().categoryViewports[categoryId]
  return stored && Number.isFinite(stored.zoom) && stored.zoom > 0 ? stored : { zoom: 1, offset: { x: 0, y: 0 } }
}

/** 某分类此刻（或上次离开时）看得见的那块画布矩形，画布坐标。舞台未知时 null。 */
export function visibleCanvasRect(categoryId: string, stage: Size = publishedStage): CanvasRect | null {
  if (!(stage.width > 0 && stage.height > 0)) return null
  const { zoom, offset } = viewportFor(categoryId)
  return { x: -offset.x / zoom, y: -offset.y / zoom, width: stage.width / zoom, height: stage.height / zoom }
}

const intersects = (a: CanvasRect, b: CanvasRect, gap: number): boolean =>
  a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y

/**
 * 一整块批量落点（Agent 一次建好几张卡、导入一批素材）尽量整体搬进可见区：块的左上角对到可见区左上
 * 留一点边，前提是整块装得下、且不压到这个分类里已有的任何节点。装不下或会压到 → 原样返回
 * （落在已有内容下方，由画布边缘提示告诉用户在哪，不去挪用户的视口）。
 * 块内相对位置一格不动：批量布局（参考行在上、镜头折行）是有意义的排法。
 */
export function placeBlockInVisibleArea(
  categoryId: string,
  items: readonly CanvasRect[],
  occupied: readonly CanvasRect[],
  stage: Size = publishedStage,
): { x: number; y: number }[] {
  const original = items.map((item) => ({ x: item.x, y: item.y }))
  const view = visibleCanvasRect(categoryId, stage)
  if (!view || items.length === 0) return original
  const left = Math.min(...items.map((item) => item.x))
  const top = Math.min(...items.map((item) => item.y))
  const width = Math.max(...items.map((item) => item.x + item.width)) - left
  const height = Math.max(...items.map((item) => item.y + item.height)) - top
  const margin = { x: view.width * 0.06, y: view.height * 0.08 }
  if (width > view.width - margin.x * 2 || height > view.height - margin.y * 2) return original
  const dx = view.x + margin.x - left
  const dy = view.y + margin.y - top
  const moved = items.map((item) => ({ ...item, x: item.x + dx, y: item.y + dy }))
  if (moved.some((item) => occupied.some((rect) => intersects(item, rect, 24)))) return original
  return moved.map((item) => ({ x: item.x, y: item.y }))
}

/**
 * 新东西的落点：可见区里偏左上的那一点（舞台宽 38%、高 28%，与工具条新建一直以来的落点同一个比例——
 * 左上留给节点本身往右下展开，节点中心大致落在屏幕中部）。舞台未知时 null。
 */
export function visibleInsertionPoint(categoryId: string, stage: Size = publishedStage): { x: number; y: number } | null {
  const rect = visibleCanvasRect(categoryId, stage)
  if (!rect) return null
  return { x: rect.x + rect.width * 0.38, y: rect.y + rect.height * 0.28 }
}
