import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimelineState } from '../timeline/timelineTypes'

const exportTimelineToWebmMock = vi.fn()
const downloadTimelineBlobMock = vi.fn()

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
})
