import { describe, expect, it } from 'vitest'
import { filterImportableAudioFiles, isAudioFile } from './importAudioToLibrary'
import { IMPORT_DISK_RESERVE_BYTES } from '../../../electron/shared/contracts/mediaImportPolicy'

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
    const result = filterImportableAudioFiles([a, dup, b], null)
    expect(result.files).toHaveLength(2)
    expect(result.skippedDuplicateCount).toBe(1)
  })

  // 上限不再是常量：磁盘剩多少就能收多大（IMPORT_DISK_RESERVE_BYTES 之外的部分，音频占一份）。
  it('装不下的文件按磁盘余量拒收，理由带数字', () => {
    const capacity = { freeBytes: IMPORT_DISK_RESERVE_BYTES + 4096 }
    const big = makeFile('big.flac', 'audio/flac', 8192)
    const ok = makeFile('ok.mp3', 'audio/mpeg', 1024)
    const result = filterImportableAudioFiles([big, ok], capacity)
    expect(result.files).toHaveLength(1)
    expect(result.files[0].name).toBe('ok.mp3')
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].fileName).toBe('big.flac')
    expect(result.rejected[0].rejection.reason).toBe('no-disk-space')
  })

  it('磁盘余量未知（量不到）→ 不设限，不拿猜出来的数字拦人', () => {
    const huge = makeFile('huge.wav', 'audio/wav', 8 * 1024 * 1024 * 1024)
    const result = filterImportableAudioFiles([huge], null)
    expect(result.files).toHaveLength(1)
    expect(result.rejected).toHaveLength(0)
  })
})
