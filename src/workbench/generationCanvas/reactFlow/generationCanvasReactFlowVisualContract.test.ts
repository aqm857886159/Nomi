import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { GENERATION_NODE_KINDS, getGenerationNodeConnectionSides } from '../model/generationNodeKinds'
import {
  MAGNETIC_HANDLE_MAX_HIT_WIDTH,
  MAGNETIC_NEIGHBOR_DOT_RESERVE,
  resolveGenerationFlowConnectionAffordance,
  resolveMagneticHandleHitWidth,
  type MagneticHandleNodeRect,
} from './generationCanvasReactFlowVisualContract'

function node(kind: GenerationCanvasNode['kind'], meta?: Record<string, unknown>): GenerationCanvasNode {
  return {
    id: `${kind}-node`,
    kind,
    title: kind,
    position: { x: 0, y: 0 },
    size: { width: 240, height: 160 },
    ...(meta ? { meta } : {}),
  }
}

describe('React Flow canvas connection affordance contract', () => {
  // 2026-10-08 拍板（替换 09-21「所有种类都有」）：拉环只出现在用得上的一侧——哪一侧存在由种类定义的 `connects`
  // 决定（getGenerationNodeConnectionSides）；「选中出 + 圈、未选中出小圆点」这条可见性规则不变。枚举全表，新种类自动被测到。
  const SIDES = ['left', 'right'] as const
  it.each(GENERATION_NODE_KINDS)('gives the sole selected %s card the + ring only on a usable side', (kind) => {
    for (const side of SIDES) {
      expect(resolveGenerationFlowConnectionAffordance(node(kind), side, true, '')).toBe(getGenerationNodeConnectionSides(kind)[side] ? 'magnetic' : 'hidden')
    }
  })

  it.each(GENERATION_NODE_KINDS)('keeps an unselected (or multi-selected) %s card on the compact dot, only on a usable side', (kind) => {
    // primarySelection=false 同时覆盖「没选中」与「多选中的一张」——多选退化为点（2026-09-11 拍板）。
    for (const side of SIDES) {
      expect(resolveGenerationFlowConnectionAffordance(node(kind), side, false, '')).toBe(getGenerationNodeConnectionSides(kind)[side] ? 'dot' : 'hidden')
    }
  })

  it('an uploaded asset has only the right ring; a clip only the left; a text card both', () => {
    expect(resolveGenerationFlowConnectionAffordance(node('asset'), 'left', true, '')).toBe('hidden')
    expect(resolveGenerationFlowConnectionAffordance(node('asset'), 'right', true, '')).toBe('magnetic')
    expect(resolveGenerationFlowConnectionAffordance(node('clip'), 'right', true, '')).toBe('hidden')
    expect(resolveGenerationFlowConnectionAffordance(node('clip'), 'left', true, '')).toBe('magnetic')
    expect(resolveGenerationFlowConnectionAffordance(node('text'), 'left', true, '')).toBe('magnetic')
    expect(resolveGenerationFlowConnectionAffordance(node('text'), 'right', true, '')).toBe('magnetic')
  })

  it('keeps the source card on the compact dot while its own connection is in progress', () => {
    const image = node('image')
    expect(resolveGenerationFlowConnectionAffordance(image, 'right', true, image.id)).toBe('dot')
    expect(resolveGenerationFlowConnectionAffordance(image, 'right', true, 'another-node')).toBe('magnetic')
  })

  it('shows the + ring on a group port only while that group is selected (2026-09-24)', () => {
    const selected = node('image', { groupPort: { groupId: 'g', selected: true } })
    const unselected = node('image', { groupPort: { groupId: 'g', selected: false } })
    // 端口自己的选中态说了算，与卡片的 primarySelection 无关（编组的选区是它的成员 / 框本身）。
    for (const side of SIDES) {
      expect(resolveGenerationFlowConnectionAffordance(selected, side, false, '')).toBe('magnetic')
      expect(resolveGenerationFlowConnectionAffordance(unselected, side, true, '')).toBe('hidden')
      expect(resolveGenerationFlowConnectionAffordance(selected, side, false, selected.id)).toBe('dot')
    }
  })
})

