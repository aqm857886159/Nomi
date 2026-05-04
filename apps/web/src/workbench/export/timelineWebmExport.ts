import type { TimelineClip, TimelineState } from '../timeline/timelineTypes'
import { computeTimelineDuration, resolveActiveClipsAtFrame } from '../timeline/timelineMath'
import type { PreviewAspectRatio } from '../workbenchTypes'
import { resolveVideoClipMediaTimeSeconds } from '../player/timelinePlayback'

export type ExportStatus = 'idle' | 'preparing' | 'recording' | 'done' | 'error'

export type TimelineExportProgress = {
  status: Exclude<ExportStatus, 'idle'>
  frame: number
  totalFrames: number
  ratio: number
}

export type TimelineWebmExportOptions = {
  timeline: TimelineState
  aspectRatio: PreviewAspectRatio
  width?: number
  background?: string
  mimeType?: string
  onProgress?: (progress: TimelineExportProgress) => void
}

type ExportCanvasSize = {
  width: number
  height: number
}

type TimelineAssetCache = {
  images: Map<string, HTMLImageElement>
  videos: Map<string, HTMLVideoElement>
}

type DrawTimelineFrameInput = {
  context: CanvasRenderingContext2D
  timeline: TimelineState
  frame: number
  size: ExportCanvasSize
  background: string
  assets: TimelineAssetCache
}

const RATIO_SIZE: Record<PreviewAspectRatio, { width: number; height: number }> = {
  '16:9': { width: 16, height: 9 },
  '9:16': { width: 9, height: 16 },
  '1:1': { width: 1, height: 1 },
  '4:5': { width: 4, height: 5 },
  '3:4': { width: 3, height: 4 },
  '4:3': { width: 4, height: 3 },
  '21:9': { width: 21, height: 9 },
}

const DEFAULT_EXPORT_WIDTH = 1280
const DEFAULT_EXPORT_BACKGROUND = '#f4f3ef'

export function resolveExportCanvasSize(aspectRatio: PreviewAspectRatio, width = DEFAULT_EXPORT_WIDTH): ExportCanvasSize {
  const ratio = RATIO_SIZE[aspectRatio]
  const nextWidth = Math.max(320, Math.floor(width))
  return {
    width: nextWidth,
    height: Math.max(1, Math.round((nextWidth * ratio.height) / ratio.width)),
  }
}

function hasMediaSource(clip: TimelineClip): clip is TimelineClip & { url: string } {
  return typeof clip.url === 'string' && clip.url.trim().length > 0
}

function selectClip(clips: TimelineClip[], type: TimelineClip['type']): TimelineClip | null {
  return clips.find((clip) => clip.type === type) || null
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`无法加载导出图片素材：${url}`))
    image.src = url
  })
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.className = 'workbench-export__video-source'
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.onloadedmetadata = () => resolve(video)
    video.onerror = () => reject(new Error(`无法加载导出视频素材：${url}`))
    video.src = url
    video.load()
  })
}

function waitForSeeked(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('error', handleError)
    }
    const handleSeeked = (): void => {
      cleanup()
      resolve()
    }
    const handleError = (): void => {
      cleanup()
      reject(new Error('视频素材 seek 失败'))
    }
    video.addEventListener('seeked', handleSeeked, { once: true })
    video.addEventListener('error', handleError, { once: true })
  })
}

async function seekVideoToTime(video: HTMLVideoElement, time: number): Promise<void> {
  const nextTime = Math.max(0, time)
  if (Number.isFinite(video.currentTime) && Math.abs(video.currentTime - nextTime) < 0.04) return
  const seekPromise = waitForSeeked(video)
  video.currentTime = nextTime
  await seekPromise
  if (typeof video.requestVideoFrameCallback === 'function') {
    await new Promise<void>((resolve) => {
      video.requestVideoFrameCallback(() => resolve())
    })
  }
}

async function preloadTimelineAssets(timeline: TimelineState): Promise<TimelineAssetCache> {
  const imageUrls = new Set<string>()
  const videoUrls = new Set<string>()

  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (!hasMediaSource(clip)) continue
      if (clip.type === 'image') imageUrls.add(clip.url)
      if (clip.type === 'video') videoUrls.add(clip.url)
    }
  }

  const images = new Map<string, HTMLImageElement>()
  const videos = new Map<string, HTMLVideoElement>()

  await Promise.all(Array.from(imageUrls, async (url) => {
    images.set(url, await loadImage(url))
  }))
  await Promise.all(Array.from(videoUrls, async (url) => {
    videos.set(url, await loadVideo(url))
  }))

  return { images, videos }
}

function drawCoverImage(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  size: ExportCanvasSize,
): void {
  if (sourceWidth <= 0 || sourceHeight <= 0) return
  const scale = Math.max(size.width / sourceWidth, size.height / sourceHeight)
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  const x = (size.width - width) / 2
  const y = (size.height - height) / 2
  context.drawImage(source, x, y, width, height)
}

