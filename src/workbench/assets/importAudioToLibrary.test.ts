import { describe, expect, it } from 'vitest'
import {
  ASSET_LIBRARY_AUDIO_IMPORT_MAX_BYTES,
  filterImportableAudioFiles,
  isAudioFile,
} from './importAudioToLibrary'

function makeFile(name: string, type: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type, lastModified: 1 })
}

describe('isAudioFile', () => {
  it('recognizes audio by MIME', () => {
    expect(isAudioFile(makeFile('a.mp3', 'audio/mpeg'))).toBe(true)
    expect(isAudioFile(makeFile('a.wav', 'audio/wav'))).toBe(true)
  })

  it('rejects non-audio MIME (image/video) even with audio-looking name', () => {
    expect(isAudioFile(makeFile('song.mp3', 'video/mp4'))).toBe(false)
    expect(isAudioFile(makeFile('cover.png', 'image/png'))).toBe(false)
  })

  it('falls back to extension when MIME is empty', () => {
    expect(isAudioFile(makeFile('voice.m4a', ''))).toBe(true)
    expect(isAudioFile(makeFile('clip.mp4', ''))).toBe(false)
  })
})

describe('filterImportableAudioFiles', () => {
  it('dedupes by name+type+size', () => {
    const a = makeFile('a.mp3', 'audio/mpeg', 2048)
    const dup = makeFile('a.mp3', 'audio/mpeg', 2048)
    const b = makeFile('b.wav', 'audio/wav', 2048)
    const result = filterImportableAudioFiles([a, dup, b])
    expect(result.files).toHaveLength(2)
    expect(result.skippedDuplicateCount).toBe(1)
  })

  it('skips files over the size cap', () => {
    const big = makeFile('big.flac', 'audio/flac', ASSET_LIBRARY_AUDIO_IMPORT_MAX_BYTES + 1)
    const ok = makeFile('ok.mp3', 'audio/mpeg', 1024)
    const result = filterImportableAudioFiles([big, ok])
    expect(result.files).toHaveLength(1)
    expect(result.files[0].name).toBe('ok.mp3')
    expect(result.skippedTooLargeCount).toBe(1)
  })
})
