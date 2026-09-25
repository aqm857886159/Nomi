import { describe, expect, it, vi } from 'vitest'
import type { AssetLibraryDragPayload } from '../assets/assetLibraryDrag'
import type { TimelineState } from './timelineTypes'
import {
  assetRefFromDragPayload,
  buildAssetTimelineClip,
  findAssetAppendFrame,
  resolveAssetDrop,
  tryAddAssetFromDragData,
} from './addAssetToTimeline'

vi.mock('../../media/audioDurationProbe', () => ({ readAudioDurationSeconds: vi.fn() }))
// 复制通道（宿主桥替身）：别的项目的素材落时间轴前先复制进 project-a。
const copyProjectAsset = vi.fn()
vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: () => ({ assets: { copyProjectAsset } }) }))
// 拖放签发的是此刻打开的项目 project-a（替身）。
vi.mock('../project/projectCanvasReadSurface', () => {
  const project = { binding: { projectId: 'project-a', immutableProjectUuid: 'uuid-a', projectGeneration: 1 }, signal: new AbortController().signal, assertCurrent: () => undefined }
  return { withProjectAction: (run: (issued: typeof project) => unknown) => run(project), isProjectExecutionContextCurrent: () => true }
})

function payload(kind: AssetLibraryDragPayload['kind']): AssetLibraryDragPayload {
  const extension = kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'mp3'
  return {
    kind,
    name: `media.${extension}`,
    renderUrl: `nomi-local://asset/project-a/assets/media.${extension}`,
    origin: {
      source: 'project',
      projectId: 'project-a',
      relativePath: `assets/media.${extension}`,
    },
  }
}

const timeline: TimelineState = {
  version: 1,
  fps: 30,
  scale: 1,
  playheadFrame: 0,
  textClips: [],
  tracks: [
    { id: 'image', type: 'image', label: 'image', clips: [] },
    {
      id: 'video',
      type: 'video',
      label: 'video',
      clips: [{
        id: 'clip',
        type: 'video',
        sourceNodeId: 'node',
        label: 'clip',
        startFrame: 30,
        endFrame: 240,
        frameCount: 210,
        offsetStartFrame: 0,
        offsetEndFrame: 0,
      }],
    },
    { id: 'audio', type: 'audio', label: 'audio', clips: [] },
  ],
}

describe('asset timeline actions', () => {
  it('delivers asynchronous media probe rejection to the supplied local feedback host', async () => {
    const error = new Error('Media probe failed')
    const probe = vi.mocked((await import('../../media/audioDurationProbe')).readAudioDurationSeconds).mockRejectedValue(error)
    const failure = new Promise<unknown>((resolve) => {
      expect(tryAddAssetFromDragData(JSON.stringify(payload('audio')), {
        fps: 30, startFrame: 0, targetTrackType: 'audio', onFailure: resolve,
      })).toMatchObject({ status: 'accept' })
    })
    await expect(failure).resolves.toBe(error)
    probe.mockRestore()
  })

  it.each(['image', 'video', 'audio'] as const)('normalizes a %s drag payload to AssetRef', (kind) => {
    const asset = assetRefFromDragPayload(payload(kind))
    expect(asset).toMatchObject({
      id: `assets/media.${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'mp3'}`,
      kind,
      source: 'project',
      origin: { source: 'project', projectId: 'project-a' },
    })
  })

  it('accepts only the matching target track and reports the expected track', () => {
    expect(resolveAssetDrop(payload('video'), 'video')).toMatchObject({ status: 'accept' })
    expect(resolveAssetDrop(payload('video'), 'image')).toEqual({
      status: 'reject',
      expectedTrack: 'video',
    })
  })

  it('copies a project asset from another project in before the timeline write (was: rejected, so it could not be dragged in)', async () => {
    copyProjectAsset.mockReset()
    copyProjectAsset.mockRejectedValue(new Error('Source project not found'))
    const foreign = { ...payload('video'), renderUrl: 'nomi-local://asset/project-b/assets/media.mp4', origin: { source: 'project' as const, projectId: 'project-b', relativePath: 'assets/media.mp4' } }
    const onFailure = vi.fn()
    const result = tryAddAssetFromDragData(JSON.stringify(foreign), { fps: 30, startFrame: 0, targetTrackType: 'video', onFailure })
    expect(result).toEqual({ status: 'accept', kind: 'video' })
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledTimes(1))
    expect(copyProjectAsset).toHaveBeenCalledWith({ sourceProjectId: 'project-b', targetProjectId: 'project-a', relativePath: 'assets/media.mp4' })
    // 复制失败时给的是「没能复制到本项目」这句人话，不是别的项目的地址进了时间轴。
    expect(String((onFailure.mock.calls[0]?.[0] as Error)?.message)).toMatch(/copyIntoProjectFailed|复制|copied/)
  })

  it('finds the matching track end for click-to-append', () => {
    expect(findAssetAppendFrame(timeline, 'image')).toBe(0)
    expect(findAssetAppendFrame(timeline, 'video')).toBe(240)
    expect(findAssetAppendFrame(timeline, 'audio')).toBe(0)
  })

  it('probes only the relevant duration source before building a clip', async () => {
    const readVideoDuration = vi.fn(async () => 8)
    const readAudioDuration = vi.fn(async () => 12)
    const probes = { readVideoDuration, readAudioDuration }

    const image = await buildAssetTimelineClip(assetRefFromDragPayload(payload('image'))!, {
      fps: 30,
      startFrame: 0,
    }, probes)
    const video = await buildAssetTimelineClip(assetRefFromDragPayload(payload('video'))!, {
      fps: 30,
      startFrame: 30,
    }, probes)
    const audio = await buildAssetTimelineClip(assetRefFromDragPayload(payload('audio'))!, {
      fps: 30,
      startFrame: 60,
    }, probes)

    expect(image?.frameCount).toBe(90)
    expect(video?.frameCount).toBe(240)
    expect(audio?.frameCount).toBe(360)
    expect(readVideoDuration).toHaveBeenCalledTimes(1)
    expect(readAudioDuration).toHaveBeenCalledTimes(1)
  })

  it('does not materialize 3D assets as timeline clips', async () => {
    const asset = {
      id: 'mesh',
      kind: 'model3d',
      name: 'mesh.glb',
      renderUrl: 'nomi-local://asset/project-a/assets/mesh.glb',
      source: 'project',
      origin: { source: 'project', projectId: 'project-a', relativePath: 'assets/mesh.glb' },
    } as const

    expect(await buildAssetTimelineClip(asset, { fps: 30, startFrame: 0 })).toBeNull()
  })
})
