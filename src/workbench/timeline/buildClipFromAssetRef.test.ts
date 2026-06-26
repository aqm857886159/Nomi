import { describe, expect, it } from 'vitest'
import { buildAudioClipFromAssetRef } from './buildClipFromAssetRef'
import type { AssetRef } from '../assets/assetTypes'

function audioAsset(over: Partial<AssetRef> = {}): AssetRef {
  return {
    id: 'assets/imported/2026-06-25/song.mp3',
    kind: 'audio',
    name: 'song.mp3',
    renderUrl: 'nomi-local://asset/p1/assets/imported/2026-06-25/song.mp3',
    source: 'project',
    origin: { source: 'project', projectId: 'p1', relativePath: 'assets/imported/2026-06-25/song.mp3' },
    ...over,
  }
}

describe('buildAudioClipFromAssetRef', () => {
  it('builds an audio clip with probed duration', () => {
    const clip = buildAudioClipFromAssetRef(audioAsset(), { fps: 30, startFrame: 60, durationSeconds: 12 })
    expect(clip).not.toBeNull()
    expect(clip?.type).toBe('audio')
    expect(clip?.startFrame).toBe(60)
    expect(clip?.frameCount).toBe(360) // 12s * 30fps
    expect(clip?.endFrame).toBe(420)
    expect(clip?.url).toContain('song.mp3')
    expect(clip?.sourceNodeId).toBe('asset:assets/imported/2026-06-25/song.mp3')
  })

  it('falls back to default duration when probe failed (null)', () => {
    const clip = buildAudioClipFromAssetRef(audioAsset(), { fps: 30, startFrame: 0, durationSeconds: null })
    expect(clip?.frameCount).toBe(300) // 10s default * 30fps
  })

  it('rejects non-audio assets', () => {
    const clip = buildAudioClipFromAssetRef(audioAsset({ kind: 'video' }), { fps: 30, startFrame: 0 })
    expect(clip).toBeNull()
  })

  it('rejects assets without a render url', () => {
    const clip = buildAudioClipFromAssetRef(audioAsset({ renderUrl: '' }), { fps: 30, startFrame: 0, durationSeconds: 5 })
    expect(clip).toBeNull()
  })

  it('clamps fps and startFrame defensively', () => {
    const clip = buildAudioClipFromAssetRef(audioAsset(), { fps: 0, startFrame: -10, durationSeconds: 2 })
    expect(clip?.startFrame).toBe(0)
    expect(clip?.frameCount).toBe(60) // fps clamped to 30, 2s -> 60
  })
})
