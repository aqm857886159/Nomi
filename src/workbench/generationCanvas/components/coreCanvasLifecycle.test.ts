import { afterEach, expect, it, vi } from 'vitest'
import * as dragging from './canvasDraggingFlag'

afterEach(() => vi.unstubAllGlobals())

it('does not release another canvas when the original gesture element is detached', () => {
  const attributes = new Map<string, string>()
  const stage = {
    closest: () => stage,
    hasAttribute: (name: string) => attributes.has(name),
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  } as unknown as Element
  const detached = { closest: () => null } as unknown as Element
  vi.stubGlobal('document', { querySelector: () => stage })
  const original = dragging.beginCanvasDragging(stage, dragging.CANVAS_DRAGGING_OWNER.node)
  dragging.beginCanvasDragging(detached, dragging.CANVAS_DRAGGING_OWNER.node).release()
  expect(attributes.get(dragging.CANVAS_DRAGGING_ATTRIBUTE)).toBe('true')
  original.release()
})

