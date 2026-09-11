/**
 * 画布缩放的**唯一真相**，以及「抵消缩放、保持恒定屏幕尺寸」这一件事的唯一实现。
 *
 * 背景（2026-09-11 迁移等价审计 §③ 行 2 / 行 7）：
 * React Flow 迁移前，`components/useCanvasTransformStoreSync.ts` 每帧把视口写回
 * `generationCanvasStore.canvasZoom / canvasOffset`，卡内组件读它换算屏幕像素 ↔ 画布单位。
 * 迁移把那个写入方删了、读的人留着，于是 `canvasZoom` **恒等于 1**：
 * 剪辑节点内嵌时间轴在任何非 100% 缩放下拖/裁片段的位移都算错（50% 时只走一半），
 * 分镜表的密度档恒停在 `full`，批量计划徽标恒画在 `pos*1 + 0`。
 *
 * 修法不是把那个 setter 接回去（那等于在 React Flow 的 transform 之外再养一份真相），
 * 而是**认 React Flow 的 `transform` 为唯一真相**，读的人直接问它。
 * store 里那两个字段连同它们的 setter 已在同一提交删除。
 *
 * 订阅粒度（`docs/plan/2026-09-01-canvas-drag-perf-eval-v2.md` 的细粒度 selector 原则）：
 * 只选 `transform[2]`（缩放）这一个标量——**平移不会改它**，所以拖画布时这些节点一帧都不重渲；
 * 只有真的缩放了才重渲，而那时它们本来就必须重算。需要连平移一起跟的消费者用框架自带的
 * `useViewport()`（它按 x/y/zoom 三个标量浅比较），别在这里再抄一份。
 *
 * 注意：这些 hook 依赖 `ReactFlowProvider`。设计实验室里独立挂载的节点样张**不在**画布里、
 * 也就没有画布缩放；那种宿主请走各自的「无视口」分支（见 `shotTableDensityForZoom` 的调用点）。
 */
import { useStore } from '@xyflow/react'

/** React Flow 内部 transform 的形状：`[offsetX, offsetY, zoom]`。 */
type FlowTransformState = { transform: readonly [number, number, number] }

/** 从 React Flow store 里取缩放。抽成具名函数是为了能在单测里不起 React 就断言这条链路。 */
export function selectFlowZoom(state: FlowTransformState): number {
  const zoom = state.transform[2]
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1
}

/** 画布当前缩放（唯一真相 = React Flow 的 transform[2]）。只在 `ReactFlowProvider` 内可用。 */
export function useCanvasLiveZoom(): number {
  return useStore(selectFlowZoom)
}

/**
 * 抵消视口缩放所需的比例：贴在跟着视口一起缩放的浮层上，它就不随缩放变大变小。
 *
 * 屏幕空间里摆放的画布 chrome（多选浮条）走的是另一条路——
 * `selectionToolbarPlacement.ts` 把画布坐标换算成屏幕坐标后渲染在视口**外**，天生恒定尺寸。
 * 这里管的是渲染在视口**内**、必须显式反缩放的那一类（边标签）。两条路各自只有一份实现。
 */
export function inverseViewportScale(zoom: number): number {
  return 1 / (Number.isFinite(zoom) && zoom > 0 ? zoom : 1)
}

/**
 * 边标签的 transform：落在贝塞尔中点、居中对齐、并反缩放回恒定屏幕尺寸。
 *
 * 顺序要紧：`translate(-50%,-50%)` 与 `translate(x,y)` 与原点无关，
 * `scale()` 按默认 `transform-origin: 50% 50%`（元素自身中心）作用——
 * 于是元素先绕自己中心缩放，中心再落到 (x, y)。
 * 迁移前旧边层（`components/` 下那个已删的自绘 SVG 边渲染器，`8f9365aeb:…:63,176`）用的就是这条（`scale(1/zoom)`）。
 */
export function edgeLabelTransform(labelX: number, labelY: number, zoom: number): string {
  return `translate(-50%, -50%) translate(${labelX}px, ${labelY}px) scale(${inverseViewportScale(zoom)})`
}

export type ShotTableZoomDensity = 'full' | 'compact' | 'card'

/**
 * 分镜表按缩放分档（订阅的是**档位**不是每一帧的缩放值，所以缩放穿过一档才重渲一次）。
 * 没有画布视口的宿主（设计实验室样张）没有缩放可言，按 1 算 = `full`。
 */
export function shotTableDensityForZoom(zoom: number): ShotTableZoomDensity {
  if (zoom >= 0.8) return 'full'
  if (zoom >= 0.4) return 'compact'
  return 'card'
}
