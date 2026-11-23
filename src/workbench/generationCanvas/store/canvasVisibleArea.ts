import { useWorkbenchStore } from '../../workbenchStore'
import { composerInitialFootprint } from '../nodes/composerCanvasPlacement'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import { CANVAS_FOCUS_PADDING } from '../reactFlow/focusViewportRecovery'

/**
 * 「用户此刻在画布上看得见哪一块」——新东西该落在哪、落下后要不要在边缘提示，都读这一份（2026-09-25）。
 *
 * 用户拍板：程序不再主动平移 / 缩放画布；新建和导入尽量直接落在当前可见区域，落不下就在边缘提示。
 * 所以落点不能再是写死的画布坐标（以前 addNode 默认 (120, 360)、素材库上传 (120, 90)、空态新建 (240, 240)
 * ——视口一挪开，新东西就落在屏外，再靠「落地后把画布挪过去」补救，那一挪就是用户说的「闪一下找不到」）。
 *
 * 三个输入各有唯一来源：
 *   - 舞台尺寸 + 空地：画布宿主量到的真实尺寸（`useGenerationCanvasReactFlowHostEffects` 的 ResizeObserver），经
 *     `publishCanvasStageSize` 发布到这里——store 层的 addNode 够不到 React 组件，只能读这份发布值。
 *     「空地」= 舞台扣掉底部停靠条（`data-canvas-bottom-dock`）和浮层后最大的一块，与对焦用的是同一个
 *     `resolveFreeViewRect`（2026-11-15：以前新建把整个舞台当可见区，下沿其实被加节点条等盖着，节点的底栏就落到它们后面）；
 *   - 视口：`workbenchStore.categoryViewports[分类]`（按分类记忆，用户移动结束时写）。
 * 画布从没挂载过（例如一直在「创作」页）时舞台尺寸是 0，没有「可见区」可言，返回 null 由调用方用它自己的布局。
 */
type Size = { width: number; height: number }
export type CanvasRect = { x: number; y: number; width: number; height: number }
/** 舞台坐标系（左上角 = 舞台左上角）里的一块屏幕矩形。 */
export type StageRect = { left: number; top: number; width: number; height: number }
type PublishedView = { stage: Size; free: StageRect }

let published: PublishedView = { stage: { width: 0, height: 0 }, free: { left: 0, top: 0, width: 0, height: 0 } }

/**
 * 量到 0×0（画布被藏在「创作」页、切页重挂那一帧）不覆盖：那时用户回到画布看到的仍是上一次那么大的一块，
 * Agent 在别的页替他建的卡照样该落进那一块里。
 */
export function publishCanvasStageSize(stage: Size, free: StageRect): void {
  if (!(stage.width > 0 && stage.height > 0)) return
  published = { stage: { width: stage.width, height: stage.height }, free: { ...free } }
}

function viewportFor(categoryId: string): { zoom: number; offset: { x: number; y: number } } {
  const stored = useWorkbenchStore.getState().categoryViewports[categoryId]
  return stored && Number.isFinite(stored.zoom) && stored.zoom > 0 ? stored : { zoom: 1, offset: { x: 0, y: 0 } }
}

function toCanvas(categoryId: string, screen: StageRect): CanvasRect {
  const { zoom, offset } = viewportFor(categoryId)
  return { x: (screen.left - offset.x) / zoom, y: (screen.top - offset.y) / zoom, width: screen.width / zoom, height: screen.height / zoom }
}

/** 某分类此刻（或上次离开时）看得见且没被停靠条 / 浮层盖住的那块画布矩形（空地），画布坐标。舞台未知时 null。 */
export function visibleCanvasRect(categoryId: string, view: PublishedView = published): CanvasRect | null {
  if (!(view.stage.width > 0 && view.stage.height > 0 && view.free.width > 0 && view.free.height > 0)) return null
  return toCanvas(categoryId, view.free)
}

const intersects = (a: CanvasRect, b: CanvasRect, gap: number): boolean =>
  a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y

