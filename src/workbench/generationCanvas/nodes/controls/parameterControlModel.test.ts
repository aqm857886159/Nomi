import { describe, it, expect } from 'vitest'
import type { ModelParameterControl } from '../../../../config/modelCatalogMeta'
import { parseControlInput } from './parameterControlModel'

// parseControlInput 按控件类型回类型。关键修复（2026-06-16）：select 按选中 option 的声明类型回类型——
// 数值 option（如 duration 离散枚举 4/8/12）回 number 整数，避免发字符串 "8" 被 vendor 400。
describe('parseControlInput — select 按 option 声明类型回类型', () => {
  const numSelect: ModelParameterControl = {
    key: 'duration', label: '时长', type: 'select',
    options: [{ value: 4, label: '4' }, { value: 8, label: '8' }, { value: 12, label: '12' }],
  }
  const strSelect: ModelParameterControl = {
    key: 'resolution', label: '清晰度', type: 'select',
    options: [{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }],
  }

  it('数值 option 的 select → 回 number（发整数）', () => {
    expect(parseControlInput(numSelect, '8')).toBe(8)
    expect(typeof parseControlInput(numSelect, '8')).toBe('number')
  })
  it('字符串 option 的 select → 仍回 string（720p 不被误转）', () => {
    expect(parseControlInput(strSelect, '720p')).toBe('720p')
  })
  it('number 控件直接 Number()', () => {
    expect(parseControlInput({ key: 'd', label: 'd', type: 'number', options: [] }, '5')).toBe(5)
  })
})
