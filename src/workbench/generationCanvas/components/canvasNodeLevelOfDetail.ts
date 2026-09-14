import type { GenerationNodeResult } from '../model/generationCanvasTypes'
import { MIN_NODE_WIDTH } from '../nodes/nodeSizing'

/**
 * 卡片自己认的最小可读缩放：低于它，元数据行（NodeLabelRow）直接不画。
 * 单一 owner 住在这里，`nodes/NodeLabelRow.tsx` 引用它，不许两边各写一个 0.4。
 */
export const NODE_LABEL_ROW_MIN_ZOOM = 0.4

/**
 * 全套 chrome 的「屏上最小宽度」（px）。
 *
 * 判据是**这张卡在屏幕上有多大**，不是「画布上一共有几个节点」。旧判据
 * （`nodeCount > 80 && zoom < 0.55`）答不出创始人那一格：60 张图（不到 80）在
 * 适应视图后的缩放 0.217 上，每张 340 宽的卡只占约 74 屏幕像素，却仍在渲染全套
 * chrome（调研 `docs/research/2026-09-12-canvas-perf-at-scale/README.md` §1.5 / §5 S5）。
 *
 * 这个数从卡片自己的布局断点来，不是拍脑袋：`MIN_NODE_WIDTH = 240`
 * （`nodes/nodeSizing.ts`）是 `getNodeSizeBounds` 交给 `NodeResizer` 的下钳位，
 * 也就是**全套 chrome 被授权布局过的最窄宽度**——比它更窄的卡片布局从来没存在过。
 * 于是：卡片在屏幕上比 240 px 还窄时，全套 chrome 正画在一个从来没被设计过的尺寸里，
 * 换轻量档。对 340 宽的图片卡，这等价于缩放低于 0.706；旧判据的 0.55 落在里面，
 * 既有门岗 `low-zoom-preview`（0.45）与 `drag-at-low-zoom`（0.45）的语义一并保住。
 *
 * 对齐 tldraw 的 `steppedScreenScale`（<https://tldraw.dev/sdk-features/performance>）：
 * 屏上多大就画多细。
 */
export const FULL_CHROME_MIN_SCREEN_WIDTH_PX = MIN_NODE_WIDTH

/**
 * 二级闸：一次同时操作多少张卡。
 *
 * 成本随「同时在动几张」长，不随「画布上一共有几张」长——调研 §2.5① 那张表里，
 * 「在动 = 1 个」那一行从 60 到 300 个节点是平的（120 / 120 / 108 fps），
 * 「在动 = 全部」那一行塌到 96.5 / 42.1 / 12.4。同一张表给出拐点：**同时在动 50 张**
 * 时三档仍是 118.8 / 94.5 / 88.6 fps（平的），到 150 张才塌。所以 50 是实测的平台期上界，
 * 不是拍的数。超过它，选区里除主选卡外一律走轻量档。
 */
export const CONCURRENT_FULL_CHROME_LIMIT = 50

export type LightweightNodePreview = {
  kind: 'image' | 'video'
  src: string
}

export function resolveLightweightNodePreview(input: {
  result?: Pick<GenerationNodeResult, 'type' | 'url' | 'thumbnailUrl'>
}): LightweightNodePreview | null {
  const result = input.result
  if (!result) return null
  const thumbnailUrl = typeof result.thumbnailUrl === 'string' ? result.thumbnailUrl.trim() : ''
  const url = typeof result.url === 'string' ? result.url.trim() : ''
  if (result.type === 'image') {
    const src = thumbnailUrl || url
    return src ? { kind: 'image', src } : null
  }
  if (result.type === 'video') {
    if (thumbnailUrl) return { kind: 'image', src: thumbnailUrl }
    return url ? { kind: 'video', src: url } : null
  }
  return null
}

/**
 * 轻量档只画「标签行 + 结果媒体缩略图」。没有结果媒体的卡（文本、分镜表、未生成…）
 * 在轻量档里只剩一个灰盒子——那不是「远景简化」，那是「卡片没了」。
 * 所以轻量档的准入条件是**这张卡有东西可画**；没有就维持完整渲染。
 */
export function isLightweightRenderable(input: {
  result?: Pick<GenerationNodeResult, 'type' | 'url' | 'thumbnailUrl'>
}): boolean {
  return resolveLightweightNodePreview(input) !== null
}

