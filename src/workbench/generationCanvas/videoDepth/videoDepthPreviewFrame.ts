/**
 * 「提取深度」—— 把一张处理中的裸帧变成节点上能看的缩略图。
 *
 * 为什么要它：这条管线一跑就是分钟级，而「转圈 + 百分比」证明不了**它在看的是不是你那段片子**。
 * 一张实时的深度帧能同时回答两件事：还活着、而且认出了人。ComfyUI 那条链早就这么做了
 * （GeneratingOverlay 的 previewUrl），这里复用同一个位置，不另造一套过程反馈。
 *
 * 两条硬约束：
 * ① **不进画布 store、不落盘**。缩略图是会话瞬态，写进 node.meta 会被每次保存全量序列化
 *    （R17 的 base64-into-store 那一族）。它只进 `nodeLivePreviewStore`，终态即弃。
 * ② **不同步编码**。`canvas.toDataURL()` 编码期间整个界面冻住（R17 的 sync-image-encode）。
 *    这里走 `OffscreenCanvas.convertToBlob()` + objectURL，编码不占主线程，也没有 base64 字符串。
 */

/** 一张待预览的裸帧。形状与 worker 回传的 `rawFrames` 逐字对应（见 workerProtocol）。 */
export type VideoDepthPreviewSource = {
  /** 单通道灰度，一像素一字节（这条链只有这一种输出，见 videoDepth.ts 的 RAW_BYTES_PER_PIXEL）。 */
  bytes: Uint8Array
  width: number
  height: number
}

/** 缩略图的长边上限。节点预览区最宽也就三百多，再大只是白烧内存与编码时间。 */
export const VIDEO_DEPTH_PREVIEW_MAX_WIDTH = 192

/**
 * 裸帧 → RGBA（灰度铺成三通道）。纯函数，所以「有没有按行错位」能被单测钉住——
 * 这一族错在图上长得像「模型没跑对」（花屏 / 斜纹），而不是像「代码写错了」。
 *
 * 字节不够就**返回 null**，不补零：补零会画出一张下半截全黑的图，看起来正好像「深度图远处是黑的」。
 */
export function packVideoDepthPreviewRgba(source: VideoDepthPreviewSource): Uint8ClampedArray<ArrayBuffer> | null {
  const { bytes, width, height } = source
  if (width <= 0 || height <= 0) return null
  const pixels = width * height
  if (bytes.length < pixels) return null
  // 显式从一块 ArrayBuffer 起：`new Uint8ClampedArray(n)` 推出来的是 ArrayBufferLike，
  // 而 ImageData 只吃 ArrayBuffer 支撑的那一种（SharedArrayBuffer 不行）。
  const rgba = new Uint8ClampedArray(new ArrayBuffer(pixels * 4))
  for (let i = 0; i < pixels; i += 1) {
    const out = i * 4
    const value = bytes[i] as number
    rgba[out] = value
    rgba[out + 1] = value
    rgba[out + 2] = value
    rgba[out + 3] = 255
  }
  return rgba
}

/** 缩略图尺寸：只缩不放（源本来就比上限小的时候放大只会糊）。 */
export function videoDepthPreviewSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, VIDEO_DEPTH_PREVIEW_MAX_WIDTH / Math.max(1, width))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * 编码成一个 objectURL。**调用方负责 revoke**（换下一张、或运行结束时）——
 * 不 revoke 的 objectURL 会把整段视频的帧一张不落地留在内存里直到刷新页面。
 *
 * 浏览器能力缺席（测试壳 / 老 Electron）时安静返回 null：少一张缩略图不该让整条处理链失败。
 */
export async function encodeVideoDepthPreviewUrl(source: VideoDepthPreviewSource): Promise<string | null> {
  const rgba = packVideoDepthPreviewRgba(source)
  if (!rgba) return null
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') return null
  try {
    const bitmap = await createImageBitmap(new ImageData(rgba, source.width, source.height))
    const size = videoDepthPreviewSize(source.width, source.height)
    const canvas = new OffscreenCanvas(size.width, size.height)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, 0, 0, size.width, size.height)
    bitmap.close()
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.6 })
    return URL.createObjectURL(blob)
  } catch {
    return null
  }
}
