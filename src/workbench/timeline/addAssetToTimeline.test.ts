import { describe, expect, it, vi } from 'vitest'
import type { AssetLibraryDragPayload } from '../assets/assetLibraryDrag'
import type { TimelineState } from './timelineTypes'
import {
  assetRefFromDragPayload,
  buildAssetTimelineClip,
  findAssetAppendFrame,
  resolveAssetDrop,
} from './addAssetToTimeline'

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
    expect(resolveAssetDrop(payload('video'), 'video', 'project-a')).toMatchObject({ status: 'accept' })
    expect(resolveAssetDrop(payload('video'), 'image', 'project-a')).toEqual({
      status: 'reject',
      expectedTrack: 'video',
    })
  })

  it('rejects a project asset from another project before timeline write', () => {
    expect(resolveAssetDrop(payload('video'), 'video', 'project-b')).toEqual({ status: 'reject-external' })
    expect(resolveAssetDrop(payload('video'), 'video')).toEqual({ status: 'reject-external' })
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
