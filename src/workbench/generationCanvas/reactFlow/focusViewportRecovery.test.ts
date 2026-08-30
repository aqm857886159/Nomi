import { describe, expect, it } from 'vitest'
import { resolvePendingCanvasFocus, type PendingCanvasFocus } from './focusViewportRecovery'

const node = (id: string, categoryId = 'shots') => ({
  id,
  kind: 'image' as const,
  categoryId,
  title: id,
  prompt: '',
  position: { x: 0, y: 0 },
  size: { width: 200, height: 200 },
  status: 'idle' as const,
})

const pending: PendingCanvasFocus = {
  nodeId: 'temporary-variant',
  categoryId: 'shots',
  viewport: { x: 30, y: 10, zoom: 0.86 },
}

describe('resolvePendingCanvasFocus', () => {
  it('focuses the target once it is visible in the active category', () => {
    const target = node('temporary-variant')
    expect(resolvePendingCanvasFocus(pending, 'shots', [target], [target])).toEqual({ type: 'focus', node: target })
  })

  it('waits for virtualization instead of restoring while the target still exists', () => {
    expect(resolvePendingCanvasFocus(pending, 'shots', [], [node('temporary-variant')])).toEqual({ type: 'wait' })
  })

  it('restores the pre-focus viewport after undo removes the target', () => {
    expect(resolvePendingCanvasFocus(pending, 'shots', [], [])).toEqual({ type: 'restore', viewport: pending.viewport })
  })

  it('does not restore during a category transition', () => {
    expect(resolvePendingCanvasFocus(pending, 'assets', [], [])).toEqual({ type: 'wait' })
  })
})
