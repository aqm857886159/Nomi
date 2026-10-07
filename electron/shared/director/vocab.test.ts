import { describe, expect, it } from 'vitest'
import { stageKindOf } from './vocab'

describe('名词 → 舞台种类', () => {
  it.each([
    ['院门', 'gate'], ['gate', 'gate'], ['cafe_table', 'table'], ['餐桌', 'table'], ['圆形展台', 'pedestal'], ['round_pedestal', 'pedestal'],
    ['wall back', 'wall'], ['wall_enclosure', 'wall'], ['background_wall', 'backdrop'], ['buildings_both_sides', 'building'],
    ['信', 'paper'], ['letter', 'paper'], ['瓶盖', 'small_item'], ['shop_counter', 'counter'], ['长椅', 'seat'],
  ])('%s → %s', (noun, kind) => {
    expect(stageKindOf(noun)).toBe(kind)
  })

  it('认不出的名词不归类（不猜）', () => {
    expect(stageKindOf('zorblax')).toBeUndefined()
    expect(stageKindOf('青衣女子')).toBeUndefined()
  })
})
