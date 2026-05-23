import { getDesktopActiveProjectId } from '../../desktop/activeProject'
import { getDesktopBridge } from '../../desktop/bridge'
import type { DesktopMp4ExportResult } from '../../desktop/bridge'
import type { TimelineState } from '../timeline/timelineTypes'
import type { PreviewAspectRatio } from '../workbenchTypes'
import { createTimelineExportFilename, downloadTimelineBlob, exportTimelineToWebm } from './timelineWebmExport'
import type { ExportQuality } from './exportTypes'
import { buildRenderManifestRequest } from './renderManifest'

const MP4_WEBM_IPC_CHUNK_BYTES = 1024 * 1024

function dimensionsForExport(resolution: '720p' | '1080p', aspectRatio: PreviewAspectRatio): { width: number; height: number } {
  const base = resolution === '720p' ? 720 : 1080
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2)
  const ratios: Record<PreviewAspectRatio, number> = {
    '16:9': 16 / 9,
    '9:16': 9 / 16,
    '1:1': 1,
    '4:5': 4 / 5,
    '3:4': 3 / 4,
    '4:3': 4 / 3,
    '21:9': 21 / 9,
  }
  const ratio = ratios[aspectRatio] || ratios['16:9']
  if (aspectRatio === '16:9') return resolution === '720p' ? { width: 1280, height: 720 } : { width: 1920, height: 1080 }
  if (ratio >= 1) return { width: even(base * ratio), height: even(base) }
  return { width: even(base), height: even(base / ratio) }
}

export type ExportTimelineToMp4Options = {
  timeline: TimelineState
  aspectRatio: PreviewAspectRatio
  projectId?: string
  outputName?: string
  resolution?: '720p' | '1080p'
  quality?: ExportQuality
  onProgress?: (progress: { status: 'preparing' | 'recording' | 'converting' | 'done'; ratio: number }) => void
}

export type StartTimelineMp4ExportJobOptions = Omit<ExportTimelineToMp4Options, 'onProgress'>

export async function startTimelineMp4ExportJob(options: StartTimelineMp4ExportJobOptions): Promise<{ jobId: string }> {
  const desktop = getDesktopBridge()
  if (!desktop?.exports?.startJob) {
    throw new Error('导出任务需要 Electron 桌面运行时')
  }
  const projectId = (options.projectId || getDesktopActiveProjectId()).trim()
  if (!projectId) throw new Error('导出失败：缺少项目 ID')

  const manifest = buildRenderManifestRequest({
    projectId,
    timeline: options.timeline,
    aspectRatio: options.aspectRatio,
    resolution: options.resolution || '1080p',
    quality: options.quality || 'standard',
    preset: 'publish',
  })

  return desktop.exports.startJob({
    projectId,
    manifest,
    outputName: options.outputName,
  })
}

export async function exportTimelineToMp4(options: ExportTimelineToMp4Options): Promise<DesktopMp4ExportResult> {
  const desktop = getDesktopBridge()
  if (!desktop?.exports?.startJob || !desktop.exports.writeTempInput || !desktop.exports.finishTempInput) {
    throw new Error('导出 MP4 需要 Electron 桌面运行时')
  }
  const projectId = (options.projectId || getDesktopActiveProjectId()).trim()
  if (!projectId) throw new Error('导出失败：缺少项目 ID')
  const resolution = options.resolution || '1080p'
  const quality = options.quality || 'standard'
  const fps = options.timeline.fps || 30
  const durationFrames = Math.max(0, options.timeline.durationFrames || 0)
  const dimensions = dimensionsForExport(resolution, options.aspectRatio)
  const { jobId } = await desktop.exports.startJob({
    projectId,
    outputName: options.outputName,
    manifest: {
      version: 1,
      projectId,
      createdAt: new Date().toISOString(),
      timeline: {
        fps,
        durationFrames,
        range: { startFrame: 0, endFrame: durationFrames },
        tracks: [],
      },
      profile: {
        preset: 'publish',
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: dimensions.width,
        height: dimensions.height,
        fps,
        pixelFormat: 'yuv420p',
        quality,
      },
      assets: {},
    },
  })

  let webmBlob: Blob | null = null
  let finishedTempInput = false
  try {
    webmBlob = await exportTimelineToWebm({
      timeline: options.timeline,
      aspectRatio: options.aspectRatio,
      width: options.resolution === '720p' ? 1280 : 1920,
      autoDownload: false,
      onProgress: (progress) => {
        if (progress.status === 'preparing' || progress.status === 'recording' || progress.status === 'done') {
          const status: 'preparing' | 'recording' | 'done' = progress.status
          options.onProgress?.({ status, ratio: progress.ratio * 0.82 })
        }
      },
    })

    options.onProgress?.({ status: 'converting', ratio: 0.86 })
    for (let offset = 0; offset < webmBlob.size; offset += MP4_WEBM_IPC_CHUNK_BYTES) {
      const chunk = await webmBlob.slice(offset, offset + MP4_WEBM_IPC_CHUNK_BYTES).arrayBuffer()
      await desktop.exports.writeTempInput({ jobId, chunk })
      const uploadRatio = webmBlob.size > 0 ? Math.min(1, (offset + MP4_WEBM_IPC_CHUNK_BYTES) / webmBlob.size) : 1
      options.onProgress?.({ status: 'converting', ratio: 0.86 + uploadRatio * 0.04 })
    }
    const result = await desktop.exports.finishTempInput({ jobId })
    finishedTempInput = true
    options.onProgress?.({ status: 'done', ratio: 1 })
    return result
  } catch (error) {
    if (!finishedTempInput && desktop.exports.cancel) {
      try {
        await desktop.exports.cancel(jobId)
      } catch (cancelError) {
        console.warn('Failed to cancel MP4 export job after renderer-side failure', cancelError)
      }
    }
    const message = error instanceof Error ? error.message : 'MP4 导出失败'
    if (!webmBlob) {
      throw new Error(message)
    }
    const fallbackName = createTimelineExportFilename('webm')
    downloadTimelineBlob(webmBlob, fallbackName)
    throw new Error(`${message}。已自动下载 WebM 备用文件：${fallbackName}`)
  }
}
