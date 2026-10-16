type ScreenBounds = { left: number; top: number; right: number; bottom: number }

/** Selection-time viewport translation, never a second composer placement rule. */
export function composerViewportTranslation(
  composer: ScreenBounds,
  stage: ScreenBounds,
): { x: number; y: number } | null {
  if (
    ![
      composer.left,
      composer.top,
      composer.right,
      composer.bottom,
      stage.left,
      stage.top,
      stage.right,
      stage.bottom,
    ].every(Number.isFinite)
  )
    return null
  const left = stage.left + 8
  const right = stage.right - 8
  const top = stage.top + 8
  // Keep the footer clear of the existing bottom canvas controls as well as clipping.
  const bottom = stage.bottom - 72
  if (right <= left || bottom <= top) return null
  const axis = (start: number, end: number, minimum: number, maximum: number): number => {
    if (end - start > maximum - minimum || end > maximum) return maximum - end
    return start < minimum ? minimum - start : 0
  }
  const x = axis(composer.left, composer.right, left, right)
  const y = axis(composer.top, composer.bottom, top, bottom)
  return x || y ? { x, y } : null
}
