import { describe, expect, it } from 'vitest'
import { buildArchetypeWireDefaults, buildWireDefaultsFor, normalizeGeneratedText } from './gen-archetype-wire-defaults'
import type { ModelArchetype } from '../src/config/modelArchetypes/types'

describe('archetype defaults generation', () => {
  it('treats Windows and POSIX line endings as the same generated content', () => {
    expect(normalizeGeneratedText('first\r\nsecond\r\n')).toBe('first\nsecond\n')
  })
})

// 只填生成器真正读的字段（id/family/label/kind/modes/defaultModeId/transportTaskKind/variants），
// 其余能力字段（intent/slots/hint/vendorTerm/promptRequired…）用最小占位；`as` 收口给类型。
type PartialMode = Partial<ModelArchetype['modes'][number]> & { id: string }
const mode = (m: PartialMode): ModelArchetype['modes'][number] =>
  ({ intent: 'text', vendorTerm: '', hint: '', slots: [], params: [], promptRequired: true, ...m } as ModelArchetype['modes'][number])
const archetype = (a: Partial<ModelArchetype> & Pick<ModelArchetype, 'id' | 'defaultModeId' | 'transportTaskKind' | 'modes'>): ModelArchetype =>
  ({ family: 'test', label: a.id, kind: 'video', ...a } as ModelArchetype)

// 回归测试：同一 taskKind 多模式，各模式默认**互不污染**（修 minimax-h3 text_to_video 被 ref 盖住的 bug）。
// 旧生成器「遍历顺序里最后一个模式胜」→ 后声明的模式默默覆盖前面的。现按「主模式」确定性收口。
describe('same-taskKind multi-mode collapse（主模式收口，不互相污染）', () => {
  it('判据①：defaultModeId 落在该 taskKind → 用它，哪怕它不是最后声明的模式', () => {
    // 三模式全落同一档案级 text_to_video；default=t2v 排最前、"污染源" ref 排最后。
    const arch = archetype({
      id: 'fake-t2v-default',
      defaultModeId: 't2v',
      transportTaskKind: 'text_to_video',
      modes: [
        mode({ id: 't2v', modelEnum: 'fake/text-to-video', params: [{ key: 'aspect_ratio', label: '', type: 'select', options: [], defaultValue: '16:9' }] }),
        mode({ id: 'i2v', modelEnum: 'fake/image-to-video', params: [{ key: 'duration', label: '', type: 'number', options: [], defaultValue: 6 }] }),
        mode({ id: 'ref', modelEnum: 'fake/reference-to-video', params: [{ key: 'aspect_ratio', label: '', type: 'select', options: [], defaultValue: 'adaptive' }] }),
      ],
    })
    const out = buildWireDefaultsFor([arch])
    // 主模式 = t2v（default），不是最后声明的 ref。
    expect(out['fake-t2v-default'].text_to_video['*']).toEqual({ aspect_ratio: '16:9', model: 'fake/text-to-video' })
    // ref 的 adaptive + reference-to-video 不得泄漏进来（这正是被修的 bug）。
    expect(out['fake-t2v-default'].text_to_video['*'].aspect_ratio).not.toBe('adaptive')
    expect(out['fake-t2v-default'].text_to_video['*'].model).not.toBe('fake/reference-to-video')
  })

  it('判据②：默认模式在别的 taskKind → 该 taskKind 用首个声明的模式（保序、确定）', () => {
    // 档案默认是 t2v（text_to_video）；三个 i2v 族模式共享 image_to_video，无一是 defaultModeId。
    const arch = archetype({
      id: 'fake-i2v-group',
      defaultModeId: 't2v',
      transportTaskKind: 'text_to_video',
      modes: [
        mode({ id: 't2v', params: [{ key: 'aspect_ratio', label: '', type: 'select', options: [], defaultValue: '16:9' }] }),
        mode({ id: 'first', transportTaskKind: 'image_to_video', fixedParams: { generation_type: 'frame' }, params: [{ key: 'duration', label: '', type: 'number', options: [], defaultValue: 5 }] }),
        mode({ id: 'firstlast', transportTaskKind: 'image_to_video', fixedParams: { generation_type: 'frame' } }),
        mode({ id: 'omni', transportTaskKind: 'image_to_video', params: [{ key: 'aspect_ratio', label: '', type: 'select', options: [], defaultValue: 'adaptive' }] }),
      ],
    })
    const out = buildWireDefaultsFor([arch])
    // image_to_video 主模式 = 首个声明的 'first'，不是最后的 'omni'。
    expect(out['fake-i2v-group'].image_to_video['*']).toEqual({ generation_type: 'frame', duration: 5 })
    // omni 的 adaptive 不得污染 i2v 默认。
    expect(out['fake-i2v-group'].image_to_video['*'].aspect_ratio).toBeUndefined()
    // 且各 taskKind 互不干扰：t2v 桶保留自己的 16:9。
    expect(out['fake-i2v-group'].text_to_video['*'].aspect_ratio).toBe('16:9')
  })

  it('vendorParams 分桶在主模式收口后仍各自独立', () => {
    const arch = archetype({
      id: 'fake-vendor-split',
      defaultModeId: 't2v',
      transportTaskKind: 'text_to_video',
      modes: [
        mode({
          id: 't2v',
          params: [{ key: 'duration', label: '', type: 'number', options: [], defaultValue: 5 }],
          vendorParams: { apimart: [{ key: 'duration', label: '', type: 'number', options: [], defaultValue: 5 }] },
        }),
      ],
    })
    const out = buildWireDefaultsFor([arch])
    expect(out['fake-vendor-split'].text_to_video['*'].duration).toBe(5)
    expect(out['fake-vendor-split'].text_to_video.apimart.duration).toBe(5)
  })

  it('真实目录锚点：minimax-h3 text_to_video 兜底 = t2v 模式（16:9 + text-to-video），不是 ref 的 adaptive', () => {
    const out = buildArchetypeWireDefaults()
    expect(out['minimax-h3'].text_to_video['*']).toMatchObject({
      aspect_ratio: '16:9',
      model: 'minimax-h3/text-to-video',
    })
    expect(out['minimax-h3'].text_to_video['*'].aspect_ratio).not.toBe('adaptive')
    expect(out['minimax-h3'].text_to_video['*'].model).not.toBe('minimax-h3/reference-to-video')
    // happyhorse 同病（edit 模式曾胜出）：现为 t2v。
    expect(out['happyhorse'].text_to_video['*']).toMatchObject({ model: 'happyhorse/text-to-video' })
  })
})
