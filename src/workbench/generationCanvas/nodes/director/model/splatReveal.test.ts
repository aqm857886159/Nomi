import { describe, expect, it } from 'vitest'
import { pickRevealEffect, revealEaseOut, revealShaderDuration, SPLAT_REVEAL_DEFAULT_POOL } from './splatReveal'

describe('splatReveal（显现时长参数）', () => {
  it('Magic 固定 14.5s，Spread 按半径反推', () => {
    expect(revealShaderDuration('Magic', { maxRadiusXZ: 3, minY: 0 })).toBe(14.5)
    // radius 2 → tt = 13 → sqrt(12.5/0.4) = 5.59
    expect(revealShaderDuration('Spread', { maxRadiusXZ: 2, minY: 0 })).toBeCloseTo(5.59, 2)
  })
  it('半径小于 0.5 按 0.5 算，Twister / Rain 随半径增长', () => {
    expect(revealShaderDuration('Twister', { maxRadiusXZ: 0.1, minY: 0 })).toBeCloseTo(Math.sqrt(70), 5)
    expect(revealShaderDuration('Rain', { maxRadiusXZ: 4, minY: 0 })).toBeCloseTo(Math.sqrt(120), 5)
  })
  it('Unroll 至少 5s，最低点越低越久', () => {
    expect(revealShaderDuration('Unroll', { maxRadiusXZ: 1, minY: 0 })).toBe(5)
    expect(revealShaderDuration('Unroll', { maxRadiusXZ: 1, minY: -3 })).toBe(7)
  })
  it('默认只在 Magic / Spread 里随机', () => {
    expect(pickRevealEffect(() => 0)).toBe(SPLAT_REVEAL_DEFAULT_POOL[0])
    expect(pickRevealEffect(() => 0.99)).toBe(SPLAT_REVEAL_DEFAULT_POOL[1])
    expect(pickRevealEffect(() => 0.5, ['Rain'])).toBe('Rain')
  })
  it('缓出：0→0、1→1、中段先快后慢', () => {
    expect(revealEaseOut(0)).toBe(0)
    expect(revealEaseOut(1)).toBe(1)
    expect(revealEaseOut(0.5)).toBeCloseTo(0.875)
  })
})
