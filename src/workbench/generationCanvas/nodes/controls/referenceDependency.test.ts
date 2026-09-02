// 跨槽依赖判定（slot.requiresAnyOf）的单元测试。
// 覆盖的真实缺陷：Seedance 2.0 omni 只放一段参考音频 → 此前 canRunGenerationNode 只问「任一数组槽非空」
// 判定可生成 → 发出去被服务商拒（方舟「不支持"纯音频"输入」）。
import { describe, expect, it } from 'vitest'
import { filledReferenceKinds, nodeUnmetReferenceDependency, unmetReferenceDependency } from './referenceDependency'
import { SEEDANCE_2_APIMART_ARCHETYPE, SEEDANCE_2_5_ARCHETYPE } from '../../../../../electron/shared/videoCapabilities'
import type { ArchetypeMode, ArchetypeReferenceSlotKind } from '../../../../config/modelArchetypes'

const omniOf = (archetype: { modes: ArchetypeMode[] }, id: string) =>
  archetype.modes.find((mode) => mode.id === id) as ArchetypeMode

const OMNI_2_0 = omniOf(SEEDANCE_2_APIMART_ARCHETYPE, 'omni')
const OMNI_2_5 = omniOf(SEEDANCE_2_5_ARCHETYPE, 'omni')
const metaFor = (modeId: string, extra: Record<string, unknown> = {}) => ({
  archetype: { id: SEEDANCE_2_APIMART_ARCHETYPE.id, modeId },
  ...extra,
})

describe('unmetReferenceDependency', () => {
  it('flags audio-only as unmet, naming the slot and its companions', () => {
    const unmet = unmetReferenceDependency(OMNI_2_0, new Set<ArchetypeReferenceSlotKind>(['audio_ref']))
    expect(unmet).not.toBeNull()
    expect(unmet?.slotLabel).toBe('参考音频')
    expect(unmet?.companionLabels).toEqual(['角色参考', '参考视频'])
  })

  it.each([
    ['an image', 'image_ref' as ArchetypeReferenceSlotKind],
    ['a video', 'video_ref' as ArchetypeReferenceSlotKind],
  ])('is satisfied when audio is accompanied by %s (析取：任一即可)', (_label, companion) => {
    expect(unmetReferenceDependency(OMNI_2_0, new Set<ArchetypeReferenceSlotKind>(['audio_ref', companion]))).toBeNull()
  })

  it('says nothing when the dependent slot itself is empty', () => {
    // 没放音频 → 依赖无从谈起；只放图片是完全合法的 omni 用法，不能因为「有依赖声明」就报。
    expect(unmetReferenceDependency(OMNI_2_0, new Set(['image_ref']))).toBeNull()
    expect(unmetReferenceDependency(OMNI_2_0, new Set())).toBeNull()
  })

  it('lets 2.5 run on audio alone — the docs lifted that limit', () => {
    expect(unmetReferenceDependency(OMNI_2_5, new Set(['audio_ref']))).toBeNull()
  })

  it('is a no-op for modes that declare no dependency at all', () => {
    const i2v = omniOf(SEEDANCE_2_APIMART_ARCHETYPE, 'i2v')
    expect(unmetReferenceDependency(i2v, new Set(['image_ref']))).toBeNull()
  })
})

describe('filledReferenceKinds', () => {
  it('counts manual uploads stored in meta', () => {
    const filled = filledReferenceKinds(metaFor('omni', { referenceAudioUrls: ['nomi-local://a.mp3'] }), OMNI_2_0)
    expect([...filled]).toEqual(['audio_ref'])
  })

  it('counts references arriving over canvas edges, not just meta uploads', () => {
    // 关键：用户**连了**一个图片节点进来，伴随要求就该算满足。只读 meta 会把连线来的图当不存在 → 误拦。
    const filled = filledReferenceKinds(metaFor('omni', { referenceAudioUrls: ['a.mp3'] }), OMNI_2_0, {
      referenceImages: ['https://example.com/from-edge.png'],
    })
    expect(filled.has('image_ref')).toBe(true)
    expect(filled.has('audio_ref')).toBe(true)
  })

  it('ignores empty strings and non-array junk in meta', () => {
    const filled = filledReferenceKinds(
      metaFor('omni', { referenceAudioUrls: ['  '], referenceImageUrls: 'not-an-array' }),
      OMNI_2_0,
    )
    expect([...filled]).toEqual([])
  })
})

describe('nodeUnmetReferenceDependency', () => {
  it('blocks audio-only on 2.0 and clears once an edge-borne image arrives', () => {
    const meta = metaFor('omni', { referenceAudioUrls: ['nomi-local://vo.mp3'] })
    expect(nodeUnmetReferenceDependency(meta, SEEDANCE_2_APIMART_ARCHETYPE)?.slotLabel).toBe('参考音频')
    expect(
      nodeUnmetReferenceDependency(meta, SEEDANCE_2_APIMART_ARCHETYPE, { referenceImages: ['https://x/1.png'] }),
    ).toBeNull()
  })

  it('returns null when the node has no archetype (不接管无档案模型)', () => {
    expect(nodeUnmetReferenceDependency({}, null)).toBeNull()
  })

  it('does not leak the dependency across modes — t2v has no slots at all', () => {
    // 参考值全局持久（切模式不清空），所以残留的 referenceAudioUrls 不能让 t2v 被误判成"缺伴随"。
    const meta = metaFor('t2v', { referenceAudioUrls: ['nomi-local://vo.mp3'] })
    expect(nodeUnmetReferenceDependency(meta, SEEDANCE_2_APIMART_ARCHETYPE)).toBeNull()
  })
})
