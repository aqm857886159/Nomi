import { describe, expect, it } from 'vitest'
import {
  EMPTY_STATE_BLOCK_HEIGHT,
  EMPTY_STATE_COMPACT_MIN_HEIGHT,
  EMPTY_STATE_FULL_MIN_HEIGHT,
  EMPTY_STATE_TOP_CLEARANCE,
  emptyStateBlockTop,
  emptyStateTier,
} from './nodeEmptyStateLayout'

describe('emptyStateTier 三档边界', () => {
  it('阈值等于实测数字：44 + 块高 + 8', () => {
    expect(EMPTY_STATE_FULL_MIN_HEIGHT).toBe(166)
    expect(EMPTY_STATE_COMPACT_MIN_HEIGHT).toBe(108)
  })
  it('完整档：卡高 ≥ 166 的一切', () => {
    expect(emptyStateTier(166)).toBe('full')
    expect(emptyStateTier(180)).toBe('full')
    expect(emptyStateTier(462)).toBe('full')
  })
  it('紧凑档：108 ≤ 卡高 < 166', () => {
    expect(emptyStateTier(165)).toBe('compact')
    expect(emptyStateTier(135)).toBe('compact')
    expect(emptyStateTier(108)).toBe('compact')
  })
  it('只留第一行：卡高 < 108', () => {
    expect(emptyStateTier(107)).toBe('icon')
    expect(emptyStateTier(103)).toBe('icon')
    expect(emptyStateTier(0)).toBe('icon')
  })
  it('卡高未知按完整档', () => {
    expect(emptyStateTier(undefined)).toBe('full')
    expect(emptyStateTier(Number.NaN)).toBe('full')
  })
})

describe('emptyStateBlockTop 视觉中心 B', () => {
  it('离顶至少 44px', () => {
    // 完整块在 166 卡里：45% 处算出 17，被钳到 44
    expect(emptyStateBlockTop('full', 166)).toBe(EMPTY_STATE_TOP_CLEARANCE)
    expect(emptyStateBlockTop('icon', 60)).toBe(EMPTY_STATE_TOP_CLEARANCE)
  })
  it('高卡：块中心落在 45% 处', () => {
    // 462 卡、完整块 114：中心 207.9，块顶 151
    expect(emptyStateBlockTop('full', 462)).toBe(Math.round(462 * 0.45 - EMPTY_STATE_BLOCK_HEIGHT.full / 2))
  })
  it('紧凑档与只留第一行用各自的块高', () => {
    expect(emptyStateBlockTop('compact', 240)).toBe(Math.round(240 * 0.45 - 28))
    expect(emptyStateBlockTop('icon', 240)).toBe(Math.round(240 * 0.45 - 12))
  })
})
