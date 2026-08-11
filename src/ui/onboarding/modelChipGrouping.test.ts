import { describe, it, expect } from 'vitest'
import { groupModelsByKind, isKnownModelChipKind, MODEL_CHIP_KINDS, sortEnabledFirst } from './modelChipGrouping'
import { zhOnboardingProviders, enOnboardingProviders } from '../../i18n/locales/onboardingProviders'

type M = { kind: string; modelKey: string }
const m = (kind: string, modelKey = kind): M => ({ kind, modelKey })

describe('groupModelsByKind（Issue #23 根因：四类外的 kind 不许崩）', () => {
  it('model3d 正常分桶（runninghub 混元3D/HiTem3D/Meshy 种子曾整面板白屏）', () => {
    const groups = groupModelsByKind([m('model3d', 'hunyuan3d-v3.1')])
    expect(groups).toEqual([{ kind: 'model3d', models: [m('model3d', 'hunyuan3d-v3.1')] }])
  })

  it('未知 kind 落到队尾、原样保留 kind 字符串给渲染侧兜底，不丢不崩', () => {
    const groups = groupModelsByKind([m('text'), m('embedding')])
    expect(groups.map((g) => g.kind)).toEqual(['text', 'embedding'])
    expect(isKnownModelChipKind(groups[1].kind)).toBe(false) // → 渲染侧原样显示 'embedding'
  })

  it('缺失/空 kind 兜底为 text（绝不进 undefined 桶）', () => {
    const groups = groupModelsByKind([{ kind: '', modelKey: 'legacy' } as M])
    expect(groups).toEqual([{ kind: 'text', models: [{ kind: '', modelKey: 'legacy' }] }])
  })

  /** R15：分组只给 kind，展示文案一律由渲染侧 t() 出——这里再冒出 label/中文就是走回硬编码老路。 */
  it('分组不带任何展示文案字段（标题只能来自 i18n）', () => {
    const groups = groupModelsByKind([m('text'), m('model3d'), m('embedding')])
    expect(groups.every((g) => Object.keys(g).sort().join() === 'kind,models')).toBe(true)
  })

  it('已知 kind 按固定顺序，未知 kind 追加在后', () => {
    const groups = groupModelsByKind([
      m('video'), m('weird'), m('text'), m('model3d'), m('image'), m('audio'),
    ])
    expect(groups.map((g) => g.kind)).toEqual(['text', 'image', 'video', 'audio', 'model3d', 'weird'])
  })

  it('空输入 → 空数组', () => {
    expect(groupModelsByKind([])).toEqual([])
  })
})

describe('isKnownModelChipKind（三个渲染侧共用的「有没有 i18n 标题」判据）', () => {
  it('五类已知 kind 全为真、未知/空为假', () => {
    expect(MODEL_CHIP_KINDS.every(isKnownModelChipKind)).toBe(true)
    for (const unknown of ['embedding', 'rerank', '', 'TEXT']) {
      expect(isKnownModelChipKind(unknown)).toBe(false)
    }
  })

  /**
   * 判据说「已知」，渲染侧就直接 t(`…kind.${kind}`) 不再兜底——所以清单里加了第六类却忘了加词条，
   * 用户看到的会是原始 key（`onboardingProviders.modelControls.kind.xxx`）。在这儿钉死两边同步。
   */
  it('清单里每一类在 zh-CN / en 都有词条（加 kind 必须同时加翻译）', () => {
    for (const kind of MODEL_CHIP_KINDS) {
      expect(zhOnboardingProviders.modelControls.kind).toHaveProperty(kind)
      expect(enOnboardingProviders.modelControls.kind).toHaveProperty(kind)
    }
  })
})

describe('sortEnabledFirst（2026-07-17 用户要求：选中的模型自动往前排列）', () => {
  const e = (modelKey: string, enabled: boolean) => ({ modelKey, enabled })

  it('已启用排前、两段内各自保持原有相对顺序（稳定）', () => {
    const input = [e('a', false), e('b', true), e('c', false), e('d', true), e('e', true)]
    expect(sortEnabledFirst(input).map((x) => x.modelKey)).toEqual(['b', 'd', 'e', 'a', 'c'])
  })

  it('不改变入参数组（返回新数组）', () => {
    const input = [e('a', false), e('b', true)]
    const out = sortEnabledFirst(input)
    expect(input.map((x) => x.modelKey)).toEqual(['a', 'b'])
    expect(out).not.toBe(input)
  })

  it('全启用/全停用 → 原序不动', () => {
    expect(sortEnabledFirst([e('a', true), e('b', true)]).map((x) => x.modelKey)).toEqual(['a', 'b'])
    expect(sortEnabledFirst([e('a', false), e('b', false)]).map((x) => x.modelKey)).toEqual(['a', 'b'])
  })
})