/**
 * 一整块批量落点（Agent 一次建好几张卡、导入一批素材）尽量整体搬进空地：块的左上角对到空地左上
 * 留一点边，前提是整块装得下、且不压到这个分类里已有的任何节点。装不下或会压到 → 原样返回
 * （落在已有内容下方，由画布边缘提示告诉用户在哪，不去挪用户的视口）。
 * 块内相对位置一格不动：批量布局（参考行在上、镜头折行）是有意义的排法。
 */
export function placeBlockInVisibleArea(
  categoryId: string,
  items: readonly CanvasRect[],
  occupied: readonly CanvasRect[],
  view: PublishedView = published,
): { x: number; y: number }[] {
  const original = items.map((item) => ({ x: item.x, y: item.y }))
  const area = visibleCanvasRect(categoryId, view)
  if (!area || items.length === 0) return original
  const left = Math.min(...items.map((item) => item.x))
  const top = Math.min(...items.map((item) => item.y))
  const width = Math.max(...items.map((item) => item.x + item.width)) - left
  const height = Math.max(...items.map((item) => item.y + item.height)) - top
  const margin = { x: area.width * 0.06, y: area.height * 0.08 }
  if (width > area.width - margin.x * 2 || height > area.height - margin.y * 2) return original
  const dx = area.x + margin.x - left
  const dy = area.y + margin.y - top
  const moved = items.map((item) => ({ ...item, x: item.x + dx, y: item.y + dy }))
  if (moved.some((item) => occupied.some((rect) => intersects(item, rect, 24)))) return original
  return moved.map((item) => ({ x: item.x, y: item.y }))
}

/**
 * 新东西的落点。横向：舞台宽 38%（与工具条新建一直以来的落点同一个比例）。竖向：「今天的比例落点」（舞台高 28%）
 * 只往上提，提到「节点真实渲染高 + 间距 + 底栏刚建出来时的高度」整块的下沿不超过空地下沿减留边；整块比空地还高就让节点顶贴空地上沿留边：
 *   y = max(空地上沿 + 留边, min(比例落点, 空地下沿 − 留边 − 整块高))
 * 节点高读节点真实视觉尺寸（`resolveNodeVisualSize(node).height`，由 addNode 先造出节点再传进来）：
 * 不再借碰撞避让用的渲染足迹（+NODE_RENDER_SAFETY 64px）估算——那 64px 是避让间距，算进落点会无故把节点往上推 64px。
 * 一条算式管所有种类：不带底栏的种类整块高 = 节点视觉高，装得下就不变。底栏占多高只取 `composerInitialFootprint`
 * （只留刚建出来那一刻的高度，不留对焦用的最坏高度），留边与对焦同源（`CANVAS_FOCUS_PADDING`）；不量 DOM、不挪视口。舞台未知时 null。
 */
export type InsertionSizedNode = Parameters<typeof resolveNodeVisualSize>[0]

export function visibleInsertionPoint(
  categoryId: string,
  node?: InsertionSizedNode,
  view: PublishedView = published,
): { x: number; y: number } | null {
  const area = visibleCanvasRect(categoryId, view)
  if (!area) return null
  const { zoom } = viewportFor(categoryId)
  const stageRect = toCanvas(categoryId, { left: 0, top: 0, width: view.stage.width, height: view.stage.height })
  const proportional = { x: stageRect.x + stageRect.width * 0.38, y: stageRect.y + stageRect.height * 0.28 }
  const composer = node ? composerInitialFootprint(node.kind) : null
  const nodeHeight = node ? resolveNodeVisualSize(node).height : 0
  const blockHeight = nodeHeight + (composer ? composer.gap + composer.height / zoom : 0)
  const pad = CANVAS_FOCUS_PADDING / zoom
  const y = Math.max(area.y + pad, Math.min(proportional.y, area.y + area.height - pad - blockHeight))
  return { x: proportional.x, y }
}
