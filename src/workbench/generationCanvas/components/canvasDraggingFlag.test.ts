import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CANVAS_DRAGGING_ATTRIBUTE,
  CANVAS_DRAGGING_OWNER,
  setCanvasDragging,
} from './canvasDraggingFlag'

describe('canvas dragging flag', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stays active until every drag owner releases its own lease', () => {
    const attributes = new Map<string, string>()
    const stage = {
      closest: () => stage,
      hasAttribute: (name: string) => attributes.has(name),
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    } as unknown as Element
    vi.stubGlobal('document', { querySelector: () => stage })

    setCanvasDragging(stage, true, CANVAS_DRAGGING_OWNER.reactFlowNode)
    setCanvasDragging(stage, true, CANVAS_DRAGGING_OWNER.reactFlowViewport)
    setCanvasDragging(stage, false, CANVAS_DRAGGING_OWNER.reactFlowViewport)

    expect(attributes.get(CANVAS_DRAGGING_ATTRIBUTE)).toBe('true')

    setCanvasDragging(stage, false, CANVAS_DRAGGING_OWNER.reactFlowNode)
    expect(attributes.has(CANVAS_DRAGGING_ATTRIBUTE)).toBe(false)
  })
})
