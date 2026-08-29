import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimelineState } from '../timeline/timelineTypes'

const exportTimelineToWebmMock = vi.fn()
const downloadTimelineBlobMock = vi.fn()

type ExportProgressEvent = {
  jobId: string
  snapshot: {
    progress: { ratio: number; stage: string; message: string }
  }
}

vi.mock('./timelineWebmExport', () => ({
  createTimelineExportFilename: vi.fn(() => 'fallback.webm'),
  downloadTimelineBlob: downloadTimelineBlobMock,
  exportTimelineToWebm: exportTimelineToWebmMock,
}))

function makeTimeline(): TimelineState {
  return {
    version: 1,
    fps: 30,
    scale: 1,
    playheadFrame: 0,
    tracks: [],
    textClips: [],
  }
}

describe('exportTimelineToMp4', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('cancels the desktop export job when temp input upload fails after chunks were written and keeps WebM fallback', async () => {
    const startJob = vi.fn().mockResolvedValue({ jobId: 'job-1' })
    const writeTempInput = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, size: 1024 * 1024 })
      .mockRejectedValueOnce(new Error('disk full'))
    const finishTempInput = vi.fn()
    const cancel = vi.fn().mockResolvedValue({ ok: true })
    const webmBlob = new Blob([new Uint8Array(1024 * 1024 + 1)], { type: 'video/webm' })
    exportTimelineToWebmMock.mockResolvedValue(webmBlob)

    vi.stubGlobal('window', {
      nomiDesktop: {
        exports: {
          startJob,
          writeTempInput,
          finishTempInput,
          cancel,
        },
      },
    })

    const { exportTimelineToMp4 } = await import('./exportApi')

    await expect(
      exportTimelineToMp4({
        projectId: 'project-1',
        timeline: makeTimeline(),
        aspectRatio: '16:9',
      }),
    ).rejects.toThrow('已自动下载 WebM 备用文件：fallback.webm')

    expect(writeTempInput).toHaveBeenCalledTimes(2)
    expect(cancel).toHaveBeenCalledWith('job-1')
    expect(downloadTimelineBlobMock).toHaveBeenCalledWith(webmBlob, 'fallback.webm')
    expect(finishTempInput).not.toHaveBeenCalled()
  })

  it('filtergraph backend: skips WebM recording/upload and finishes directly from source', async () => {
    const startJob = vi.fn().mockResolvedValue({ jobId: 'job-1', backend: 'filtergraph' })
    const writeTempInput = vi.fn()
    const finishTempInput = vi.fn().mockResolvedValue({
      absolutePath: '/tmp/out.mp4',
      relativePath: 'exports/out.mp4',
      size: 4,
    })

    vi.stubGlobal('window', {
      nomiDesktop: {
        exports: { startJob, writeTempInput, finishTempInput },
      },
    })

    const { exportTimelineToMp4 } = await import('./exportApi')

    const onJobStarted = vi.fn()
    await expect(
      exportTimelineToMp4({ projectId: 'project-1', timeline: makeTimeline(), aspectRatio: '16:9', onJobStarted }),
    ).resolves.toEqual({ absolutePath: '/tmp/out.mp4', relativePath: 'exports/out.mp4', size: 4 })

    // 主路径不录 WebM、不上传分块
    expect(exportTimelineToWebmMock).not.toHaveBeenCalled()
    expect(writeTempInput).not.toHaveBeenCalled()
    expect(finishTempInput).toHaveBeenCalledWith({ jobId: 'job-1' })
    expect(onJobStarted).toHaveBeenCalledWith({ jobId: 'job-1', backend: 'filtergraph' })
  })

  it('does not cancel the desktop export job after finishTempInput succeeds', async () => {
    const startJob = vi.fn().mockResolvedValue({ jobId: 'job-1' })
    const writeTempInput = vi.fn().mockResolvedValue({ ok: true, size: 4 })
    const finishTempInput = vi.fn().mockResolvedValue({
      absolutePath: '/tmp/out.mp4',
      relativePath: 'exports/out.mp4',
      size: 4,
    })
    const cancel = vi.fn()
    exportTimelineToWebmMock.mockResolvedValue(new Blob([new Uint8Array(4)], { type: 'video/webm' }))

    vi.stubGlobal('window', {
      nomiDesktop: {
        exports: {
          startJob,
          writeTempInput,
          finishTempInput,
          cancel,
        },
      },
    })

    const { exportTimelineToMp4 } = await import('./exportApi')

    await expect(
      exportTimelineToMp4({
        projectId: 'project-1',
        timeline: makeTimeline(),
        aspectRatio: '16:9',
      }),
    ).resolves.toEqual({
      absolutePath: '/tmp/out.mp4',
      relativePath: 'exports/out.mp4',
      size: 4,
    })

    expect(cancel).not.toHaveBeenCalled()
    expect(downloadTimelineBlobMock).not.toHaveBeenCalled()
  })

  it('starts the desktop job with a muted no-audio P0 default manifest profile', async () => {
    const startJob = vi.fn().mockResolvedValue({ jobId: 'job-1' })
    const writeTempInput = vi.fn().mockResolvedValue({ ok: true, size: 4 })
    const finishTempInput = vi.fn().mockResolvedValue({
      absolutePath: '/tmp/out.mp4',
      relativePath: 'exports/out.mp4',
      size: 4,
    })
    exportTimelineToWebmMock.mockResolvedValue(new Blob([new Uint8Array(4)], { type: 'video/webm' }))

    vi.stubGlobal('window', {
      nomiDesktop: {
        exports: {
          startJob,
          writeTempInput,
          finishTempInput,
        },
      },
    })

    const { exportTimelineToMp4 } = await import('./exportApi')

    await exportTimelineToMp4({
      projectId: 'project-1',
      timeline: makeTimeline(),
      aspectRatio: '16:9',
    })

    expect(startJob).toHaveBeenCalledWith(expect.objectContaining({
      manifest: expect.objectContaining({
        profile: expect.objectContaining({
          audioCodec: 'none',
          audioMode: 'mute',
        }),
      }),
    }))
  })

  it('starts the desktop job with the renderer manifest snapshot before WebM upload', async () => {
    const startJob = vi.fn().mockResolvedValue({ jobId: 'job-1' })
    const writeTempInput = vi.fn().mockResolvedValue({ ok: true, size: 4 })
    const finishTempInput = vi.fn().mockResolvedValue({
      absolutePath: '/tmp/out.mp4',
      relativePath: 'exports/out.mp4',
      size: 4,
    })
    exportTimelineToWebmMock.mockResolvedValue(new Blob([new Uint8Array(4)], { type: 'video/webm' }))
    const timeline: TimelineState = {
      ...makeTimeline(),
      tracks: [
        {
          id: 'videoTrack',
          type: 'video',
          label: '视频轨',
          clips: [
            {
              id: 'clip-1',
              type: 'video',
              sourceNodeId: 'asset-1',
              label: 'clip',
              startFrame: 0,
              endFrame: 30,
              frameCount: 30,
              offsetStartFrame: 0,
              offsetEndFrame: 30,
              url: 'nomi-local://project-1/assets/clip.webm',
            },
          ],
        },
      ],
    }

    vi.stubGlobal('window', {
      nomiDesktop: {
        exports: {
          startJob,
          writeTempInput,
          finishTempInput,
        },
      },
    })

    const { exportTimelineToMp4 } = await import('./exportApi')

    await exportTimelineToMp4({ projectId: 'project-1', timeline, aspectRatio: '16:9' })

    const payload = startJob.mock.calls[0][0]
    expect(payload.manifest.timeline.tracks).toHaveLength(1)
    expect(payload.manifest.assets['asset-1']).toMatchObject({
      id: 'asset-1',
      kind: 'video',
      url: 'nomi-local://project-1/assets/clip.webm',
    })
    expect(payload.manifest.diagnostics.warnings.join('\n')).toMatch(/unsupported tracks|timeline model/i)
  })

  it('resolves old ComfyUI providerUrl clips to local assets before starting the desktop export job', async () => {
    const startJob = vi.fn().mockResolvedValue({ jobId: 'job-1', backend: 'filtergraph' })
    const finishTempInput = vi.fn().mockResolvedValue({
      absolutePath: '/tmp/out.mp4',
      relativePath: 'exports/out.mp4',
      size: 4,
    })
    const providerUrl = 'http://192.168.10.2:8188/view?filename=ComfyUI_00025_.mp4&subfolder=video&type=output'
    const localUrl = 'nomi-local://asset/project-1/assets/generated/video.mp4'
    const timeline: TimelineState = {
      ...makeTimeline(),
      tracks: [
        {
          id: 'videoTrack',
          type: 'video',
          label: '视频轨',
          clips: [
            {
              id: 'clip-1',
              type: 'video',
              sourceNodeId: 'node-1',
              label: 'clip',
              startFrame: 0,
              endFrame: 30,
              frameCount: 30,
              offsetStartFrame: 0,
              offsetEndFrame: 0,
              url: providerUrl,
            },
          ],
        },
      ],
    }

    vi.stubGlobal('window', {
      nomiDesktop: {
        exports: {
          startJob,
          writeTempInput: vi.fn(),
          finishTempInput,
        },
      },
    })

    const { exportTimelineToMp4 } = await import('./exportApi')

    await exportTimelineToMp4({
      projectId: 'project-1',
      timeline,
      aspectRatio: '16:9',
      generationNodes: [
        {
          id: 'node-1',
          kind: 'video',
          title: 'clip',
          position: { x: 0, y: 0 },
          status: 'idle',
          result: { id: 'result-1', type: 'video', url: localUrl, providerUrl, createdAt: 1 },
        },
      ],
    })

    const payload = startJob.mock.calls[0][0]
    expect(payload.manifest.assets['node-1'].url).toBe(localUrl)
    expect(payload.manifest.assets['node-1'].url).not.toBe(providerUrl)
  })

  it('subscribes to matching job progress events and unsubscribes after export completes', async () => {
    const startJob = vi.fn().mockResolvedValue({ jobId: 'job-1' })
    const writeTempInput = vi.fn().mockResolvedValue({ ok: true, size: 4 })
    const unsubscribe = vi.fn()
    let listener: ((event: ExportProgressEvent) => void) | null = null
    const onEvent = vi.fn((callback: (event: ExportProgressEvent) => void) => {
      listener = callback
      return unsubscribe
    })
    const finishTempInput = vi.fn().mockImplementation(async () => {
      listener?.({
        jobId: 'job-1',
        snapshot: {
          progress: { ratio: 0.91, stage: 'encoding', message: 'Encoding MP4' },
        },
      })
      listener?.({
        jobId: 'other-job',
        snapshot: {
          progress: { ratio: 0.5, stage: 'encoding', message: 'Wrong job' },
        },
      })
      return { absolutePath: '/tmp/out.mp4', relativePath: 'exports/out.mp4', size: 4 }
    })
    const onProgress = vi.fn()
    exportTimelineToWebmMock.mockResolvedValue(new Blob([new Uint8Array(4)], { type: 'video/webm' }))

    vi.stubGlobal('window', {
      nomiDesktop: {
        exports: {
          startJob,
          writeTempInput,
          finishTempInput,
          onEvent,
        },
      },
    })

    const { exportTimelineToMp4 } = await import('./exportApi')

    await exportTimelineToMp4({ projectId: 'project-1', timeline: makeTimeline(), aspectRatio: '16:9', onProgress })

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onProgress).toHaveBeenCalledWith({ status: 'converting', ratio: 0.91 })
    expect(onProgress).not.toHaveBeenCalledWith({ status: 'converting', ratio: 0.5 })
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
