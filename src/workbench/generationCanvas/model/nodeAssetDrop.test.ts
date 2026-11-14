import { describe, it, expect } from 'vitest'
import {
  dropKindFromMime,
  dropKindFromFile,
  dropKindFromNodeKind,
  dropKindFromWorkspaceKind,
  resolveNodeArraySlots,
} from './nodeAssetDrop'
import type { GenerationCanvasNode } from './generationCanvasTypes'

describe('dropKindFromMime — OS 文件 MIME 路由', () => {
  it('image/video/audio 前缀 → 对应 kind', () => {
    expect(dropKindFromMime('image/png')).toBe('image')
    expect(dropKindFromMime('video/mp4')).toBe('video')
    expect(dropKindFromMime('audio/mpeg')).toBe('audio')
  })
  it('其它 / 空 → null', () => {
    expect(dropKindFromMime('application/pdf')).toBeNull()
    expect(dropKindFromMime('')).toBeNull()
    expect(dropKindFromMime(undefined)).toBeNull()
  })

  it('application/octet-stream 不覆盖文件名扩展名判定', () => {
    // macOS/Windows 对未注册的 mkv、无扩展名视频常给这个 MIME；不能因此静默丢掉拖拽。
    expect(dropKindFromFile({ type: 'application/octet-stream', name: 'clip.mkv' })).toBe('video')
  })
})

describe('dropKindFromWorkspaceKind — 文件树 payload.kind 路由', () => {
  it('已知类型 → kind；未知 / 空 → null', () => {
    expect(dropKindFromWorkspaceKind('image')).toBe('image')
    expect(dropKindFromWorkspaceKind('video')).toBe('video')
    expect(dropKindFromWorkspaceKind('file')).toBeNull()
    expect(dropKindFromWorkspaceKind(undefined)).toBeNull()
  })
})

describe('dropKindFromNodeKind — 画布节点种类 → 产物类型（连线判断 source）', () => {
  it('image 节点 → image，video 节点 → video', () => {
    expect(dropKindFromNodeKind('image')).toBe('image')
    expect(dropKindFromNodeKind('video')).toBe('video')
  })
  it('文本节点无可参考产物 → null（连线落回普通边）', () => {
    expect(dropKindFromNodeKind('text')).toBeNull()
  })
})

describe('resolveNodeArraySlots — 放进去之后现算的方式落哪一格', () => {
  const slotsOf = (meta: Record<string, unknown> | undefined, kind?: 'image' | 'video' | 'audio') => {
    const node = { id: 'n', kind: 'video', meta } as GenerationCanvasNode
    return resolveNodeArraySlots(node, { nodes: [node], edges: [] }, kind)
  }
  it('Seedance omni → image/video/audio 三槽；按 kind 命中正确 metaKey', () => {
    const meta = { modelKey: 'seedance-2', archetype: { id: 'seedance-2', modeId: 'omni' } }
    const slots = slotsOf(meta)
    expect(slots.map((s) => s.accept)).toEqual(['image', 'video', 'audio'])
    expect(slots.map((s) => s.metaKey)).toEqual(['referenceImageUrls', 'referenceVideoUrls', 'referenceAudioUrls'])
  })
  it('空节点放一张图 → 图生视频：落进节点那一份有序参考列表（按摆法进首帧），不说「放不下」；放视频 → 现算成收视频的那种', () => {
    const meta = { modelKey: 'seedance-2', archetype: { id: 'seedance-2', modeId: 'first' } }
    expect(slotsOf(meta, 'image').map((s) => s.metaKey)).toEqual(['referenceImageUrls'])
    expect(slotsOf(meta, 'video').map((s) => s.metaKey)).toEqual(['referenceVideoUrls'])
  })
  it('认不出的模型 → 无数组槽（[]，不接管拖入）', () => {
    expect(slotsOf({ modelKey: 'unknown/model' })).toEqual([])
    expect(slotsOf({})).toEqual([])
    expect(slotsOf(undefined)).toEqual([])
  })
})
