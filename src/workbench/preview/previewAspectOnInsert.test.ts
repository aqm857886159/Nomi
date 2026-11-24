import { beforeEach, describe, expect, it } from 'vitest'
import { applyAdoption } from '../adoption/adoptionApply'
import { createWorkbenchAdoptionPorts } from '../adoption/adoptionStorePorts'
import { normalizePayload } from '../project/projectNormalize'
import { readCurrentWorkbenchProjectPayload, restoreWorkbenchProjectPayload } from '../project/workbenchProjectSession'
import { createDefaultTimeline } from '../timeline/timelineMath'
import type { TimelineClip } from '../timeline/timelineTypes'
import { useWorkbenchStore } from '../workbenchStore'
import { workbenchStoreLifetime } from '../workbenchStoreLifetime'
import { selectPreviewAspectRatio } from './previewAspectRatios'

function clip(type: TimelineClip['type'], sourceAspectRatio?: number): TimelineClip {
  return { id: type, type, sourceNodeId: type, label: type, startFrame: 0, endFrame: 30,
    frameCount: 30, offsetStartFrame: 0, offsetEndFrame: 0, sourceAspectRatio }
}

const store = useWorkbenchStore.getState

describe('first visual clip sets the project preview and export aspect', () => {
  beforeEach(() => workbenchStoreLifetime.releaseProject?.())

  it.each([
    ['video', 9 / 16, '9:16'],
    ['image', 1, '1:1'],
    ['image', 1280 / 1000, '4:3'],
    ['video', 16 / 9, '16:9'],
  ] as const)('matches the first %s with source ratio %s to %s', (type, sourceRatio, expected) => {
    store().addTimelineClipAtFrame(clip(type, sourceRatio), type, 0)
    expect(store().timeline.tracks.find(track => track.type === type)?.clips).toHaveLength(1)
    expect(selectPreviewAspectRatio(store())).toBe(expected)
  })

  it('matches through the shared shot adoption commit and holds through a later addition', () => {
    const portrait = clip('video', 9 / 16)
    store().addTimelineClipAtFrame(clip('audio'), 'audio', 0)
    store().addTimelineTextClip('title', 0)
    expect(applyAdoption(createWorkbenchAdoptionPorts(), [{ clip: portrait, trackType: 'video', startFrame: 0 }]).ok).toBe(true)
    store().addTimelineClipAtFrame(clip('image', 1), 'image', 0)
    expect(selectPreviewAspectRatio(store())).toBe('9:16')
  })

  it('preserves even a deliberate choice of the default across reopening and insertion', () => {
    store().setPreviewAspectRatio('16:9')
    const saved = normalizePayload(readCurrentWorkbenchProjectPayload())
    workbenchStoreLifetime.releaseProject?.()
    restoreWorkbenchProjectPayload(saved)
    store().addTimelineClipAtFrame(clip('image', 1), 'image', 0)
    expect(selectPreviewAspectRatio(store())).toBe('16:9')
    expect(store().timeline.tracks[0].clips).toHaveLength(1)
  })

  it('restores the matched ratio after reopening without matching a legacy timeline on load', () => {
    store().addTimelineClipAtFrame(clip('video', 9 / 16), 'video', 0)
    const saved = normalizePayload(readCurrentWorkbenchProjectPayload())
    workbenchStoreLifetime.releaseProject?.()
    restoreWorkbenchProjectPayload(saved)
    expect(selectPreviewAspectRatio(store())).toBe('9:16')

    const legacy = { ...saved, timeline: createDefaultTimeline(), previewAspect: undefined }
    legacy.timeline.tracks[1].clips = [clip('video', 9 / 16)]
    restoreWorkbenchProjectPayload(normalizePayload(legacy))
    expect(selectPreviewAspectRatio(store())).toBe('16:9')
  })
})
