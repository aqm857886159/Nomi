import type { ExportJobSnapshot, ExportJobVerification } from '../../../../electron/export/exportJobManager'
import { EXPORT_STAGES, type ExportQuality, type ExportStage } from '../../../../electron/export/exportTypes'
import { getDesktopActiveProjectId } from '../../../desktop/activeProject'
import { resolveCapabilityProjectId } from '../../capability/capabilityProjectBinding'
import { getDesktopBridge } from '../../../desktop/bridge'
import { exportTimelineToMp4 } from '../../export/exportApi'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../workbenchStore'
import type { PreviewAspectRatio } from '../../workbenchTypes'
import { normalizeKernelTimeline, timelineRevision } from '../kernel/timelineKernel'
import type { TimelineState } from '../timelineTypes'

export type ExportToolCallName =
  | 'export_timeline'
  | 'inspect_export_job'
  | 'verify_render'
  | 'cancel_export_job'

type ExportProfileInput = {
  aspectRatio?: PreviewAspectRatio
  resolution?: '720p' | '1080p'
  quality?: ExportQuality
  outputName?: string
}

export type ExportToolRuntime = {
  activeProjectId(): string
  readTimeline(): TimelineState
  readAspectRatio(): PreviewAspectRatio
  readGenerationNodes(): Parameters<typeof exportTimelineToMp4>[0]['generationNodes']
  startExport(input: {
    projectId: string
    timeline: TimelineState
    expectedRevision: string
    profile: ExportProfileInput
  }): Promise<{ jobId: string; backend: 'filtergraph' | 'webm' }>
  getJob(jobId: string): Promise<ExportJobSnapshot>
  verifyJob(jobId: string): Promise<ExportJobVerification>
  cancelJob(jobId: string): Promise<{ ok: boolean }>
}

const ASPECT_RATIOS = new Set<PreviewAspectRatio>(['16:9', '9:16', '1:1', '4:5', '3:4', '4:3', '21:9'])

function isActiveStatus(status: ExportJobSnapshot['status']): boolean {
  return status === 'queued' || EXPORT_STAGES.includes(status as ExportStage)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > maxLength) throw new Error(`${field} is required and must be at most ${maxLength} characters`)
  return text
}

function exportProfile(input: Record<string, unknown>): ExportProfileInput {
  const aspectRatio = typeof input.aspectRatio === 'string' && ASPECT_RATIOS.has(input.aspectRatio as PreviewAspectRatio)
    ? input.aspectRatio as PreviewAspectRatio
    : undefined
  const resolution = input.resolution === '720p' || input.resolution === '1080p' ? input.resolution : undefined
  const quality = input.quality === 'small' || input.quality === 'standard' || input.quality === 'high'
    ? input.quality
    : undefined
  const outputName = typeof input.outputName === 'string' && input.outputName.trim()
    ? input.outputName.trim().slice(0, 120)
    : undefined
  return { aspectRatio, resolution, quality, outputName }
}

/**
 * 导出作业按 projectId 在主进程登记表里寻址——不需要项目正开着。所以已校验的 lease projectId
 * 优先，没给才回退 GUI 当前项目（应用内调用者）。解析规则住在 capabilityProjectBinding.ts。
 */
function scopeProjectId(runtime: ExportToolRuntime, boundProjectId?: unknown): string {
  return resolveCapabilityProjectId(
    boundProjectId,
    () => runtime.activeProjectId(),
    'project_scope_required: an active project is required',
  )
}

function failureCategory(snapshot: ExportJobSnapshot): string | null {
  if (snapshot.status === 'cancelled') return 'cancelled'
  if (snapshot.status !== 'failed') return null
  const message = `${snapshot.error?.name ?? ''} ${snapshot.error?.message ?? ''}`.toLowerCase()
  if (message.includes('restart') || message.includes('interrupted')) return 'interrupted'
  if (message.includes('space') || message.includes('disk')) return 'storage'
  if (message.includes('ffmpeg') || message.includes('codec') || message.includes('encode') || message.includes('mux')) return 'render_engine'
  return 'export_failed'
}

function compactJob(snapshot: ExportJobSnapshot): Record<string, unknown> {
  const outputBytes = snapshot.result?.bytes
  return {
    jobId: snapshot.id,
    status: snapshot.status,
    progress: {
      ratio: Math.max(0, Math.min(1, snapshot.progress.ratio)),
      stage: snapshot.progress.stage,
    },
    cancellable: isActiveStatus(snapshot.status),
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    ...(snapshot.completedAt ? { completedAt: snapshot.completedAt } : {}),
    output: {
      available: snapshot.status === 'succeeded' && typeof outputBytes === 'number' && outputBytes > 0,
      ...(typeof outputBytes === 'number' ? { bytes: outputBytes } : {}),
      ...(typeof snapshot.result?.durationMs === 'number' ? { durationMs: snapshot.result.durationMs } : {}),
    },
    warningCount: snapshot.manifest.diagnostics?.warnings.length ?? 0,
    ...(snapshot.manifestIntegrity ? { manifestIntegrity: snapshot.manifestIntegrity } : {}),
    ...(failureCategory(snapshot) ? { failure: { category: failureCategory(snapshot) } } : {}),
  }
}

