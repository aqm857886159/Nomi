import { describe, expect, it } from 'vitest'
import type { AssetRef } from '../../assets/assetTypes'
import { appendClipNodeSource, clipNodeSourceFromAsset, emptyClipNodeMeta, type ClipNodeSource } from './clipNodeModel'
import {
  moveClipNode,
  removeClipNode,
  resizeClipNode,
  splitClipNode,
  clipNodeTimelineFromMeta,
  duplicateClipNode,
  insertClipNodeSourceAt,
} from './clipNodeSequence'

const asset = (kind: 'image' | 'video', id: string): AssetRef => ({
  id,
  kind,
  name: id,
  renderUrl: `nomi-local://asset/${id}`,
  source: 'project',
  origin: { source: 'project', projectId: 'p', relativePath: id },
})

function seedMeta() {
  const image = clipNodeSourceFromAsset(asset('image', 'image-a'))!
  const video = clipNodeSourceFromAsset(asset('video', 'video-b'))!
  return appendClipNodeSource(appendClipNodeSource(emptyClipNodeMeta(), image), video)
}

describe('clip node sequence editing', () => {
  it('keeps image and video in one ordered visual sequence', () => {
    const timeline = clipNodeTimelineFromMeta(seedMeta())

    expect(timeline.tracks).toHaveLength(1)
    expect(timeline.tracks[0]?.clips.map((clip) => clip.type)).toEqual(['image', 'video'])
    expect(timeline.tracks[0]?.clips[1]?.startFrame).toBe(timeline.tracks[0]?.clips[0]?.endFrame)
  })

  it('splits a video and preserves source offsets for both resulting pieces', () => {
    const result = splitClipNode(seedMeta(), 'clip-video-b', 180)
    const clips = clipNodeTimelineFromMeta(result).tracks[0]?.clips ?? []

    expect(clips).toHaveLength(3)
    expect(clips[1]).toMatchObject({ id: 'clip-video-b', endFrame: 180, offsetEndFrame: 120 })
    expect(clips[2]).toMatchObject({ startFrame: 180, offsetStartFrame: 60, offsetEndFrame: 0 })
    expect(result.clips.map((clip) => clip.id)).toEqual(['image-a', 'video-b', 'video-b-split'])
  })

  it('moves a clip through the same legal-placement rule as the main timeline', () => {
    const result = moveClipNode(seedMeta(), 'clip-video-b', 360)
    const clips = clipNodeTimelineFromMeta(result).tracks[0]?.clips ?? []

    expect(clips.find((clip) => clip.id === 'clip-video-b')?.startFrame).toBe(360)
    expect(clips[0]?.endFrame).toBeLessThanOrEqual(clips[1]?.startFrame ?? 0)
  })

  it('resizes the selected edge without changing the source frame count', () => {
    const result = resizeClipNode(seedMeta(), 'clip-video-b', 'left', 30)
    const clip = clipNodeTimelineFromMeta(result).tracks[0]?.clips.find((candidate) => candidate.id === 'clip-video-b')

    expect(clip).toMatchObject({ startFrame: 150, offsetStartFrame: 30, frameCount: 180 })
    expect(clip?.endFrame).toBe(300)
  })

  it('removes a clip and compacts the following clip to the previous end', () => {
    const result = removeClipNode(seedMeta(), 'clip-image-a')
    const clips = clipNodeTimelineFromMeta(result).tracks[0]?.clips ?? []

    expect(clips).toHaveLength(1)
    expect(clips[0]).toMatchObject({ id: 'clip-video-b', startFrame: 0 })
    expect(result.excludedSourceNodeIds).toEqual(['image-a'])
  })

  it('duplicates a clip as a new editable instance', () => {
    const result = duplicateClipNode(seedMeta(), 'clip-image-a')
    expect(result.clips.map((clip) => clip.id)).toEqual(['image-a', 'video-b', 'image-a-copy'])
    expect(clipNodeTimelineFromMeta(result).tracks[0]?.clips[2]).toMatchObject({ sourceNodeId: 'image-a' })
  })
})

describe('insertClipNodeSourceAt', () => {
  const src = (id: string, seconds: number): ClipNodeSource => ({ id, type: 'image', label: id, url: `u/${id}`, durationSeconds: seconds, trimStart: 0, trimEnd: seconds })
  const base = { nodeRole: 'clip' as const, sourceNodeIds: ['a', 'b'], clips: [src('a', 2), src('b', 2)] }
  const starts = (meta: ReturnType<typeof insertClipNodeSourceAt>) => clipNodeTimelineFromMeta(meta).tracks[0].clips.map((c) => `${c.id}:${c.startFrame}`)

  it('inserts at a clip edge and pushes later clips back by the inserted length', () => {
    expect(starts(insertClipNodeSourceAt(base, src('n', 1), 60))).toEqual(['clip-a:0', 'clip-n:60', 'clip-b:90'])
  })

  it('appends in empty space without moving anything', () => {
    expect(starts(insertClipNodeSourceAt(base, src('n', 1), 200))).toEqual(['clip-a:0', 'clip-b:60', 'clip-n:200'])
  })

  it('pushes later clips only by the overlap, not by the whole length', () => {
    const gap = insertClipNodeSourceAt(base, src('x', 1), 150)
    expect(starts(insertClipNodeSourceAt(gap, src('n', 1), 130))).toEqual(['clip-a:0', 'clip-b:60', 'clip-n:130', 'clip-x:160'])
  })

  it('lets the same material be dropped twice with distinct instance ids', () => {
    const twice = insertClipNodeSourceAt(insertClipNodeSourceAt(base, src('n', 1), 200), src('n', 1), 300)
    expect(twice.clips.map((c) => c.id)).toEqual(['a', 'b', 'n', 'n~2'])
    expect(twice.clips[3].sourceNodeId).toBe('n')
  })
})
