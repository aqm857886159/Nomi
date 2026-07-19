import { describe, it, expect } from 'vitest'
import { groupModelsByKind, sortEnabledFirst } from './modelChipGrouping'

type M = { kind: string; modelKey: string }
const m = (kind: string, modelKey = kind): M => ({ kind, modelKey })

describe('groupModelsByKind（Issue #23 根因：四类外的 kind 不许崩）', () => {
  it('model3d 正常分桶并标 3D（runninghub 混元3D/HiTem3D/Meshy 种子曾整面板白屏）', () => {
    const groups = groupModelsByKind([m('model3d', 'hunyuan3d-v3.1')])
    expect(groups).toEqual([{ kind: 'model3d', label: '3D', models: [m('model3d', 'hunyuan3d-v3.1')] }])
  })

  it('未知 kind 落到队尾、用原始字符串当标签，不丢不崩', () => {
    const groups = groupModelsByKind([m('text'), m('embedding')])
    expect(groups.map((g) => g.kind)).toEqual(['text', 'embedding'])
    expect(groups[1].label).toBe('embedding')
  })

  it('缺失/空 kind 兜底为 text（绝不进 undefined 桶）', () => {
    const groups = groupModelsByKind([{ kind: '', modelKey: 'legacy' } as M])
    expect(groups).toEqual([{ kind: 'text', label: '文本', models: [{ kind: '', modelKey: 'legacy' }] }])
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
