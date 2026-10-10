import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { resolveNodeVisualSize } from '../nodeSizing'
import {
  EMPTY_STATE_BLOCK_HEIGHT,
  EMPTY_STATE_COMPACT_MIN_HEIGHT,
  EMPTY_STATE_FULL_MIN_HEIGHT,
  EMPTY_STATE_TOP_CLEARANCE,
  emptyStateBlockTop,
  emptyStateTier,
} from './nodeEmptyStateLayout'

describe('emptyStateTier 两档边界', () => {
  it('阈值等于实测数字：44 + 块高 + 8', () => {
    expect(EMPTY_STATE_FULL_MIN_HEIGHT).toBe(166)
    expect(EMPTY_STATE_COMPACT_MIN_HEIGHT).toBe(108)
  })
  it('完整档：卡高 ≥ 166', () => {
    expect(emptyStateTier(166)).toBe('full')
    expect(emptyStateTier(462)).toBe('full')
  })
  it('紧凑档：卡高 < 166（含 120 这个渲染下限）', () => {
    expect(emptyStateTier(165)).toBe('compact')
    expect(emptyStateTier(120)).toBe('compact')
    expect(emptyStateTier(108)).toBe('compact')
  })
  it('卡高未知按完整档', () => {
    expect(emptyStateTier(undefined)).toBe('full')
    expect(emptyStateTier(Number.NaN)).toBe('full')
  })
})

describe('emptyStateBlockTop 视觉中心 B', () => {
  it('离顶至少 44px', () => {
    expect(emptyStateBlockTop('full', 166)).toBe(EMPTY_STATE_TOP_CLEARANCE)
    expect(emptyStateBlockTop('compact', 120)).toBe(EMPTY_STATE_TOP_CLEARANCE)
  })
  it('高卡：块中心落在 45% 处', () => {
    expect(emptyStateBlockTop('full', 462)).toBe(Math.round(462 * 0.45 - EMPTY_STATE_BLOCK_HEIGHT.full / 2))
  })
  it('紧凑档用紧凑块高', () => {
    expect(emptyStateBlockTop('compact', 240)).toBe(Math.round(240 * 0.45 - EMPTY_STATE_BLOCK_HEIGHT.compact / 2))
  })
})

// 结构测试（2026-10-10 V-ratio 第 4 点）：用到 NodeEmptyState 的每种节点，渲染高度（resolveNodeVisualSize）的下限
// 必须 ≥ 紧凑阈值。这是删掉「只留第一行」档的依据；以后若有节点的下限掉到 108 以下，这里红，逼人重新定档。
describe('NodeEmptyState 用到的节点：渲染高度下限 ≥ 紧凑阈值', () => {
  const cases: Array<{ name: string; node: { kind: string; renderKind?: string } }> = [
    { name: 'image', node: { kind: 'image' } },
    { name: 'video', node: { kind: 'video' } },
    { name: 'model3d', node: { kind: 'model3d' } },
    { name: 'text', node: { kind: 'text' } },
    { name: 'whiteboard', node: { kind: 'whiteboard' } },
    { name: 'character-card', node: { kind: 'character', renderKind: 'character-card' } },
    { name: 'scene-card', node: { kind: 'scene', renderKind: 'scene-card' } },
    { name: 'prop-card', node: { kind: 'prop', renderKind: 'prop-card' } },
    { name: 'panorama', node: { kind: 'panorama' } },
  ]
  it.each(cases)('$name 在最小宽、存的高度很小时，渲染高度仍 ≥ 108', ({ node }) => {
    const shrunk = { ...node, position: { x: 0, y: 0 }, categoryId: 'shots', prompt: '', meta: {}, size: { width: 240, height: 1 } } as unknown as GenerationCanvasNode
    expect(resolveNodeVisualSize(shrunk).height).toBeGreaterThanOrEqual(EMPTY_STATE_COMPACT_MIN_HEIGHT)
  })
})
