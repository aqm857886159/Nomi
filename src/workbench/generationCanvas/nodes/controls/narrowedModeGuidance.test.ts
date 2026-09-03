import { describe, it, expect } from 'vitest'
import {
  candidatesForArchetype,
  hiddenModesForChannel,
  isNarrowedModeGuidanceDismissed,
  referencesSectionIsEmpty,
  resolveNarrowedModeGuidance,
  type ModeGuidanceCandidate,
} from './narrowedModeGuidance'
import type { ArchetypeMode, ModelArchetype } from '../../../../config/modelArchetypes'
import type { ModelOption } from '../../../../config/models'
import type { ModeChannelBody } from './channelModeReach'

// 最小档案：文生（无槽，永不藏）+ 首尾帧（声明槽，可被藏）。
const mode = (id: string, vendorTerm: string, slots: ArchetypeMode['slots']): ArchetypeMode =>
  ({ id, vendorTerm, hint: '', slots, params: [] }) as unknown as ArchetypeMode

const T2V = mode('t2v', '文生视频', [])
// 槽 kind 与 inputKey 用真表（electron/catalog/referenceReachability 的 DEFAULT_SLOT_INPUT_KEY）：
// first_frame→first_frame_url、last_frame→last_frame_url、image_ref→reference_image_urls。
// 自造 kind 会让 modeSlotReach 恒判 none，测试就测不到真判据了。
const FLF = mode('flf', '首尾帧', [{ kind: 'first_frame' }, { kind: 'last_frame' }] as ArchetypeMode['slots'])
const OMNI = mode('omni', '全能参考', [{ kind: 'image_ref' }] as ArchetypeMode['slots'])

const archetype = { id: 'seedance2', defaultModeId: 't2v', modes: [T2V, FLF, OMNI] } as unknown as ModelArchetype

/** 一条「首尾帧 + 全能参考都发得出」的 body：三个槽的 inputKey 都被 body 引用。 */
const RICH_BODY: ModeChannelBody = {
  body: {
    first_frame_url: '{{request.params.first_frame_url}}',
    last_frame_url: '{{request.params.last_frame_url}}',
    reference_image_urls: '{{request.params.reference_image_urls}}',
  },
  wireParamKeys: ['first_frame_url', 'last_frame_url', 'reference_image_urls'],
}

describe('hiddenModesForChannel — 三态必须分开', () => {
  it('null = 桶已知但没有这条模式的线缆 → 藏（该提示）', () => {
    const hidden = hiddenModesForChannel(archetype, (m) => (m.id === 't2v' ? RICH_BODY : null))
    expect(hidden.map((m) => m.id)).toEqual(['flf', 'omni'])
  })

  it('undefined = 查不到 → fail-open 不藏，所以也不该有提示', () => {
    const hidden = hiddenModesForChannel(archetype, () => undefined)
    expect(hidden).toEqual([])
  })

  it('body 发得出 → 不藏', () => {
    const hidden = hiddenModesForChannel(archetype, () => RICH_BODY)
    expect(hidden).toEqual([])
  })
})

describe('isNarrowedModeGuidanceDismissed — 只认当前节点 meta 的明确标记', () => {
  it('true 才关闭提示，避免旧数据或其他 meta 值误隐藏', () => {
    expect(isNarrowedModeGuidanceDismissed({ narrowedModeGuidanceDismissed: true })).toBe(true)
    expect(isNarrowedModeGuidanceDismissed({ narrowedModeGuidanceDismissed: 'true' })).toBe(false)
    expect(isNarrowedModeGuidanceDismissed({})).toBe(false)
  })
})