describe('resolveMagneticHandleHitWidth · 磁吸命中带不跨卡抢邻卡悬停', () => {
  const rect = (id: string, x: number, y: number, width = 240, height = 135): MagneticHandleNodeRect => ({ id, x, y, width, height })

  it('开阔空白或邻卡距离 ≥ 126px 时保留 112px 全宽带子（兼容既有磁吸走查）', () => {
    const self = rect('main', 420, 120)
    expect(resolveMagneticHandleHitWidth(self, 'left', [])).toBe(MAGNETIC_HANDLE_MAX_HIT_WIDTH)
    expect(resolveMagneticHandleHitWidth(self, 'right', [rect('far', 420 + 240 + 150, 120)])).toBe(MAGNETIC_HANDLE_MAX_HIT_WIDTH)
  })

  it('邻卡位于 80px（参考图）或 64px（派生卡）标准间距时自动收窄至净间距 - 14px，绝不侵入邻卡及其圆点', () => {
    const self = rect('main', 420, 120)
    const refLeft = rect('ref-left', 100, 120) // right = 340, gap = 80
    const derivedRight = rect('derived-right', 724, 120) // left = 724, selfRight = 660, gap = 64

    const leftWidth = resolveMagneticHandleHitWidth(self, 'left', [self, refLeft, derivedRight])
    const rightWidth = resolveMagneticHandleHitWidth(self, 'right', [self, refLeft, derivedRight])

    expect(leftWidth).toBe(80 - MAGNETIC_NEIGHBOR_DOT_RESERVE)
    expect(rightWidth).toBe(64 - MAGNETIC_NEIGHBOR_DOT_RESERVE)
    // 静止 + 圈中心离边 28px、外缘 42.5px，两者都完全落在带内，且留足 14px 给邻卡小圆点
    expect(leftWidth).toBeGreaterThanOrEqual(43)
    expect(rightWidth).toBeGreaterThanOrEqual(43)
  })

  it('紧贴或重叠邻卡时收窄至不越界（间距 ≤ 14px 直接退为 0）', () => {
    const self = rect('main', 420, 120)
    expect(resolveMagneticHandleHitWidth(self, 'left', [rect('tight', 148, 120)])).toBe(32 - MAGNETIC_NEIGHBOR_DOT_RESERVE)
    expect(resolveMagneticHandleHitWidth(self, 'left', [rect('touching', 170, 120)])).toBe(0)
    expect(resolveMagneticHandleHitWidth(self, 'left', [rect('overlap', 220, 120)])).toBe(0)
  })

  it('纵向不重叠的上下排卡片不误缩带子；但邻卡顶部悬停钮（上探 36px）落入带高时仍会避让', () => {
    const self = rect('main', 420, 120, 240, 135) // bandTop = 106, bandBottom = 269
    expect(resolveMagneticHandleHitWidth(self, 'left', [rect('far-below', 100, 320)])).toBe(MAGNETIC_HANDLE_MAX_HIT_WIDTH)
    // otherTop = 290 - 36 = 254 < 269 → 顶部悬停钮落入磁吸带纵向范围，必须避让
    expect(resolveMagneticHandleHitWidth(self, 'left', [rect('chrome-overlap', 100, 290)])).toBe(80 - MAGNETIC_NEIGHBOR_DOT_RESERVE)
  })

  it('编组端口外框包含组内成员卡时不被自己内部成员误缩', () => {
    const groupBox = rect('group-port', 100, 100, 600, 300)
    const memberA = rect('m1', 120, 140, 200, 135)
    const memberB = rect('m2', 420, 140, 200, 135)
    expect(resolveMagneticHandleHitWidth(groupBox, 'left', [memberA, memberB])).toBe(MAGNETIC_HANDLE_MAX_HIT_WIDTH)
    expect(resolveMagneticHandleHitWidth(groupBox, 'right', [memberA, memberB])).toBe(MAGNETIC_HANDLE_MAX_HIT_WIDTH)
  })
})