async function scopedJob(runtime: ExportToolRuntime, jobId: string, boundProjectId?: unknown): Promise<ExportJobSnapshot> {
  const projectId = scopeProjectId(runtime, boundProjectId)
  const snapshot = await runtime.getJob(jobId)
  if (snapshot.projectId !== projectId) throw new Error('export_job_not_found: the job is not available in the active project')
  return snapshot
}

function defaultStartExport(runtime: Omit<ExportToolRuntime, 'startExport'>, input: Parameters<ExportToolRuntime['startExport']>[0]): Promise<{ jobId: string; backend: 'filtergraph' | 'webm' }> {
  let started = false
  let resolveStarted!: (value: { jobId: string; backend: 'filtergraph' | 'webm' }) => void
  let rejectStarted!: (error: unknown) => void
  const receipt = new Promise<{ jobId: string; backend: 'filtergraph' | 'webm' }>((resolve, reject) => {
    resolveStarted = resolve
    rejectStarted = reject
  })
  const completion = exportTimelineToMp4({
    projectId: input.projectId,
    timeline: input.timeline,
    aspectRatio: input.profile.aspectRatio ?? runtime.readAspectRatio(),
    resolution: input.profile.resolution ?? '1080p',
    quality: input.profile.quality ?? 'standard',
    outputName: input.profile.outputName,
    generationNodes: runtime.readGenerationNodes(),
    onJobStarted: (job) => {
      started = true
      resolveStarted(job)
    },
  })
  void completion.catch((error) => {
    if (!started) rejectStarted(error)
    // Once the persisted job exists, inspect_export_job owns diagnostics.
  })
  return receipt
}

function defaultRuntime(): ExportToolRuntime {
  const base = {
    activeProjectId: () => getDesktopActiveProjectId(),
    readTimeline: () => useWorkbenchStore.getState().timeline,
    readAspectRatio: () => useWorkbenchStore.getState().previewAspectRatio,
    readGenerationNodes: () => useGenerationCanvasStore.getState().nodes,
    getJob: async (jobId: string) => {
      const bridge = getDesktopBridge()
      if (!bridge?.exports?.status) throw new Error('export_status_unavailable: desktop export status is unavailable')
      return bridge.exports.status(jobId)
    },
    verifyJob: async (jobId: string) => {
      const bridge = getDesktopBridge()
      if (!bridge?.exports?.verify) throw new Error('export_verify_unavailable: desktop export verification is unavailable')
      return bridge.exports.verify(jobId)
    },
    cancelJob: async (jobId: string) => {
      const bridge = getDesktopBridge()
      if (!bridge?.exports?.cancel) throw new Error('export_cancel_unavailable: desktop export cancellation is unavailable')
      return bridge.exports.cancel(jobId)
    },
  }
  return { ...base, startExport: (input) => defaultStartExport(base, input) }
}

export async function applyExportToolCall(
  toolName: string,
  args: unknown,
  runtime: ExportToolRuntime = defaultRuntime(),
): Promise<unknown> {
  const input = asRecord(args)
  if (toolName === 'export_timeline') {
    const projectId = scopeProjectId(runtime, input.projectId)
    const expectedRevision = requiredString(input.expectedRevision, 'expectedRevision', 64)
    const timeline = normalizeKernelTimeline(runtime.readTimeline())
    const currentRevision = timelineRevision(timeline)
    if (expectedRevision !== currentRevision) {
      return { operation: toolName, accepted: false, code: 'stale_revision', expectedRevision, currentRevision }
    }
    const durationFrames = Math.max(0, ...timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.endFrame)), ...timeline.textClips.map((clip) => clip.endFrame))
    if (durationFrames === 0) return { operation: toolName, accepted: false, code: 'empty_timeline', currentRevision }
    const profile = exportProfile(input)
    const started = await runtime.startExport({ projectId, timeline, expectedRevision, profile })
    return {
      operation: toolName,
      accepted: true,
      jobId: started.jobId,
      backend: started.backend,
      timelineRevision: currentRevision,
      durationFrames,
      profile: {
        aspectRatio: profile.aspectRatio ?? runtime.readAspectRatio(),
        resolution: profile.resolution ?? '1080p',
        quality: profile.quality ?? 'standard',
      },
    }
  }

  const jobId = requiredString(input.jobId, 'jobId', 160)
  if (toolName === 'verify_render') {
    // 与 inspect/cancel 同族：作业归属必须先过项目闸，否则一条 lease 能验别的项目的渲染产物。
    await scopedJob(runtime, jobId, input.projectId)
    const verification = await runtime.verifyJob(jobId)
    return { operation: toolName, ...verification }
  }
  const snapshot = await scopedJob(runtime, jobId, input.projectId)
  if (toolName === 'inspect_export_job') return { operation: toolName, ...compactJob(snapshot) }
  if (toolName === 'cancel_export_job') {
    if (!isActiveStatus(snapshot.status)) {
      return { operation: toolName, jobId, cancelled: false, status: snapshot.status, code: 'export_not_cancellable' }
    }
    await runtime.cancelJob(jobId)
    return { operation: toolName, jobId, cancelled: true, status: 'cancelled' }
  }
  throw new Error(`unknown export tool ${toolName}`)
}
