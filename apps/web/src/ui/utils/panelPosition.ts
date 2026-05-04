export const FLOATING_PANEL_LEFT = 82
export const FLOATING_PANEL_ANCHOR_OFFSET_Y = 28
export const FLOATING_PANEL_MIN_TOP = 64
export const FLOATING_PANEL_MIN_HEIGHT = 180

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Align left floating panels to the hovered nav button.
 * The nav writes the button center into `panelAnchorY`; panels should all use
 * the same small top offset so their top action area stays visually connected
 * to the hovered button instead of each panel inventing a different offset.
 */
export function calculateFloatingPanelTop(anchorY?: number | null, anchorOffset = FLOATING_PANEL_ANCHOR_OFFSET_Y, padding = 40) {
  if (typeof window === 'undefined') return 140
  const viewportHeight = window.innerHeight
  const reservedBottomInset = getBottomDialogInset(viewportHeight)
  const rawTop = anchorY ? anchorY - anchorOffset : 140
  const maxTop = viewportHeight - reservedBottomInset - padding - FLOATING_PANEL_MIN_HEIGHT
  return Math.round(clamp(rawTop, FLOATING_PANEL_MIN_TOP, Math.max(FLOATING_PANEL_MIN_TOP, maxTop)))
}

/**
 * 计算安全的面板最大高度，确保不会超出视窗。
 * `offsetTop` kept for backwards compatibility; new floating panels should use
 * FLOATING_PANEL_ANCHOR_OFFSET_Y through calculateFloatingPanelTop.
 */
export function calculateSafeMaxHeight(anchorY?: number | null, offsetTop = FLOATING_PANEL_ANCHOR_OFFSET_Y, padding = 40) {
  if (typeof window === 'undefined') return 480
  const viewportHeight = window.innerHeight
  const topPosition = calculateFloatingPanelTop(anchorY, offsetTop, padding)
  const reservedBottomInset = getBottomDialogInset(viewportHeight)

  // 计算可用空间：视窗高度 - 面板顶部位置 - 底部边距 - 底部悬浮对话框占位
  const availableHeight = viewportHeight - topPosition - padding - reservedBottomInset
  const maxHeight = Math.min(availableHeight, 800)

  // 在空间受限时允许小于默认最小高度，避免被底部对话框遮挡
  return Math.max(maxHeight, FLOATING_PANEL_MIN_HEIGHT)
}

function getBottomDialogInset(viewportHeight: number): number {
  if (typeof document === 'undefined') return 0
  const chat = document.querySelector('.tc-ai-chat') as HTMLElement | null
  if (!chat || chat.classList.contains('tc-ai-chat--maximized')) return 0

  const style = window.getComputedStyle(chat)
  if (style.display === 'none' || style.visibility === 'hidden') return 0

  const rect = chat.getBoundingClientRect()
  if (!Number.isFinite(rect.top) || rect.height <= 0) return 0

  const leftPanelLeft = 82
  const leftPanelMaxWidth = 720
  const leftPanelRight = leftPanelLeft + leftPanelMaxWidth
  const overlapsLeftPanelHorizontally = rect.left < leftPanelRight && rect.right > leftPanelLeft
  if (!overlapsLeftPanelHorizontally) return 0

  // 预留底部对话框顶部以上空间，避免面板滚动内容被遮住
  const inset = viewportHeight - rect.top + 12
  return Math.max(0, inset)
}
