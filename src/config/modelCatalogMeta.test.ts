import { describe, expect, it } from 'vitest'
import { parseModelParameterControls } from './modelCatalogMeta'

function controlFrom(partial: Record<string, unknown>) {
  return parseModelParameterControls({
    parameters: [{ key: 'strength', label: '强度', type: 'number', ...partial }],
  })[0]
}

describe('parseModelParameterControls — 参数边界', () => {
  it('keeps a zero or negative bound instead of dropping it', () => {
    // CFG 的下界就是 0、denoise 是 0–1、shift 可为负。此前 min/max 走「必须为正」的解析，
    // 0 和负数被当非法丢掉，控件失去下界（滑杆从 undefined 起跳、数字框不再夹取值）。
    expect(controlFrom({ min: 0, max: 1 })).toMatchObject({ min: 0, max: 1 })
    expect(controlFrom({ min: -5, max: 5 })).toMatchObject({ min: -5, max: 5 })
    expect(controlFrom({ min: '0', max: '1' })).toMatchObject({ min: 0, max: 1 })
  })

  it('still rejects blanks and non-numbers as bounds', () => {
    // Number('') === 0——放行就等于把「没填」当成「下界 0」。
    for (const bounds of [
      { min: '', max: '  ' },
      { min: 'abc', max: null },
      { min: Infinity, max: NaN },
    ]) {
      const control = controlFrom(bounds)
      expect(control.min).toBeUndefined()
      expect(control.max).toBeUndefined()
    }
  })

  it('keeps step strictly positive — a zero or negative step cannot divide a range', () => {
    expect(controlFrom({ step: 0.1 }).step).toBe(0.1)
    expect(controlFrom({ step: 0 }).step).toBeUndefined()
    expect(controlFrom({ step: -1 }).step).toBeUndefined()
  })
})
