import { describe, expect, it } from 'vitest'
import { resolveSelectionToolbarPlacement } from './selectionToolbarPlacement'

describe('selection toolbar screen placement', () => {
  it('keeps a canvas-space selection toolbar at a fixed screen position after zoom', () => {
    const result = resolveSelectionToolbarPlacement(
      { minX: 200, minY: 180, width: 400, height: 240 },
      { x: -100, y: -80, zoom: 1.5 },
      { width: 1440, height: 900 },
    )

    expect(result).toMatchObject({ placement: 'above', maxWidth: 760 })
    expect(result.transform).toBe('translate3d(500px, 174px, 0) translate(-50%, -100%)')
  })

  it('moves below a top-edge selection and clamps inside a narrow viewport', () => {
    const result = resolveSelectionToolbarPlacement(
      { minX: -200, minY: 0, width: 120, height: 100 },
      { x: 0, y: 0, zoom: 1 },
      { width: 390, height: 420 },
    )

    expect(result).toMatchObject({ placement: 'below', maxWidth: 374, x: 195, y: 116 })
  })
})
