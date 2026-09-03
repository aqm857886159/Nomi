import { describe, expect, it } from 'vitest'
import { resolveCanvasDropTarget, type CanvasDropTarget } from './canvasConnectionDropTarget'

describe('canvas connection drop target', () => {
  it('resolves a node whose rendered card contains the release point', () => {
    const targets: CanvasDropTarget[] = [
      { id: 'source', rect: { left: 810, top: 340, right: 1150, bottom: 680 } },
      { id: 'target', rect: { left: 645, top: 726, right: 1065, bottom: 962 } },
    ]

    expect(resolveCanvasDropTarget({ clientX: 855, clientY: 844 }, 'source', targets)).toBe('target')
  })

  it('does not resolve the source itself or a point outside every card', () => {
    const targets: CanvasDropTarget[] = [
      { id: 'source', rect: { left: 100, top: 100, right: 300, bottom: 300 } },
      { id: 'target', rect: { left: 400, top: 400, right: 600, bottom: 600 } },
    ]

    expect(resolveCanvasDropTarget({ clientX: 200, clientY: 200 }, 'source', targets)).toBeNull()
    expect(resolveCanvasDropTarget({ clientX: 700, clientY: 700 }, 'source', targets)).toBeNull()
  })
})
