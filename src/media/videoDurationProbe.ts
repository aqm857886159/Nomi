import { buildVideoPlaybackUrl } from './videoPlaybackUrl'

/**
 * 离屏测一个视频地址的真实时长（秒）。仿 assetImportAdapter.readBrowserImageDimensions：
 * 建一个不挂进 DOM 的 <video preload=metadata>，loadedmetadata 即拿 duration。
 * 失败 / 非有限值 / 超时 → null（调用方回退默认时长，绝不把坏地址挂死入轨链路）。
 *
 * 用途：拖入/上传的视频没有「生成参数时长」，clip 不能再钉死 5 秒——这里给出文件真实时长，
 * 写进 node.meta.videoDuration（buildClipFromGenerationNode 的时长真相键）。
 */
export function readVideoDurationSeconds(url: string): Promise<number | null> {
  if (typeof document === 'undefined' || !url.trim()) return Promise.resolve(null)
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.crossOrigin = 'use-credentials'
    let settled = false
    const finish = (value: number | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      resolve(value)
    }
    const timer = window.setTimeout(() => finish(null), 8000)
    video.onloadedmetadata = () => {
      const duration = video.duration
      finish(Number.isFinite(duration) && duration > 0 ? duration : null)
    }
    video.onerror = () => finish(null)
    video.src = buildVideoPlaybackUrl(url)
  })
}
