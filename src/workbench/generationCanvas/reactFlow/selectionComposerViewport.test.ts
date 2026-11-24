import { describe, expect, it } from 'vitest'
import { fitEditingBounds, composerSelectionPan, revealEditor } from './selectionComposerViewport'

const view = { left: 64, top: 20, width: 750, height: 580 }
const node = { x: 400, y: 100, width: 340, height: 340 }
const composer = { width: 600, height: 220, gap: 12 }

describe('canvas editing footprint', () => {
  it.each([node, { ...node, x: 0, width: 740 }])('fits all cards and the fixed-size selected composer', bounds => {
    const { x, y, zoom } = fitEditingBounds(bounds, view, { node, composer })
    expect(zoom).toBeLessThanOrEqual(1)
    expect(x + bounds.x * zoom).toBeGreaterThanOrEqual(view.left - 0.01)
    expect(y + node.y * zoom).toBeGreaterThanOrEqual(view.top)
    const center = x + (node.x + node.width / 2) * zoom
    expect(center - 300).toBeGreaterThanOrEqual(view.left)
    expect(center + 300).toBeLessThanOrEqual(view.left + view.width)
    expect(y + (node.y + node.height + composer.gap) * zoom + 220).toBeLessThanOrEqual(view.top + view.height)
  })

  it.each([
    [10, 250, 'left'], [280, 250, 'right'], [100, 430, 'bottom'],
  ] as const)('reveals overflow from (%i,%i) at the %s edge', (left, top) => {
    const rect = { left, top, width: 600, height: 220 }
    const pan = composerSelectionPan(rect, view)!
    expect(left + pan.x).toBeGreaterThanOrEqual(view.left)
    expect(left + 600 + pan.x).toBeLessThanOrEqual(view.left + view.width)
    expect(top + 220 + pan.y).toBeLessThanOrEqual(view.top + view.height)
  })

  it('keeps the viewport still for a visible composer, drag and multi-selection', () => {
    expect(composerSelectionPan({ left: 100, top: 250, width: 600, height: 220 }, view)).toBeNull()
    for (const [count, drag] of [[1, true], [0, false], [2, false]] as const) {
      expect(revealEditor({ x: -1000, y: 500, zoom: 1 }, view, { node, composer }, true, count, drag)).toBeNull()
    }
  })
})

it('newly derived square video fits together with its editor in a narrow stage; reselecting it only pans', () => {
  const editor = { node: { x: 800, y: 80, width: 420, height: 420 }, composer }
  const viewport = { x: 0, y: 0, zoom: 1 }
  const target = revealEditor(viewport, view, editor, true, 1, false)!
  expect(target.zoom).toBeLessThan(viewport.zoom)
  expect(target.y + editor.node.y * target.zoom).toBeGreaterThanOrEqual(view.top)
  expect(target.y + (editor.node.y + 420 + composer.gap) * target.zoom + composer.height).toBeLessThanOrEqual(view.top + view.height)
  expect(revealEditor(viewport, view, editor, false, 1, false)?.zoom).toBe(1)
})

it('reserves mounting controls on a new card and preserves zoom when translation can fit the complete surface', () => {
  const editor = { node: { x: 850, y: 10, width: 420, height: 420 },
    composer: { ...composer, height: 150, initialHeight: 220 } }
  const viewport = { x: 0, y: 0, zoom: 1 }
  for (const height of [580, 660]) {
    const target = revealEditor(viewport, { ...view, height }, editor, true, 1, false)!
    expect(target.y + (10 + 420 + composer.gap) * target.zoom + 220).toBeLessThanOrEqual(view.top + height)
    if (height === 660) expect(target.zoom).toBe(1)
  }
})
