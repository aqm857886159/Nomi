import { describe, expect, it } from 'vitest'
import { GROUP_TOOLBAR_ARRANGE_MODES, isGroupToolbarArrangeMode } from './groupToolbarActions'

describe('group toolbar arrange actions', () => {
  it('exposes exactly the three approved arrangements', () => {
    expect(GROUP_TOOLBAR_ARRANGE_MODES).toEqual(['grid', 'horizontal', 'vertical'])
    expect(isGroupToolbarArrangeMode('grid')).toBe(true)
    expect(isGroupToolbarArrangeMode('freeform')).toBe(false)
  })
})
