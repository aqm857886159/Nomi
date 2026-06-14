import { describe, expect, it } from 'vitest'
import { buildRenderManifestRequest } from './renderManifest'
import type { TimelineClip, TimelineState, TimelineTrack } from '../timeline/timelineTypes'

function makeTimeline(tracks: TimelineTrack[] = []): TimelineState {
  return {
    version: 1,
    fps: 30,
    scale: 1,
    playheadFrame: 0,
    tracks,
  }
}

function makeClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-1',
    type: 'video',
    sourceNodeId: 'asset-1',
    label: 'Clip 1',
    startFrame: 10,
    endFrame: 40,
    frameCount: 30,
    offsetStartFrame: 5,
    offsetEndFrame: 35,
    url: 'file:///project/media/clip.mp4',
    thumbnailUrl: 'file:///project/media/thumb.jpg',
    ...overrides,
  }
}

describe('buildRenderManifestRequest', () => {
  it('creates a 1080x1920 profile for 1080p 9:16 exports', () => {
    const request = buildRenderManifestRequest({
      projectId: 'project-1',
      timeline: makeTimeline(),
      aspectRatio: '9:16',
      resolution: '1080p',
      quality: 'standard',
      preset: 'publish',
    })

    expect(request.profile).toMatchObject({
      preset: 'publish',
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'none',
      audioMode: 'mute',
      width: 1080,
      height: 1920,
      fps: 30,
      pixelFormat: 'yuv420p',
      quality: 'standard',
    })
  })

  it('creates duration 0 and a validation warning for an empty timeline', () => {
    const request = buildRenderManifestRequest({
      projectId: 'project-1',
      timeline: makeTimeline(),
      aspectRatio: '16:9',
      resolution: '720p',
      quality: 'small',
      preset: 'share',
    })

    expect(request.timeline.durationFrames).toBe(0)
    expect(request.timeline.range).toEqual({ startFrame: 0, endFrame: 0 })
    expect(request.diagnostics.warnings).toContain('Timeline has no image or video clips to render.')
  })

  it('preserves video clip source offsets as source frame ranges', () => {
    const clip = makeClip({ offsetStartFrame: 12, offsetEndFrame: 72 })
    const request = buildRenderManifestRequest({
      projectId: 'project-1',
      timeline: makeTimeline([{ id: 'videoTrack', type: 'video', label: 'Video', clips: [clip] }]),
      aspectRatio: '16:9',
      resolution: '1080p',
      quality: 'high',
      preset: 'edit',
    })

    expect(request.timeline.durationFrames).toBe(40)
    expect(request.timeline.tracks).toEqual([
      {
        id: 'videoTrack',
        kind: 'video',
        type: 'video',
        clips: [
          {
            id: 'clip-1',
            assetId: 'asset-1',
            startFrame: 10,
            endFrame: 40,
            sourceStartFrame: 12,
            sourceEndFrame: 72,
          },
        ],
      },
    ])
  })

  it('preserves zero clip source offsets as explicit source frame ranges', () => {
    const clip = makeClip({ offsetStartFrame: 0, offsetEndFrame: 0 })
    const request = buildRenderManifestRequest({
      projectId: 'project-1',
      timeline: makeTimeline([{ id: 'videoTrack', type: 'video', label: 'Video', clips: [clip] }]),
      aspectRatio: '16:9',
      resolution: '1080p',
      quality: 'high',
      preset: 'edit',
    })

    expect(request.timeline.tracks[0]?.clips[0]).toMatchObject({
      sourceStartFrame: 0,
      sourceEndFrame: 0,
    })
  })

  it('exposes diagnostics for thin timeline model limitations without fake tracks', () => {
    const request = buildRenderManifestRequest({
      projectId: 'project-1',
      timeline: makeTimeline([{ id: 'imageTrack', type: 'image', label: 'Images', clips: [makeClip({ type: 'image' })] }]),
      aspectRatio: '1:1',
      resolution: '1080p',
      quality: 'standard',
      preset: 'publish',
    })

    expect(request.diagnostics.warnings).toEqual(expect.arrayContaining([
      'Timeline model only exposes image/video clips; audio/text/overlay/effect/keyframe entities are not first-class timeline tracks yet.',
      'Renderer request omits audio/text/overlay/effect/keyframe tracks instead of synthesizing unsupported timeline data.',
    ]))
    expect(request.timeline.tracks.map((track) => track.kind)).toEqual(['image'])
  })

  it('carries a non-default clip framing as transform and omits it for default framing', () => {
    const framedClip = makeClip({
      id: 'clip-framed',
      sourceNodeId: 'asset-framed',
      framing: { fit: 'cover', scale: 1.5, offsetX: 0.2, offsetY: -0.1 },
    })
    const plainClip = makeClip({ id: 'clip-plain', sourceNodeId: 'asset-plain', startFrame: 40, endFrame: 70 })
    const request = buildRenderManifestRequest({
      projectId: 'project-1',
      timeline: makeTimeline([{ id: 'videoTrack', type: 'video', label: 'Video', clips: [framedClip, plainClip] }]),
      aspectRatio: '16:9',
      resolution: '1080p',
      quality: 'standard',
      preset: 'publish',
    })

    const clips = request.timeline.tracks[0]?.clips ?? []
    expect(clips[0]).toMatchObject({ id: 'clip-framed', transform: { fit: 'cover', scale: 1.5, offsetX: 0.2, offsetY: -0.1 } })
    expect(clips[1]).not.toHaveProperty('transform')
  })

  it('does not fake hasAudio but can carry it from future media probe clip metadata', () => {
    const silentClip = makeClip({ id: 'clip-silent', sourceNodeId: 'asset-silent' })
    const probedClip = makeClip({ id: 'clip-probed', sourceNodeId: 'asset-probed' }) as TimelineClip & { hasAudio: boolean }
    probedClip.hasAudio = true

    const request = buildRenderManifestRequest({
      projectId: 'project-1',
      timeline: makeTimeline([{ id: 'videoTrack', type: 'video', label: 'Video', clips: [silentClip, probedClip] }]),
      aspectRatio: '4:5',
      resolution: '720p',
      quality: 'standard',
      preset: 'publish',
    })

    expect(request.profile).toMatchObject({ width: 720, height: 900 })
    expect(request.assets['asset-silent']).not.toHaveProperty('hasAudio')
    expect(request.assets['asset-probed']).toMatchObject({
      id: 'asset-probed',
      kind: 'video',
      url: 'file:///project/media/clip.mp4',
      hasAudio: true,
    })
  })
})
