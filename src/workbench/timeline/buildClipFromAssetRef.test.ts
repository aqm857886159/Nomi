import { describe, expect, it } from 'vitest'
import { buildClipFromAssetRef } from './buildClipFromAssetRef'
import type { AssetKind, AssetRef } from '../assets/assetTypes'

function asset(kind: AssetKind, over: Partial<AssetRef> = {}): AssetRef {
  const extension = kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'glb'
  const relativePath = `assets/imported/media.${extension}`
  return {
    id: relativePath,
    kind,
    name: `media.${extension}`,
    renderUrl: `nomi-local://asset/p1/${relativePath}`,
    source: 'project',
    origin: { source: 'project', projectId: 'p1', relativePath },
    ...over,
  }
}

describe('buildClipFromAssetRef', () => {
  it('builds an image clip with the three-second default and thumbnail', () => {
    const clip = buildClipFromAssetRef(asset('image', { thumbUrl: 'cover.jpg' }), {
      fps: 30,
      startFrame: 60,
    })

    expect(clip).toMatchObject({
      type: 'image',
      startFrame: 60,
      frameCount: 90,
      endFrame: 150,
      thumbnailUrl: 'cover.jpg',
    })
  })

  it('uses probed video duration and falls back to five seconds', () => {
    const probed = buildClipFromAssetRef(asset('video'), {
      fps: 30,
      startFrame: 30,
      durationSeconds: 8,
    })
    const fallback = buildClipFromAssetRef(asset('video'), {
      fps: 30,
      startFrame: 0,
      durationSeconds: null,
    })

    expect(probed?.frameCount).toBe(240)
    expect(probed?.endFrame).toBe(270)
    expect(fallback?.frameCount).toBe(150)
  })

  it('uses probed audio duration and falls back to ten seconds', () => {
    const probed = buildClipFromAssetRef(asset('audio'), {
      fps: 30,
      startFrame: 0,
      durationSeconds: 12,
    })
    const fallback = buildClipFromAssetRef(asset('audio'), {
      fps: 30,
      startFrame: 0,
      durationSeconds: null,
    })

    expect(probed?.frameCount).toBe(360)
    expect(fallback?.frameCount).toBe(300)
  })

  it('preserves the stable asset identity, URL, and label', () => {
    const clip = buildClipFromAssetRef(asset('audio'), { fps: 30, startFrame: 0 })

    expect(clip?.sourceNodeId).toBe('asset:assets/imported/media.mp3')
    expect(clip?.url).toContain('media.mp3')
    expect(clip?.label).toBe('media.mp3')
  })

  it('rejects an empty URL and clamps fps/start defensively', () => {
    expect(buildClipFromAssetRef(asset('image', { renderUrl: '' }), {
      fps: 30,
      startFrame: 0,
    })).toBeNull()

    const clip = buildClipFromAssetRef(asset('image'), {
      fps: 0,
      startFrame: -10,
    })
    expect(clip?.startFrame).toBe(0)
    expect(clip?.frameCount).toBe(90)
  })

  it('keeps 3D assets out of the existing timeline', () => {
    expect(buildClipFromAssetRef(asset('model3d'), { fps: 30, startFrame: 0 })).toBeNull()
  })
})
