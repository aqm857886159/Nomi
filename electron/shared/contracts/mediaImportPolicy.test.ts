import { describe, expect, it } from 'vitest'

import {
  IMPORT_DISK_RESERVE_BYTES,
  LIBRARY_MEDIA_KINDS,
  MEDIA_IMPORT_SURFACES,
  acceptAttrForSurface,
  admitMediaImport,
  diskLimitBytes,
  formatMediaBytes,
  type MediaImportSurfaceId,
} from './mediaImportPolicy'

const SURFACES = Object.keys(MEDIA_IMPORT_SURFACES) as MediaImportSurfaceId[]

describe('媒体导入准入 owner', () => {
  // 这条是本 PR 的产品要求本身：用户「这地方要通用支持，不能只支持一部分」。
  it('素材库收下 Nomi 能持有的每一种媒体（图 / 视频 / 音频 / 3D）', () => {
    for (const kind of LIBRARY_MEDIA_KINDS) {
      expect(admitMediaImport('asset-library', { kind, sizeBytes: 1024 }, null).ok).toBe(true)
    }
  })

  it('任何面都不许比素材库宽——素材库是「Nomi 存得下什么」的全集', () => {
    for (const id of SURFACES) {
      for (const kind of MEDIA_IMPORT_SURFACES[id].kinds) {
        // 附件面另有文档/文本（模型读得懂的非媒体），不算「比素材库宽」。
        if (kind === 'document' || kind === 'text') continue
        expect(LIBRARY_MEDIA_KINDS, `${id} 的 ${kind}`).toContain(kind)
      }
    }
  })

  it('比素材库窄的面必须写明领域理由——「还没做」是欠账不是约束', () => {
    for (const id of SURFACES) {
      const surface = MEDIA_IMPORT_SURFACES[id]
      const narrower = LIBRARY_MEDIA_KINDS.some((kind) => !surface.kinds.includes(kind))
      if (!narrower) continue
      expect(surface.narrowedBecause, `${id} 收窄了却没写理由`).toBeTruthy()
      expect(surface.narrowedBecause).not.toMatch(/还没做|暂不支持|TODO|待实现/)
    }
  })

  it('硬上限必须附理由（磁盘之外的上限只能来自下游硬约束）', () => {
    for (const id of SURFACES) {
      const surface = MEDIA_IMPORT_SURFACES[id]
      if (surface.hardCapBytes === null) continue
      expect(surface.hardCapBecause, `${id} 有硬上限却没写理由`).toBeTruthy()
    }
  })

  it('画布不收音频，但理由是「没有落点」而不是「不支持」', () => {
    const admission = admitMediaImport('generation-canvas', { kind: 'audio', sizeBytes: 1 }, null)
    // 用真的 if 收窄（不是 expect）：expect 不改变类型，而「这一支独有的字段」正是要断言的东西。
    if (admission.ok) throw new Error('画布不该收下音频')
    if (admission.reason !== 'unsupported-kind') throw new Error(`reason=${admission.reason}`)
    expect(admission.narrowedBecause).toContain('落点')
  })
})

describe('上限从磁盘派生', () => {
  it('容量未知 → 不设限（不拿猜出来的数字拦人，交给落盘时的真实错误）', () => {
    expect(diskLimitBytes(null, 'video')).toBeNull()
    expect(admitMediaImport('asset-library', { kind: 'video', sizeBytes: 8e9 }, null).ok).toBe(true)
  })

  it('视频按两份算（原片 + 可能的可播产物），图片按一份', () => {
    const capacity = { freeBytes: IMPORT_DISK_RESERVE_BYTES + 1000 }
    expect(diskLimitBytes(capacity, 'video')).toBe(500)
    expect(diskLimitBytes(capacity, 'image')).toBe(1000)
  })

  it('盘已经满到预留线以下 → 上限 0，一个字节都不收', () => {
    expect(diskLimitBytes({ freeBytes: 10 }, 'image')).toBe(0)
  })

  it('装不下时拒绝理由带得出数字（文件多大 / 还剩多少）', () => {
    const admission = admitMediaImport(
      'asset-library',
      { kind: 'video', sizeBytes: 4000 },
      { freeBytes: IMPORT_DISK_RESERVE_BYTES + 1000 },
    )
    if (admission.ok) throw new Error('装不下就不该放行')
    if (admission.reason !== 'no-disk-space') throw new Error(`reason=${admission.reason}`)
    expect(admission.fileBytes).toBe(4000)
    expect(admission.freeBytes).toBe(IMPORT_DISK_RESERVE_BYTES + 1000)
  })

  it('硬上限先于磁盘判（它是下游约束，盘再大也放不进去）', () => {
    const cap = MEDIA_IMPORT_SURFACES['agent-composer'].hardCapBytes ?? 0
    const admission = admitMediaImport('agent-composer', { kind: 'image', sizeBytes: cap + 1 }, null)
    if (admission.ok) throw new Error('超过硬上限就不该放行')
    if (admission.reason !== 'over-hard-cap') throw new Error(`reason=${admission.reason}`)
    expect(admission.capBytes).toBe(cap)
    expect(admission.because).toBeTruthy()
  })
})

describe('accept 属性与文案', () => {
  it('accept 从面的 kinds 派生（通配 + 显式扩展名）', () => {
    const accept = acceptAttrForSurface('generation-canvas')
    expect(accept).toContain('image/*')
    expect(accept).toContain('video/*')
    expect(accept).not.toContain('audio/*')
    expect(accept).toContain('.mkv') // 扩展名也要列：macOS 对纯通配常把文件灰掉
  })

  it('素材库的 accept 收得下音频与 3D', () => {
    const accept = acceptAttrForSurface('asset-library')
    expect(accept).toContain('audio/*')
    expect(accept).toContain('.glb')
  })

  it('体积文案带单位与数字（「过大」不可行动）', () => {
    expect(formatMediaBytes(1380939031)).toBe('1.3GB')
    expect(formatMediaBytes(24 * 1024 * 1024)).toBe('24.0MB')
    expect(formatMediaBytes(2048)).toBe('2KB')
  })
})
