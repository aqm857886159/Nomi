import { describe, expect, it } from 'vitest'
import { assetsForLibraryDrag, classifyUploadFiles } from './AssetLibraryPanel'
import type { AssetRef } from './assetTypes'

function makeFile(name: string, type: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type, lastModified: 1 })
}

describe('classifyUploadFiles', () => {
  it('routes image/video to media, audio to audio (by MIME)', () => {
    const r = classifyUploadFiles([
      makeFile('a.png', 'image/png'),
      makeFile('b.mp4', 'video/mp4'),
      makeFile('c.mp3', 'audio/mpeg'),
    ])
    expect(r.mediaFiles.map((f) => f.name)).toEqual(['a.png', 'b.mp4'])
    expect(r.audioFiles.map((f) => f.name)).toEqual(['c.mp3'])
    expect(r.unsupported).toHaveLength(0)
  })

  it('falls back to extension when MIME is empty (Gap B: empty-MIME image/video no longer dropped)', () => {
    const r = classifyUploadFiles([
      makeFile('photo.jpg', ''),
      makeFile('movie.mov', ''),
      makeFile('voice.flac', ''),
    ])
    expect(r.mediaFiles.map((f) => f.name)).toEqual(['photo.jpg', 'movie.mov'])
    expect(r.audioFiles.map((f) => f.name)).toEqual(['voice.flac'])
    expect(r.unsupported).toHaveLength(0)
  })

  it('routes the newly-supported audio formats to audio', () => {
    const r = classifyUploadFiles([
      makeFile('a.m4a', 'audio/mp4'),
      makeFile('b.aac', 'audio/aac'),
      makeFile('c.ogg', 'audio/ogg'),
    ])
    expect(r.audioFiles).toHaveLength(3)
    expect(r.mediaFiles).toHaveLength(0)
  })

  it('collects unsupported files instead of silently swallowing them', () => {
    const r = classifyUploadFiles([
      makeFile('doc.pdf', 'application/pdf'),
      makeFile('weird.xyz', ''),
    ])
    expect(r.unsupported.map((f) => f.name)).toEqual(['doc.pdf', 'weird.xyz'])
    expect(r.mediaFiles).toHaveLength(0)
    expect(r.audioFiles).toHaveLength(0)
  })
})

describe('assetsForLibraryDrag', () => {
  const assets: AssetRef[] = ['a', 'b', 'c'].map((id) => ({
    id,
    kind: 'image',
    name: `${id}.png`,
    renderUrl: `nomi-local://project/assets/${id}.png`,
    source: 'project',
    origin: { source: 'project', projectId: 'project-1', relativePath: `assets/${id}.png` },
  }))

  it('drags the whole selection and keeps the grabbed asset first', () => {
    expect(assetsForLibraryDrag(assets, new Set(['a', 'c']), assets[2]).map((asset) => asset.id)).toEqual(['c', 'a'])
  })

  it('drags only the grabbed asset when it is outside the selection', () => {
    expect(assetsForLibraryDrag(assets, new Set(['a', 'c']), assets[1]).map((asset) => asset.id)).toEqual(['b'])
  })
})
