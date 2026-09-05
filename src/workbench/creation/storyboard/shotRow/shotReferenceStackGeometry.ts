/** Geometry shared by the reference stack renderer and its contract tests. */
export const REFERENCE_CARD_SIZE = 56
export const REFERENCE_STACK_OFFSET = 8
export const REFERENCE_STACK_VISIBLE_CARDS = 3
export const REFERENCE_STACK_GAP = 12
export const REFERENCE_STACK_ROTATED_BOUNDS = 80

export function referenceStackReservedWidth(bindingCount: number): number {
  const layers = Math.min(Math.max(0, bindingCount), REFERENCE_STACK_VISIBLE_CARDS)
  return layers <= 1
    ? REFERENCE_CARD_SIZE
    : Math.max(REFERENCE_STACK_ROTATED_BOUNDS, REFERENCE_CARD_SIZE + (layers - 1) * REFERENCE_STACK_OFFSET)
}

/** A slot reserves the full card spread, never the first card's width. */
export function referenceSlotWidth(bindingCount: number): number {
  return Math.max(REFERENCE_CARD_SIZE, referenceStackReservedWidth(bindingCount))
}
