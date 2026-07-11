import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FLOATING_WINDOW_MIN_HEIGHT,
  FLOATING_WINDOW_MIN_WIDTH,
  clampFloatingWindowRect,
  resizeFloatingWindowRect,
} from './useResizableFloatingWindow'

function stubViewport(width: number, height: number): void {
  vi.stubGlobal('window', {
    innerWidth: width,
    innerHeight: height,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useResizableFloatingWindow geometry', () => {
  it('clamps to one image tile plus compact padding', () => {
    stubViewport(500, 500)

    const rect = clampFloatingWindowRect({
      left: 30,
      top: 30,
      width: 80,
      height: 120,
    })

    expect(FLOATING_WINDOW_MIN_WIDTH).toBe(160)
    expect(rect.width).toBe(FLOATING_WINDOW_MIN_WIDTH)
    expect(rect.height).toBe(FLOATING_WINDOW_MIN_HEIGHT)
  })

  it('keeps the opposite edge fixed when resizing below the minimum width', () => {
    stubViewport(500, 500)

    const rect = resizeFloatingWindowRect(
      {
        left: 40,
        top: 40,
        width: 220,
        height: 320,
      },
      'w',
      400,
      0,
    )

    expect(rect.left).toBe(100)
    expect(rect.width).toBe(FLOATING_WINDOW_MIN_WIDTH)
  })

  it('keeps resize gestures inside the viewport margins', () => {
    stubViewport(360, 500)

    const rect = resizeFloatingWindowRect(
      {
        left: 40,
        top: 40,
        width: 180,
        height: 320,
      },
      'e',
      400,
      0,
    )

    expect(rect.left + rect.width).toBe(350)
  })
})
