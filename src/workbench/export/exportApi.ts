import { getDesktopActiveProjectId } from '../../desktop/activeProject'
import { getDesktopBridge } from '../../desktop/bridge'
import type { DesktopMp4ExportResult } from '../../desktop/bridge'
import i18n from '../../i18n'
import type { TimelineState } from '../timeline/timelineTypes'
import type { PreviewAspectRatio } from '../workbenchTypes'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { createTimelineExportFilename, downloadTimelineBlob, exportTimelineToWebm } from './timelineWebmExport'
import type { ExportQuality } from './exportTypes'
import { buildRenderManifestRequest } from './renderManifest'
import { renderTextOverlays } from './textOverlayPng'
import { resolveTimelinePlaybackUrls } from '../timeline/timelinePlaybackUrl'

const MP4_WEBM_IPC_CHUNK_BYTES = 1024 * 1024

export type ExportTimelineToMp4Options = {
  timeline: TimelineState
  aspectRatio: PreviewAspectRatio
  projectId?: string
  outputName?: string
  resolution?: '720p' | '1080p'
  quality?: ExportQuality
  generationNodes?: readonly GenerationCanvasNode[]
  onProgress?: (progress: { status: 'preparing' | 'recording' | 'converting' | 'done'; ratio: number }) => void
  /** Fired only after the main process has created and persisted the export job. */
  onJobStarted?: (job: { jobId: string; backend: 'filtergraph' | 'webm' }) => void
}

export type StartTimelineMp4ExportJobOptions = Omit<ExportTimelineToMp4Options, 'onProgress'>

export function createTimelineExportManifest(options: Pick<
  ExportTimelineToMp4Options,
  'timeline' | 'aspectRatio' | 'projectId' | 'resolution' | 'quality' | 'generationNodes'
>): { projectId: string; timeline: TimelineState; manifest: ReturnType<typeof buildRenderManifestRequest> } {
  const projectId = (options.projectId || getDesktopActiveProjectId()).trim()
  if (!projectId) throw new Error(i18n.t('runtime.export.missingProjectId'))
  const timeline = resolveTimelinePlaybackUrls(options.timeline, options.generationNodes || [])
  const manifest = buildRenderManifestRequest({
    projectId,
    timeline,
    aspectRatio: options.aspectRatio,
    resolution: options.resolution || '1080p',
    quality: options.quality || 'standard',
    preset: 'publish',
  })
  manifest.textOverlays = renderTextOverlays(timeline, manifest.profile.width, manifest.profile.height)
  return { projectId, timeline, manifest }
}

export async function startTimelineMp4ExportJob(options: StartTimelineMp4ExportJobOptions): Promise<{ jobId: string }> {
  const desktop = getDesktopBridge()
  if (!desktop?.exports?.startJob) {
    throw new Error(i18n.t('runtime.export.jobRequiresDesktop'))
  }
  const { projectId, manifest } = createTimelineExportManifest(options)

  return desktop.exports.startJob({
    projectId,
    manifest,
    outputName: options.outputName,
  })
}

export async function exportTimelineToMp4(options: ExportTimelineToMp4Options): Promise<DesktopMp4ExportResult> {
  const desktop = getDesktopBridge()
  if (!desktop?.exports?.startJob || !desktop.exports.writeTempInput || !desktop.exports.finishTempInput) {
    throw new Error(i18n.t('runtime.export.mp4RequiresDesktop'))
  }
  const { projectId, timeline: exportTimeline, manifest } = createTimelineExportManifest(options)
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const trackExport = (result: 'success' | 'failure' | 'cancel'): void => {
    const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const elapsed = endedAt - startedAt
    void desktop.telemetry?.track({ eventName: 'export.completed', props: { format: 'mp4', durationBucket: elapsed < 1000 ? '<1s' : elapsed <= 5000 ? '1-5s' : '>5s', result } })
  }
  const { jobId, backend } = await desktop.exports.startJob({
    projectId,
    outputName: options.outputName,
    manifest,
  })
  options.onJobStarted?.({ jobId, backend })

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
      trackExport('success')
      return result
    }

    // 降级路径：资产无法本地解析 → 录 canvas WebM 上传，主进程转码。
    webmBlob = await exportTimelineToWebm({
      timeline: exportTimeline,
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
    trackExport('success')
    return result
  } catch (error) {
    trackExport('failure')
    if (!finishedTempInput && desktop.exports.cancel) {
      try {
        await desktop.exports.cancel(jobId)
      } catch (cancelError) {
        console.warn('Failed to cancel MP4 export job after renderer-side failure', cancelError)
      }
    }
    const message = error instanceof Error ? error.message : i18n.t('runtime.export.mp4Failed')
    if (!webmBlob) {
      throw new Error(message)
    }
    const fallbackName = createTimelineExportFilename('webm')
    downloadTimelineBlob(webmBlob, fallbackName)
    throw new Error(i18n.t('runtime.export.webmFallbackDownloaded', { message, file: fallbackName }))
  } finally {
    unsubscribe?.()
  }
}