function drawSubtitle(context: CanvasRenderingContext2D, text: string, size: ExportCanvasSize): void {
  const content = text.trim()
  if (!content) return
  const horizontalPadding = Math.round(size.width * 0.07)
  const bottom = Math.round(size.height * 0.08)
  const maxWidth = size.width - horizontalPadding * 2
  const fontSize = Math.max(22, Math.round(size.width * 0.035))
  context.font = `700 ${fontSize}px Inter, system-ui, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  const metrics = context.measureText(content)
  const boxWidth = Math.min(maxWidth, Math.max(Math.round(size.width * 0.32), metrics.width + 36))
  const boxHeight = Math.round(fontSize * 2.05)
  const x = (size.width - boxWidth) / 2
  const y = size.height - bottom - boxHeight

  context.fillStyle = 'rgba(255,255,255,0.84)'
  context.strokeStyle = 'rgba(29,29,31,0.1)'
  context.lineWidth = 1
  roundRect(context, x, y, boxWidth, boxHeight, 10)
  context.fill()
  context.stroke()

  context.fillStyle = '#1d1d1f'
  context.fillText(content, size.width / 2, y + boxHeight / 2, maxWidth)
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const nextRadius = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + nextRadius, y)
  context.arcTo(x + width, y, x + width, y + height, nextRadius)
  context.arcTo(x + width, y + height, x, y + height, nextRadius)
  context.arcTo(x, y + height, x, y, nextRadius)
  context.arcTo(x, y, x + width, y, nextRadius)
  context.closePath()
}

export function drawTimelineFrame(input: DrawTimelineFrameInput): void {
  const { context, timeline, frame, size, background, assets } = input
  const activeClips = resolveActiveClipsAtFrame(timeline, frame)
  const videoClip = selectClip(activeClips, 'video')
  const imageClip = selectClip(activeClips, 'image')

  context.clearRect(0, 0, size.width, size.height)
  context.fillStyle = background
  context.fillRect(0, 0, size.width, size.height)

  if (videoClip && hasMediaSource(videoClip)) {
    const video = assets.videos.get(videoClip.url)
    if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      drawCoverImage(context, video, video.videoWidth, video.videoHeight, size)
    }
  } else if (imageClip && hasMediaSource(imageClip)) {
    const image = assets.images.get(imageClip.url)
    if (image) drawCoverImage(context, image, image.naturalWidth, image.naturalHeight, size)
  }

}

function resolveRecorderMimeType(explicitMimeType?: string): string | undefined {
  if (explicitMimeType) {
    if (!MediaRecorder.isTypeSupported(explicitMimeType)) {
      throw new Error(`当前浏览器不支持导出格式：${explicitMimeType}`)
    }
    return explicitMimeType
  }
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate))
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.className = 'workbench-export__download-link'
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export async function exportTimelineToWebm(options: TimelineWebmExportOptions): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('导出只能在浏览器环境执行')
  if (typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不支持 MediaRecorder，无法导出 WebM')

  const durationFrame = computeTimelineDuration(options.timeline)
  if (durationFrame <= 0) throw new Error('时间轴为空，无法导出')

  const size = resolveExportCanvasSize(options.aspectRatio, options.width)
  options.onProgress?.({ status: 'preparing', frame: 0, totalFrames: durationFrame, ratio: 0 })
  const assets = await preloadTimelineAssets(options.timeline)
  const canvas = document.createElement('canvas')
  canvas.className = 'workbench-export__canvas'
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建导出画布')

  const stream = canvas.captureStream(options.timeline.fps)
  const mimeType = resolveRecorderMimeType(options.mimeType)
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
  const chunks: BlobPart[] = []

  const recording = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onerror = () => reject(new Error('导出录制失败'))
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }))
    }
  })

  for (const video of assets.videos.values()) {
    video.currentTime = 0
  }
  recorder.start()
  options.onProgress?.({ status: 'recording', frame: 0, totalFrames: durationFrame, ratio: 0 })

  try {
    await new Promise<void>((resolve, reject) => {
      let frame = 0
      const tick = async (): Promise<void> => {
        try {
          const activeClips = resolveActiveClipsAtFrame(options.timeline, frame)
          const videoClip = selectClip(activeClips, 'video')
          if (videoClip && hasMediaSource(videoClip)) {
            const video = assets.videos.get(videoClip.url)
            if (video) {
              const nextTime = resolveVideoClipMediaTimeSeconds({ clip: videoClip, playheadFrame: frame, fps: options.timeline.fps })
              await seekVideoToTime(video, nextTime)
            }
          }
          drawTimelineFrame({
            context,
            timeline: options.timeline,
            frame,
            size,
            background: options.background || DEFAULT_EXPORT_BACKGROUND,
            assets,
          })
          options.onProgress?.({
            status: 'recording',
            frame,
            totalFrames: durationFrame,
            ratio: Math.min(1, frame / durationFrame),
          })
          if (frame >= durationFrame - 1) {
            resolve()
            return
          }
          frame += 1
          window.requestAnimationFrame(tick)
        } catch (error) {
          reject(error)
        }
      }
      window.requestAnimationFrame(tick)
    })
  } catch (error) {
    if (recorder.state !== 'inactive') recorder.stop()
    for (const video of assets.videos.values()) {
      video.pause()
    }
    throw error
  }

  recorder.stop()
  for (const video of assets.videos.values()) {
    video.pause()
  }
  const blob = await recording
  if (blob.size <= 0) throw new Error('导出结果为空')
  options.onProgress?.({ status: 'done', frame: durationFrame, totalFrames: durationFrame, ratio: 1 })
  downloadBlob(blob, `nomi-export-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`)
  return blob
}
