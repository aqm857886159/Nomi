import { getDesktopActiveProjectId } from '../../desktop/activeProject'
import { getDesktopBridge } from '../../desktop/bridge'
import type { DesktopMp4ExportResult } from '../../desktop/bridge'
import type { TimelineState } from '../timeline/timelineTypes'
import type { PreviewAspectRatio } from '../workbenchTypes'
import { createTimelineExportFilename, downloadTimelineBlob, exportTimelineToWebm } from './timelineWebmExport'
import type { ExportQuality } from './exportTypes'
import { buildRenderManifestRequest } from './renderManifest'
import { renderTextOverlays } from './textOverlayPng'

const MP4_WEBM_IPC_CHUNK_BYTES = 1024 * 1024

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
  manifest.textOverlays = renderTextOverlays(options.timeline, manifest.profile.width, manifest.profile.height)

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
  const manifest = buildRenderManifestRequest({
    projectId,
    timeline: options.timeline,
    aspectRatio: options.aspectRatio,
    resolution,
    quality,
    preset: 'publish',
  })
  manifest.textOverlays = renderTextOverlays(options.timeline, manifest.profile.width, manifest.profile.height)
  const { jobId, backend } = await desktop.exports.startJob({
    projectId,
    outputName: options.outputName,
    manifest,
  })

  let webmBlob: Blob | null = null
  let finishedTempInput = false
  const unsubscribe = desktop.exports.onEvent?.((event) => {
    if (event.jobId !== jobId) return
    const ratio = Math.max(0, Math.min(1, event.snapshot.progress.ratio))
    const stage = event.snapshot.progress.stage
    const status = stage === 'succeeded' ? 'done' : stage === 'encoding' || stage === 'muxing' || stage === 'finalizing' ? 'converting' : 'preparing'
    options.onProgress?.({ status, ratio })
  })
  try {
    // 主路径：资产可本地解析 → 主进程 ffmpeg 直读源文件渲染（所见即所得）。renderer 不录 WebM。
    if (backend === 'filtergraph') {
      options.onProgress?.({ status: 'converting', ratio: 0.12 })
      const result = await desktop.exports.finishTempInput({ jobId })
      finishedTempInput = true
      options.onProgress?.({ status: 'done', ratio: 1 })
      return result
    }

    // 降级路径：资产无法本地解析 → 录 canvas WebM 上传，主进程转码。
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
  } finally {
    unsubscribe?.()
  }
}
