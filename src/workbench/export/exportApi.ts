import { getDesktopBridge } from '../../desktop/bridge'
import type { DesktopMp4ExportResult } from '../../desktop/bridge'
import { ExportCancelledError, isExportCancelledError } from '../../../electron/shared/contracts/exportTypes'
import type { ExportFailureReason, TelemetryResult } from '../../../electron/shared/contracts/telemetry'
import i18n from '../../i18n'
import type { TimelineState } from '../timeline/timelineTypes'
import type { PreviewAspectRatio } from '../workbenchTypes'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { createTimelineExportFilename, downloadTimelineBlob, exportTimelineToWebm } from './timelineWebmExport'
import type { ExportQuality } from './exportTypes'
import { buildRenderManifestRequest } from './renderManifest'
import { renderTextOverlays } from './textOverlayPng'
import { resolveTimelinePlaybackUrls } from '../timeline/timelinePlaybackUrl'
import { logRendererWarn } from '../../desktop/rendererLog'

const MP4_WEBM_IPC_CHUNK_BYTES = 1024 * 1024

export { ExportCancelledError, isExportCancelledError }

export type ExportTimelineToMp4Options = {
  timeline: TimelineState
  aspectRatio: PreviewAspectRatio
  /** 导出归属的项目：调用方在导出动作起点签发后显式传入；缺失即报错，不回退当前项目。 */
  projectId: string
  outputName?: string
  resolution?: '720p' | '1080p'
  quality?: ExportQuality
  generationNodes?: readonly GenerationCanvasNode[]
  signal?: AbortSignal
  onProgress?: (progress: { status: ExportProgressStatus; ratio: number }) => void
  /** Fired only after the main process has created and persisted the export job. */
  onJobStarted?: (job: { jobId: string; backend: 'filtergraph' | 'webm' }) => void
}

/**
 * 导出进度的**唯一** owner（语义词表 canonical owner）。UI 侧要表达 idle/error 时，
 * 从这里 derive 再并上那两个局部标志，不许另写一份四态联合。
 */
export type ExportProgressStatus = 'preparing' | 'recording' | 'converting' | 'done'

export type StartTimelineMp4ExportJobOptions = Omit<ExportTimelineToMp4Options, 'onProgress'>