/**
 * 主判据：这张卡在屏幕上占多宽。
 *
 * 门槛取「这张卡的 chrome 被布局过的最窄宽度」：可缩放卡是 NodeResizer 的下钳位 240；
 * 固定宽度的卡（角色/道具卡 200、场景卡 320…）的 chrome 是按它自己的宽度设计的，比 240 窄不等于「没设计过」，
 * 所以门槛是 `min(cardWidth, 240)`——任何卡在 zoom ≥ 1（屏上不比设计宽度窄）时都不会进轻量档。
 */
export function shouldUseLightweightNodeRendering(input: { cardWidth: number; zoom: number }): boolean {
  return input.cardWidth * input.zoom < Math.min(input.cardWidth, FULL_CHROME_MIN_SCREEN_WIDTH_PX)
}

export function shouldUseLightweightNodeRenderingForSelection(input: {
  cardWidth: number
  zoom: number
  selectedCount: number
  selected: boolean
  primarySelection: boolean
}): boolean {
  return shouldUseLightweightNodeRendering(input)
    || (input.selectedCount > CONCURRENT_FULL_CHROME_LIMIT && input.selected && !input.primarySelection)
}

export function retainLargeCanvasLightweightRendering(input: {
  retained: boolean
  selectedCount: number
  selected: boolean
  primarySelection: boolean
}): boolean {
  if (input.selectedCount <= CONCURRENT_FULL_CHROME_LIMIT || input.primarySelection) return false
  return input.retained || input.selected
}

export function shouldRenderFullNodeContent(input: {
  lightweightMode: boolean
  selected: boolean
  focusFlash: boolean
}): boolean {
  if (!input.lightweightMode) return true
  return input.selected || input.focusFlash
}

/**
 * 缩放/拖动手柄要不要挂。
 *
 * 这条是 2026-09-12 实测出来的最大一笔：`NodeResizer` 对**每个 selected 节点**都挂一整套
 * 八向控制点（`GenerationCanvasReactFlowNodes.tsx` 里 `isVisible={selected}`），全选 300 张卡后
 * 拖动，每一帧都要重建 300 套。I300 `drag-nodes-all` 上把它在轻量档关掉：长任务 249 → 3、
 * fps 37.7 → 58.2（详见 `docs/plan/2026-09-12-canvas-lod-screen-size.md` 的实测表）。
 *
 * 它也是同一条 LOD 判据的自然结论：手柄本体 16 px（同文件 `handleStyle`），卡片进轻量档时
 * 屏上不足 16 × 240/340 ≈ 11 px，已经小于卡片自己都不画的元数据行高度
 * （`h-7` = 28 px × `NODE_LABEL_ROW_MIN_ZOOM` = 11.2 px）——点不中的东西不必画。
 */
export function shouldRenderNodeResizeAffordance(input: {
  lightweightMode: boolean
  readOnly: boolean
  selected: boolean
}): boolean {
  return input.selected && !input.readOnly && !input.lightweightMode
}

/**
 * 连线把手要不要挂。
 *
 * 同一条 LOD 判据的第二个消费者，也是本刀第二大的一笔：每张卡挂 4 个 React Flow `Handle`，
 * 每个 `Handle` 自带一条 store 订阅，300 张卡 = 每次 pointermove 跑 1200 条选择器并**强制布局**。
 * I300 `drag-nodes-all` 上把轻量档的把手摘掉：布局次数 250 → 2、长任务 28 → 1
 * （实测表见 `docs/plan/2026-09-12-canvas-lod-screen-size.md`）。
 *
 * **但把手不是装饰，是功能**：连线手势要靠目标卡上的把手落点。所以判据不是「轻量档就没有」，
 * 而是「轻量档 + 当前没有任何连线手势在进行」——一旦有人开始拉线（React Flow 自己的
 * `connection.inProgress`，或我们的批量连线 `pendingConnectionSourceId`），
 * 全部卡片立刻把把手挂回来。省的是「拖节点那 250 帧」，不省任何一次真实连线。
 */
export function shouldRenderNodeConnectionHandles(input: {
  lightweightMode: boolean
  readOnly: boolean
  connectionInProgress: boolean
}): boolean {
  if (input.readOnly) return false
  return !input.lightweightMode || input.connectionInProgress
}
