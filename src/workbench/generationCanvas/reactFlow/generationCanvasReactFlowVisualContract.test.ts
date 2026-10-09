import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { GENERATION_NODE_KINDS, getGenerationNodeConnectionSides } from '../model/generationNodeKinds'
import { resolveGenerationFlowConnectionAffordance } from './generationCanvasReactFlowVisualContract'

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
