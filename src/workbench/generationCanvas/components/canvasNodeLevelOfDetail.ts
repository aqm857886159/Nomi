import type { GenerationNodeResult } from '../model/generationCanvasTypes'
import { canvasImageSourceOf, canvasVideoPosterOf, type CanvasImageSource } from '../nodes/canvasImageSource'

/**
 * 「这张卡画多细」的唯一 owner（2026-10-31 设计卡 docs/plan/2026-10-31-canvas-detail-admission.md）。
 *
 * 判据只有一个问题：**这张卡此刻看不看得清**。看得清（缩放 ≥ 门槛）就画整卡；看不清就画轻量卡（标题 + 结果预览图），
 * 除非用户正对它做事（唯一选中、画布外点名闪烁），或者这一种卡自己管远看（分镜表的远 / 中 / 近三档、剪辑卡的时间轴）。
 * **和画布上一共有几个节点无关。** 旧判据「节点 > 80 且缩放 < 0.55」答不出反馈现场那一屏：60 张图（不到 80）缩到 20%，
 * 每张卡只有 64 × 36 屏幕像素，却照样画整卡、挂整卡的合成层，弱显卡上瓦片装不下就整块不画。
 */
export const LIGHTWEIGHT_NODE_ZOOM_THRESHOLD = 0.40

export type LightweightNodePreview =
  | { kind: 'image'; src: CanvasImageSource }
  | { kind: 'video'; src: string }

/** 图片只取画布预览（canvasImageSource 唯一判定，原图只经被计数的缺失分支）；视频有封面挂封面，没有才挂视频。 */
export function resolveLightweightNodePreview(input: {
  result?: Pick<GenerationNodeResult, 'type' | 'url' | 'thumbnailUrl' | 'previewState'>
}): LightweightNodePreview | null {
  const result = input.result
  if (!result) return null
  if (result.type === 'image') {
    const src = canvasImageSourceOf(result)
    return src ? { kind: 'image', src } : null
  }
  if (result.type === 'video') {
    const poster = canvasVideoPosterOf(result)
    if (poster) return { kind: 'image', src: poster }
    const url = typeof result.url === 'string' ? result.url.trim() : ''
    return url ? { kind: 'video', src: url } : null
  }
  return null
}

/**
 * 订阅原语（2026-09-25 画布跟手）：节点外壳只订这一个布尔，缩放跨过门槛才重渲。
 *
 * 为什么是 0.40（2026-10-31 协调裁定，原 0.55）：A/B 显示缺块归零靠的是删 `will-change`；卡片变轻只在 20% 档省了瓦片（66→49MB）和每卡 DOM，
 * 35%、55% 档没差别——0.55 把小画布在 40–55% 丢掉视频悬停试播、导演台「打开」、场景信息条，什么也没换来，而这一带正是创作者看全局的常用缩放。
 * 40% 时 420 宽的卡屏上约 170px，试播和按钮还用得上；设备像素比 2 时 14px 的字约 11 物理像素，
 * 同口径 litegraph（最小可读字号 8px ÷ 14px，按设备像素比 √2 算）8 ÷ (14×√2) ≈ 0.404，门槛落在它的下面一点。
 */
export function isZoomedOutForLightweight(zoom: number): boolean {
  return zoom < LIGHTWEIGHT_NODE_ZOOM_THRESHOLD
}

/**
 * 画整卡还是轻量卡。四个输入都是「看不看得清 / 用户在不在对它做事」，没有节点数：
 *   · 没缩远 → 整卡；
 *   · 这一种卡自己管远看（registry 的 ownsZoomTiers：分镜表、剪辑卡）→ 整卡；
 *   · 唯一选中、画布外点名闪烁 → 整卡（用户正在对它做事）；
 *   · 其余 → 轻量卡。
 */
export function shouldRenderFullNodeContent(input: {
  zoomedOut: boolean
  ownsZoomTiers: boolean
  primarySelection: boolean
  focusFlash: boolean
}): boolean {
  return !input.zoomedOut || input.ownsZoomTiers || input.primarySelection || input.focusFlash
}
