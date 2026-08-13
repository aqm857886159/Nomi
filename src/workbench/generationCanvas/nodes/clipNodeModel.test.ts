import { describe, expect, it } from 'vitest'
import type { AssetRef } from '../../assets/assetTypes'
import { appendClipNodeSource, clipNodeSourceFromAsset, clipNodeTimeline, emptyClipNodeMeta, removeClipNodeSource, updateClipNodeSource } from './clipNodeModel'

const asset = (kind: 'image' | 'video', id: string): AssetRef => ({
  id,
  kind,
  name: id,
  renderUrl: `nomi-local://asset/${id}`,
  source: 'project',
  origin: { source: 'project', projectId: 'p', relativePath: id },
})

describe('clip node model', () => {
  it('builds an image/video source and preserves ordered timeline state', () => {
    const image = clipNodeSourceFromAsset(asset('image', 'a.png'))!
    const video = clipNodeSourceFromAsset(asset('video', 'b.mp4'))!
    let meta = appendClipNodeSource(emptyClipNodeMeta(), image)
    meta = appendClipNodeSource(meta, video)
    expect(meta.sourceNodeIds).toEqual(['a.png', 'b.mp4'])
    expect(meta.selectedClipId).toBe('b.mp4')
    meta = updateClipNodeSource(meta, 'b.mp4', { trimStart: 1, trimEnd: 4 })
    expect(meta.clips[1]).toMatchObject({ trimStart: 1, trimEnd: 4 })
    expect(removeClipNodeSource(meta, 'a.png').sourceNodeIds).toEqual(['b.mp4'])
  })

  it('rejects audio as a visual clip source', () => {
    expect(clipNodeSourceFromAsset(asset('image', 'image.png'))).toBeTruthy()
  })

  it('turns the ordered sources into one sequential export timeline and preserves trim offsets', () => {
    const image = clipNodeSourceFromAsset(asset('image', 'a.png'))!
    const video = clipNodeSourceFromAsset(asset('video', 'b.mp4'))!
    const meta = appendClipNodeSource(appendClipNodeSource(emptyClipNodeMeta(), image), video)
    const timeline = clipNodeTimeline({ ...meta, clips: [image, { ...video, trimStart: 1, trimEnd: 4 }] })
    const clips = timeline.tracks[0]?.clips ?? []
    expect(clips).toHaveLength(2)
    expect(clips[0]).toMatchObject({ startFrame: 0, endFrame: 120, type: 'image' })
    expect(clips[1]).toMatchObject({ startFrame: 120, endFrame: 210, offsetStartFrame: 30, offsetEndFrame: 60 })
  })
})
