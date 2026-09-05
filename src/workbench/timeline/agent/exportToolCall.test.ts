import { describe, expect, it, vi } from 'vitest'
import type { ExportJobSnapshot, ExportJobVerification } from '../../../../electron/export/exportJobManager'
import { createDefaultTimeline } from '../timelineMath'
import { timelineRevision } from '../kernel/timelineKernel'
import { applyExportToolCall, type ExportToolRuntime } from './exportToolCall'

function timeline() {
  const state = createDefaultTimeline()
  state.tracks = state.tracks.map((track) => track.type === 'video'
    ? { ...track, clips: [{ id: 'clip-1', type: 'video', sourceNodeId: 'node-1', label: 'Clip', startFrame: 0, endFrame: 60, frameCount: 60, offsetStartFrame: 0, offsetEndFrame: 0 }] }
    : track)
  return state
}

function job(overrides: Partial<ExportJobSnapshot> = {}): ExportJobSnapshot {
  return {
    id: 'job-1', projectId: 'project-1', projectIdentity: null, projectDir: 'C:/private/project', jobDir: 'C:/private/job',
    manifest: { version: 1, projectId: 'project-1', createdAt: '2026-08-28T00:00:00.000Z',
      timeline: { fps: 30, durationFrames: 60, range: { startFrame: 0, endFrame: 60 }, tracks: [] },
      profile: { preset: 'publish', container: 'mp4', quality: 'standard', width: 1920, height: 1080, fps: 30, videoCodec: 'h264', pixelFormat: 'yuv420p', audioCodec: 'none', audioMode: 'mute' }, assets: {},
      execution: { backend: 'filtergraph' } },
    manifestIntegrity: 'canonical',
    status: 'encoding', progress: { ratio: 0.5, stage: 'encoding', message: 'Encoding MP4' }, cancelled: false,
    createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:01.000Z',
    ...overrides,
  }
}

function runtime(overrides: Partial<ExportToolRuntime> = {}): ExportToolRuntime {
  const state = timeline()
  return {
    activeProjectId: () => 'project-1',
    readTimeline: () => state,
    readAspectRatio: () => '16:9',
    readGenerationNodes: () => [],
    startExport: vi.fn(async () => ({ jobId: 'job-1', backend: 'filtergraph' as const })),
    getJob: vi.fn(async () => job()),
    verifyJob: vi.fn(async (): Promise<ExportJobVerification> => ({
      jobId: 'job-1', verified: false, verificationLevel: 'export_job_output' as const, contentDecoded: false as const,
      status: 'encoding', manifestIntegrity: 'canonical' as const, code: 'export_encoding',
    })),
    cancelJob: vi.fn(async () => ({ ok: true })),
    ...overrides,
  }
}