describe('resolveNarrowedModeGuidance', () => {
  const kie: ModeGuidanceCandidate = { value: 'seedance2', vendor: 'kie', vendorName: 'KIE' }

  it('有别家能全做 → switch，带上目标渠道', () => {
    const guidance = resolveNarrowedModeGuidance({
      archetype,
      bodyForMode: (m) => (m.id === 't2v' ? RICH_BODY : null),
      candidates: [kie],
      bodyForCandidate: () => RICH_BODY,
    })
    expect(guidance).toEqual({
      kind: 'switch',
      hiddenModeTerms: ['首尾帧', '全能参考'],
      target: kie,
    })
  })

  it('没有别家能做 → none，不给按钮', () => {
    const guidance = resolveNarrowedModeGuidance({
      archetype,
      bodyForMode: (m) => (m.id === 't2v' ? RICH_BODY : null),
      candidates: [kie],
      bodyForCandidate: () => null,
    })
    expect(guidance).toEqual({ kind: 'none', hiddenModeTerms: ['首尾帧', '全能参考'] })
  })

  it('只做得了一半的家不配当落点 → none（换过去还是缺，等于再骗一次）', () => {
    const guidance = resolveNarrowedModeGuidance({
      archetype,
      bodyForMode: (m) => (m.id === 't2v' ? RICH_BODY : null),
      candidates: [kie],
      // 首尾帧行、全能参考不行（后者的 body 压根不引用 reference_image_urls）
      bodyForCandidate: (_c, m) => (m.id === 'flf' ? RICH_BODY : null),
    })
    expect(guidance).toEqual({ kind: 'none', hiddenModeTerms: ['首尾帧', '全能参考'] })
  })

  it('查不到（undefined，fail-open）→ 没有被藏的模式 → 完全不提示', () => {
    const guidance = resolveNarrowedModeGuidance({
      archetype,
      bodyForMode: () => undefined,
      candidates: [kie],
      bodyForCandidate: () => RICH_BODY,
    })
    expect(guidance).toBeNull()
  })

  it('一个模式都没被藏 → null', () => {
    const guidance = resolveNarrowedModeGuidance({
      archetype,
      bodyForMode: () => RICH_BODY,
      candidates: [kie],
      bodyForCandidate: () => RICH_BODY,
    })
    expect(guidance).toBeNull()
  })
})

describe('referencesSectionIsEmpty — 样张 D 的回归锁', () => {
  const bare = {
    hasImageUrlSlots: false,
    hasArraySlots: false,
    hasSourceVideoSlot: false,
    showModeBar: false,
    showNoPromptNote: false,
    hasModeGuidance: false,
  }

  it('什么都没有 → 空返回（既有行为不变）', () => {
    expect(referencesSectionIsEmpty(bare)).toBe(true)
  })

  it('模式栏整条不显示、也没有任何槽，但有指路提示 → **不能**空返回', () => {
    // 这就是样张 D：只剩 1 个模式 → showModeBar=false，用户今天什么都看不到。
    // 提示必须独立于模式栏活下来，否则最需要说话的场合反而哑了。
    expect(referencesSectionIsEmpty({ ...bare, hasModeGuidance: true })).toBe(false)
  })

  it('有模式栏时照旧不空返回', () => {
    expect(referencesSectionIsEmpty({ ...bare, showModeBar: true })).toBe(false)
  })
})

describe('candidatesForArchetype', () => {
  const option = (vendor: string, value: string, vendorName?: string): ModelOption =>
    ({ vendor, value, vendorName, label: value }) as ModelOption

  it('挑同档案身份的别家，排除当前那条，并带上显示名', () => {
    const candidates = candidatesForArchetype({
      options: [
        option('runway', 'seedance2', 'Runway'),
        option('kie', 'seedance2', 'KIE'),
        option('apimart', 'other-model', 'APIMart'),
      ],
      archetypeId: 'seedance2',
      archetypeIdOf: (o) => (o.value === 'seedance2' ? 'seedance2' : 'other'),
      currentVendor: 'runway',
      currentValue: 'seedance2',
    })
    expect(candidates).toEqual([{ value: 'seedance2', vendor: 'kie', vendorName: 'KIE' }])
  })

  it('没有显示名时回落 vendor key', () => {
    const candidates = candidatesForArchetype({
      options: [option('kie', 'seedance2')],
      archetypeId: 'seedance2',
      archetypeIdOf: () => 'seedance2',
      currentVendor: 'runway',
      currentValue: 'seedance2',
    })
    expect(candidates[0].vendorName).toBe('kie')
  })

  it('同一 (vendor, value) 只留一条', () => {
    const candidates = candidatesForArchetype({
      options: [option('kie', 'seedance2', 'KIE'), option('kie', 'seedance2', 'KIE')],
      archetypeId: 'seedance2',
      archetypeIdOf: () => 'seedance2',
      currentVendor: 'runway',
      currentValue: 'seedance2',
    })
    expect(candidates).toHaveLength(1)
  })
})
