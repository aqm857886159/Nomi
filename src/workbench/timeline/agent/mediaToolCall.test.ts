import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopAssetDto } from '../../../desktop/bridge'
import { setDesktopActiveProjectId } from '../../../desktop/activeProject'
import { createDefaultTimeline } from '../timelineMath'
import { applyMediaToolCall, type MediaToolRuntime } from './mediaToolCall'

const videoAsset: DesktopAssetDto = {
  id: 'stable-video-id',
  name: 'Interview Closeup.mp4',
  userId: 'local',
  projectId: 'project-1',
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z',
  data: {
    mediaType: 'video',
    contentType: 'video/mp4',
    size: 4096,
    url: 'nomi-local://project-1/assets/imported/interview.mp4',
    relativePath: 'assets/imported/interview.mp4',
    absolutePath: 'C:\\private\\interview.mp4',
  },
}

const audioAsset: DesktopAssetDto = {
  id: 'stable-audio-id',
  name: 'Room Tone.wav',
  userId: 'local',
  projectId: 'project-1',
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
  data: {
    mediaType: 'audio',
    contentType: 'audio/wav',
    url: 'nomi-local://project-1/assets/imported/room-tone.wav',
    relativePath: 'assets/imported/room-tone.wav',
  },
}

function runtime(): MediaToolRuntime {
  const timeline = createDefaultTimeline()
  timeline.tracks = timeline.tracks.map((track) => track.type === 'video'
    ? {
        ...track,
        clips: [{
          id: 'clip-video', type: 'video', sourceNodeId: 'asset:assets/imported/interview.mp4', label: 'Interview',
          startFrame: 30, endFrame: 90, frameCount: 120, offsetStartFrame: 20, offsetEndFrame: 40,
          url: 'nomi-local://project-1/assets/imported/interview.mp4',
        }],
      }
    : track)
  return {
    listProjectAssets: vi.fn(async () => [videoAsset, audioAsset]),
    inspectAsset: vi.fn(async (asset) => asset.id === videoAsset.id
      ? { durationSeconds: 4, width: 1920, height: 1080, fps: 30, hasAudio: true }
      : { durationSeconds: 2, sampleRate: 48_000, channels: 2 }),
    readWaveform: vi.fn(async (_asset, range) => ({
      durationSeconds: 2,
      sampleRate: 48_000,
      channels: 2,
      startSeconds: range.startSeconds,
      endSeconds: range.endSeconds ?? 2,
      buckets: [{ startSeconds: 0, endSeconds: 1, peak: 0.8, rms: 0.25 }],
    })),
    readTimeline: () => timeline,
  }
}

const serialized = (value: unknown): string => JSON.stringify(value)

afterEach(() => setDesktopActiveProjectId(null))

describe('project-scoped media Agent tools', () => {
  it('searches and retrieves stable ids without exposing local media locations', async () => {
    setDesktopActiveProjectId('project-1')
    const deps = runtime()
    const search = await applyMediaToolCall('search_media', { query: 'interview', kinds: ['video'] }, deps) as Record<string, unknown>
    expect(search).toMatchObject({ total: 1, media: [expect.objectContaining({ id: 'stable-video-id', kind: 'video' })] })
    expect(serialized(search)).not.toContain('nomi-local://')
    expect(serialized(search)).not.toContain('relativePath')
    expect(serialized(search)).not.toContain('absolutePath')
    expect(serialized(search)).not.toContain('C:\\private')

    const single = await applyMediaToolCall('get_media', { assetId: 'stable-video-id' }, deps)
    expect(single).toMatchObject({ media: { id: 'stable-video-id', contentType: 'video/mp4', sizeBytes: 4096 } })
    expect(serialized(single)).not.toContain('nomi-local://')
  })

  it('returns honest technical inspection and labels semantic analysis as not performed', async () => {
    setDesktopActiveProjectId('project-1')
    const result = await applyMediaToolCall('inspect_media', { assetId: 'stable-video-id' }, runtime())
    expect(result).toMatchObject({
      media: { id: 'stable-video-id' },
      technical: { durationSeconds: 4, width: 1920, height: 1080, fps: 30, hasAudio: true },
      semanticInspection: 'not_performed',
    })
  })

  it('validates source ranges and reports intersecting timeline usages', async () => {
    setDesktopActiveProjectId('project-1')
    const result = await applyMediaToolCall('inspect_source_range', {
      assetId: 'stable-video-id', startFrame: 30, endFrame: 50,
    }, runtime())
    expect(result).toMatchObject({
      assetId: 'stable-video-id', valid: true, knownSourceFrames: 120,
      usages: [{ clipId: 'clip-video', trackId: 'videoTrack', sourceWindow: { startFrame: 20, endFrame: 80 } }],
      semanticInspection: 'not_performed',
    })
  })

  it('returns bounded real waveform values through the decoder runtime', async () => {
    setDesktopActiveProjectId('project-1')
    const deps = runtime()
    const result = await applyMediaToolCall('read_waveform', {
      assetId: 'stable-audio-id', startSeconds: 0, endSeconds: 1, buckets: 32,
    }, deps)
    expect(result).toMatchObject({
      assetId: 'stable-audio-id', sampleRate: 48_000, channels: 2,
      buckets: [{ peak: 0.8, rms: 0.25 }],
    })
    expect(deps.readWaveform).toHaveBeenCalledWith(expect.objectContaining({ id: 'stable-audio-id' }), {
      startSeconds: 0, endSeconds: 1, buckets: 32,
    })
  })

  it('requires active project ownership and rejects cross-project records', async () => {
    await expect(applyMediaToolCall('search_media', {}, runtime())).rejects.toThrow('project_scope_required')
    setDesktopActiveProjectId('project-2')
    await expect(applyMediaToolCall('get_media', { assetId: 'stable-video-id' }, runtime())).rejects.toThrow('media_not_found')
  })

  // 2026-09-06 根因回归：素材库按 projectId 寻址，跟 GUI 打开哪个项目无关。已校验的 lease
  // projectId 必须压过 GUI 当前项目——旧代码只读 GUI，外部宿主查不到自己刚建的项目的素材。
  it('addresses the media library by the verified lease project, not by what the GUI has open', async () => {
    setDesktopActiveProjectId('')
    await expect(applyMediaToolCall('search_media', { projectId: 'project-1' }, runtime()))
      .resolves.toMatchObject({ operation: 'search_media', total: 2 })
    setDesktopActiveProjectId('project-2')
    await expect(applyMediaToolCall('get_media', { assetId: 'stable-video-id', projectId: 'project-1' }, runtime()))
      .resolves.toMatchObject({ operation: 'get_media', media: { id: 'stable-video-id' } })
  })
})