describe('project-scoped export Agent tools', () => {
  it('starts the existing export pipeline only for the exact timeline revision', async () => {
    const deps = runtime()
    const current = deps.readTimeline()
    const result = await applyExportToolCall('export_timeline', {
      expectedRevision: timelineRevision(current), aspectRatio: '9:16', resolution: '720p', quality: 'high', outputName: 'vertical-cut',
    }, deps)
    expect(result).toMatchObject({ accepted: true, jobId: 'job-1', backend: 'filtergraph', durationFrames: 60,
      profile: { aspectRatio: '9:16', resolution: '720p', quality: 'high' } })
    expect(deps.startExport).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-1', profile: expect.objectContaining({ outputName: 'vertical-cut' }) }))
  })

  // 2026-09-06 根因回归（docs/fixes/2026-09-06-mcp-lease-project-binding.root-cause.json）：
  // 导出作业按 projectId 在主进程登记表里寻址，跟「Nomi 里正开着哪个项目」无关。已校验的 lease
  // projectId 必须压过 GUI 当前项目；旧代码把它丢掉、只读 GUI，于是外部宿主拿到没有下一步的
  // project_scope_required（GUI 没开项目）或者操作了错误的项目（GUI 开着别的项目）。
  it('addresses export jobs by the verified lease project, not by what the GUI has open', async () => {
    const noProjectOpen = runtime({ activeProjectId: () => '' })
    await expect(applyExportToolCall('inspect_export_job', { jobId: 'job-1' }, noProjectOpen))
      .rejects.toThrow('project_scope_required')
    await expect(applyExportToolCall('inspect_export_job', { jobId: 'job-1', projectId: 'project-1' }, noProjectOpen))
      .resolves.toMatchObject({ operation: 'inspect_export_job', jobId: 'job-1', status: 'encoding' })

    const otherProjectOpen = runtime({ activeProjectId: () => 'project-2' })
    await expect(applyExportToolCall('inspect_export_job', { jobId: 'job-1', projectId: 'project-1' }, otherProjectOpen))
      .resolves.toMatchObject({ jobId: 'job-1' })
    await expect(applyExportToolCall('cancel_export_job', { jobId: 'job-1', projectId: 'project-1' }, otherProjectOpen))
      .resolves.toMatchObject({ cancelled: true })

    const started = runtime({ activeProjectId: () => '' })
    await expect(applyExportToolCall('export_timeline', {
      projectId: 'project-1', expectedRevision: timelineRevision(started.readTimeline()),
    }, started)).resolves.toMatchObject({ accepted: true, jobId: 'job-1' })
    expect(started.startExport).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-1' }))
  })

  it('scopes verify_render to the same project boundary as inspect and cancel', async () => {
    const foreign = runtime({ activeProjectId: () => '', getJob: vi.fn(async () => job({ projectId: 'project-2' })) })
    await expect(applyExportToolCall('verify_render', { jobId: 'job-1', projectId: 'project-1' }, foreign))
      .rejects.toThrow('export_job_not_found')
    expect(foreign.verifyJob).not.toHaveBeenCalled()
  })

  it('rejects stale and empty timelines before creating an export job', async () => {
    const deps = runtime()
    await expect(applyExportToolCall('export_timeline', { expectedRevision: 'stale' }, deps)).resolves.toMatchObject({ accepted: false, code: 'stale_revision' })
    expect(deps.startExport).not.toHaveBeenCalled()
    const empty = createDefaultTimeline()
    const emptyRuntime = runtime({ readTimeline: () => empty })
    await expect(applyExportToolCall('export_timeline', { expectedRevision: timelineRevision(empty) }, emptyRuntime)).resolves.toMatchObject({ accepted: false, code: 'empty_timeline' })
  })

  it('returns a path-free status receipt with useful progress diagnostics', async () => {
    const deps = runtime({ getJob: vi.fn(async () => job({ manifest: { ...job().manifest, diagnostics: { warnings: ['fallback'] } } })) })
    const result = await applyExportToolCall('inspect_export_job', { jobId: 'job-1' }, deps)
    expect(result).toMatchObject({ jobId: 'job-1', status: 'encoding', cancellable: true, warningCount: 1, progress: { ratio: 0.5, stage: 'encoding' } })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('projectDir')
    expect(serialized).not.toContain('jobDir')
    expect(serialized).not.toContain('C:/private')
    // manifestIntegrity is an intentional status summary; the raw manifest object
    // (its "manifest" key with timeline/profile/asset internals) must not leak.
    expect(serialized).not.toContain('"manifest"')
    expect(result).not.toHaveProperty('manifest')
  })

  it('binds inspection and cancellation to the active project', async () => {
    const foreign = runtime({ getJob: vi.fn(async () => job({ projectId: 'project-2' })) })
    await expect(applyExportToolCall('inspect_export_job', { jobId: 'job-1' }, foreign)).rejects.toThrow('export_job_not_found')
    expect(foreign.cancelJob).not.toHaveBeenCalled()

    const deps = runtime()
    await expect(applyExportToolCall('cancel_export_job', { jobId: 'job-1' }, deps)).resolves.toEqual({
      operation: 'cancel_export_job', jobId: 'job-1', cancelled: true, status: 'cancelled',
    })
    expect(deps.cancelJob).toHaveBeenCalledWith('job-1')
  })

  it('does not rewrite terminal jobs when cancellation is requested', async () => {
    const deps = runtime({ getJob: vi.fn(async () => job({ status: 'succeeded', progress: { ratio: 1, stage: 'succeeded', message: 'Succeeded' }, result: { outputPath: 'C:/private/out.mp4', bytes: 1234, durationMs: 2000, execution: { auditManifestDigest: 'a'.repeat(64), input: { kind: 'filtergraph' }, correlationDigest: 'c'.repeat(64) } } })) })
    await expect(applyExportToolCall('cancel_export_job', { jobId: 'job-1' }, deps)).resolves.toMatchObject({ cancelled: false, code: 'export_not_cancellable', status: 'succeeded' })
    expect(deps.cancelJob).not.toHaveBeenCalled()
  })

  it('labels receipt verification honestly without claiming media decode', async () => {
    const success = runtime({ verifyJob: vi.fn(async (): Promise<ExportJobVerification> => ({
      jobId: 'job-1', verified: true, verificationLevel: 'export_job_output' as const, contentDecoded: false as const,
      status: 'succeeded', manifestIntegrity: 'canonical' as const, bytes: 4096, durationMs: 2000,
    })) })
    await expect(applyExportToolCall('verify_render', { jobId: 'job-1' }, success)).resolves.toEqual({
      operation: 'verify_render',
      jobId: 'job-1', verified: true, verificationLevel: 'export_job_output', contentDecoded: false,
      status: 'succeeded', manifestIntegrity: 'canonical', bytes: 4096, durationMs: 2000,
    })
    const failed = runtime({ verifyJob: vi.fn(async (): Promise<ExportJobVerification> => ({
      jobId: 'job-1', verified: false, verificationLevel: 'export_job_output' as const, contentDecoded: false as const,
      status: 'succeeded', manifestIntegrity: 'canonical' as const, code: 'missing_output',
    })) })
    const result = await applyExportToolCall('verify_render', { jobId: 'job-1' }, failed)
    expect(result).toMatchObject({ verified: false, status: 'succeeded', code: 'missing_output' })
    expect(JSON.stringify(result)).not.toContain('C:/private')
  })
})