export function createTimelineExportManifest(options: Pick<
  ExportTimelineToMp4Options,
  'timeline' | 'aspectRatio' | 'projectId' | 'resolution' | 'quality' | 'generationNodes'
>): { projectId: string; timeline: TimelineState; manifest: ReturnType<typeof buildRenderManifestRequest> } {
  const projectId = String(options.projectId || '').trim()
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

/** 导出失败 → 闭合四分类（原文、路径、文件名一个字都不进事件）。 */
export function classifyExportFailureReason(error: unknown): ExportFailureReason {
  const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : ''
  const text = `${code} ${error instanceof Error ? error.message : String(error ?? '')}`
  if (/asset_unreadable|assetUnreadable|missing_output|inputMissing|inputEmpty|clip_unavailable|ENOENT|no such file|media.*missing|无法读取素材|找不到素材/i.test(text)) {
    return 'missing_media'
  }
  if (/ENOSPC|EACCES|EPERM|EROFS|outside_project|disk full|no space left|permission denied|磁盘空间|权限不足/i.test(text)) {
    return 'disk_or_permission'
  }
  if (/ffmpeg|filtergraph|codec|probe_unavailable|mp4NotProduced|mp4Empty|transcode|mux|exit code|转码失败/i.test(text)) {
    return 'ffmpeg_error'
  }
  return 'other'
}

export async function exportTimelineToMp4(options: ExportTimelineToMp4Options): Promise<DesktopMp4ExportResult> {
  const desktop = getDesktopBridge()
  if (!desktop?.exports?.startJob || !desktop.exports.writeTempInput || !desktop.exports.finishTempInput) {
    throw new Error(i18n.t('runtime.export.mp4RequiresDesktop'))
  }
  if (options.signal?.aborted) {
    throw new ExportCancelledError()
  }
  const { projectId, timeline: exportTimeline, manifest } = createTimelineExportManifest(options)
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const trackExport = (result: TelemetryResult, failureReason?: ExportFailureReason): void => {
    const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const elapsed = endedAt - startedAt
    void desktop.telemetry?.track({
      eventName: 'export.completed',
      props: {
        format: 'mp4',
        durationBucket: elapsed < 1000 ? '<1s' : elapsed <= 5000 ? '1-5s' : '>5s',
        result,
        ...(result === 'failure' ? { failureReason: failureReason ?? 'other' } : {}),
      },
    })
  }
  let jobId: string | null = null
  let webmBlob: Blob | null = null
  let finishedTempInput = false
  let jobCancelled = Boolean(options.signal?.aborted)
  let cancelJobPromise: Promise<unknown> | null = null
  let onAbort: (() => void) | undefined
  let unsubscribe: (() => void) | undefined

  const cancelRemoteJob = (): Promise<unknown> => {
    jobCancelled = true
    if (jobId !== null && !finishedTempInput && desktop.exports.cancel) {
      cancelJobPromise ??= desktop.exports.cancel(jobId).catch((cancelError: unknown) => {
        logRendererWarn('export-cancel-failed', undefined, cancelError)
      })
    }
    return cancelJobPromise ?? Promise.resolve()
  }

  const throwIfCancelled = (): void => {
    if (options.signal?.aborted || jobCancelled) {
      throw new ExportCancelledError()
    }
  }

  try {
    const started = await desktop.exports.startJob({
      projectId,
      outputName: options.outputName,
      manifest,
    })
    jobId = started.jobId
    const { backend } = started

    if (options.signal?.aborted || jobCancelled) {
      await cancelRemoteJob()
      trackExport('cancel')
      throw new ExportCancelledError()
    }

    options.onJobStarted?.({ jobId, backend })
    onAbort = () => {
      void cancelRemoteJob()
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    unsubscribe = desktop.exports.onEvent?.((event) => {
      if (event.jobId !== jobId) return
      if (event.snapshot.cancelled || event.snapshot.status === 'cancelled') {
        jobCancelled = true
        return
      }
      const ratio = Math.max(0, Math.min(1, event.snapshot.progress.ratio))
      const stage = event.snapshot.progress.stage
      const status = stage === 'succeeded' ? 'done' : stage === 'encoding' || stage === 'muxing' || stage === 'finalizing' ? 'converting' : 'preparing'
      options.onProgress?.({ status, ratio })
    })
    // 主路径：资产可本地解析 → 主进程 ffmpeg 直读源文件渲染（所见即所得）。renderer 不录 WebM。
    if (backend === 'filtergraph') {
      options.onProgress?.({ status: 'converting', ratio: 0.12 })
      const result = await desktop.exports.finishTempInput({ jobId })
      throwIfCancelled()
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
      signal: options.signal,
      onProgress: (progress) => {
        if (options.signal?.aborted || jobCancelled) return
        if (progress.status === 'preparing' || progress.status === 'recording' || progress.status === 'done') {
          const status: 'preparing' | 'recording' | 'done' = progress.status
          options.onProgress?.({ status, ratio: progress.ratio * 0.82 })
        }
      },
    })
    throwIfCancelled()

    options.onProgress?.({ status: 'converting', ratio: 0.86 })
    for (let offset = 0; offset < webmBlob.size; offset += MP4_WEBM_IPC_CHUNK_BYTES) {
      throwIfCancelled()
      const chunk = await webmBlob.slice(offset, offset + MP4_WEBM_IPC_CHUNK_BYTES).arrayBuffer()
      throwIfCancelled()
      await desktop.exports.writeTempInput({ jobId, chunk })
      throwIfCancelled()
      const uploadRatio = webmBlob.size > 0 ? Math.min(1, (offset + MP4_WEBM_IPC_CHUNK_BYTES) / webmBlob.size) : 1
      options.onProgress?.({ status: 'converting', ratio: 0.86 + uploadRatio * 0.04 })
    }
    throwIfCancelled()
    const result = await desktop.exports.finishTempInput({ jobId })
    throwIfCancelled()
    finishedTempInput = true
    options.onProgress?.({ status: 'done', ratio: 1 })
    trackExport('success')
    return result
  } catch (error) {
    if (options.signal?.aborted || jobCancelled || isExportCancelledError(error)) {
      await cancelRemoteJob()
      trackExport('cancel')
      throw error instanceof ExportCancelledError ? error : new ExportCancelledError()
    }
    trackExport('failure', classifyExportFailureReason(error))
    if (jobId !== null && !finishedTempInput && desktop.exports.cancel) {
      try {
        await (cancelJobPromise ?? desktop.exports.cancel(jobId))
      } catch (cancelError) {
        logRendererWarn('export-cancel-failed', undefined, cancelError)
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
    if (onAbort) options.signal?.removeEventListener('abort', onAbort)
    unsubscribe?.()
  }
}
