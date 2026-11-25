import { buildVideoPlaybackUrl } from './videoPlaybackUrl'

/**
 * 离屏测一个视频地址的真实时长（秒）。仿 assetImportAdapter.readBrowserImageDimensions：
 * 建一个不挂进 DOM 的 <video preload=metadata>，loadedmetadata 即拿 duration。
 * 失败 / 非有限值 / 超时 → null（调用方回退默认时长，绝不把坏地址挂死入轨链路）。
 *
 * 用途：拖入/上传的视频没有「生成参数时长」，clip 不能再钉死 5 秒——这里给出文件真实时长，
 * 写进 node.meta.videoDuration（buildClipFromGenerationNode 的时长真相键）。
 */
export type VideoMetadata = { durationSeconds: number | null; aspectRatio: number | undefined }

export function readVideoMetadata(url: string): Promise<VideoMetadata | null> {
  if (typeof document === 'undefined' || !url.trim()) return Promise.resolve(null)
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.crossOrigin = 'use-credentials'
    let settled = false
    const finish = (value: VideoMetadata | null) => {
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
      finish({
        durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
        aspectRatio: video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : undefined,
      })
    }
    video.onerror = () => finish(null)
    video.src = buildVideoPlaybackUrl(url)
  })
}

export async function readVideoDurationSeconds(url: string): Promise<number | null> {
  return (await readVideoMetadata(url))?.durationSeconds ?? null
}

/** Read the decoded image ratio without mounting a view or holding an insertion indefinitely. */
export function readImageAspectRatio(url: string): Promise<number | undefined> {
  if (typeof Image === 'undefined' || !url.trim()) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const image = new Image()
    const finish = (ratio?: number) => {
      clearTimeout(timer)
      image.onload = null
      image.onerror = null
      image.removeAttribute('src')
      resolve(ratio)
    }
    const timer = setTimeout(() => finish(), 8000)
    image.onload = () =>
      finish(image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : undefined)
    image.onerror = () => finish()
    image.src = url
  })
}
