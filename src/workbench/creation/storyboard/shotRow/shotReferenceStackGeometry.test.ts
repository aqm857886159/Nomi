import { describe, expect, it } from 'vitest'
import { REFERENCE_CARD_SIZE, REFERENCE_STACK_OFFSET, REFERENCE_STACK_ROTATED_BOUNDS, referenceSlotWidth, referenceStackReservedWidth } from './shotReferenceStackGeometry'

describe('reference stack geometry', () => {
  it('reserves every visible 8px layer for one through thirty references', () => {
    for (let count = 1; count <= 30; count += 1) {
      const visible = Math.min(count, 3)
      expect(referenceStackReservedWidth(count)).toBe(visible <= 1 ? REFERENCE_CARD_SIZE : Math.max(REFERENCE_STACK_ROTATED_BOUNDS, REFERENCE_CARD_SIZE + (visible - 1) * REFERENCE_STACK_OFFSET))
      expect(referenceSlotWidth(count)).toBeGreaterThanOrEqual(referenceStackReservedWidth(count))
    }
  })
})
