/**
 * Global Portal layer contract.
 *
 * Portals are siblings under document.body, so React ownership does not determine which
 * surface is on top. Keep the ordered tiers here and make every global overlay consume them.
 */
export const NOMI_OVERLAY_Z_INDEX = {
  floatingPanel: 4000,
  applicationModal: 9000,
  dialog: 9100,
  popover: 9200,
  confirmation: 9300,
  feedback: 2147483647,
} as const

function highestLayerZIndex(element: Element): number {
  let current: Element | null = element
  let highest = 0
  while (current) {
    const value = Number.parseInt(window.getComputedStyle(current).zIndex || '0', 10)
    if (Number.isFinite(value)) highest = Math.max(highest, value)
    current = current.parentElement
  }
  return highest
}

/** Settings owns Escape only when no later Portal dialog is visually above it. */
export function hasOpenDialogAbove(dialog: HTMLElement): boolean {
  const ownLayer = highestLayerZIndex(dialog)
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some((candidate) => {
    if (candidate === dialog || candidate.getClientRects().length === 0) return false
    const candidateLayer = highestLayerZIndex(candidate)
    if (candidateLayer !== ownLayer) return candidateLayer > ownLayer
    return Boolean(dialog.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
}
