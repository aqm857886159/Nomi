import { describe, expect, it } from 'vitest'
import { CANVAS_MAX_ZOOM } from '../model/canvasFitBounds'
import { fitEditingBounds, composerSelectionPan, revealEditor, selectionRevealMode } from './selectionComposerViewport'

const view = { left: 64, top: 20, width: 750, height: 580 }
const node = { x: 400, y: 100, width: 340, height: 340 }
const composer = { width: 600, height: 220, gap: 12 }

describe('canvas editing footprint', () => {
  it('caps first-open fit at 100% and uses the supplied limit for explicit fit', () => {
    const tiny = { x: 0, y: 0, width: 1, height: 1 }
    expect(fitEditingBounds(tiny, view, null).zoom).toBe(1)
    expect(fitEditingBounds(tiny, view, null, CANVAS_MAX_ZOOM).zoom).toBe(CANVAS_MAX_ZOOM)
  })

  it.each([node, { ...node, x: 0, width: 740 }])('fits all cards and the fixed-size selected composer', bounds => {
    const { x, y, zoom } = fitEditingBounds(bounds, view, { node, composer })
    expect(zoom).toBeLessThanOrEqual(1)
    expect(x + bounds.x * zoom).toBeGreaterThanOrEqual(view.left - 0.01)
    expect(y + (node.y - 40) * zoom - 36).toBeGreaterThanOrEqual(view.top + 6)
    const center = x + (node.x + node.width / 2) * zoom
    expect(center - 300).toBeGreaterThanOrEqual(view.left)
    expect(center + 300).toBeLessThanOrEqual(view.left + view.width)
    expect(y + (node.y + node.height + composer.gap) * zoom + 220).toBeLessThanOrEqual(view.top + view.height)
  })

  it.each<readonly [number, number, string]>([
    [-160, 0, 'left'], [100, 0, 'right'], [0, 60, 'bottom'],
  ])('pans existing selections from (%i,%i) at the %s edge at the current zoom', (x, y, _edge) => {
    const viewport = { x, y, zoom: 0.8 }
    const editor = { node, composer }
    const mode = selectionRevealMode('card', [{ id: 'card' }], [])
    expect(mode).toBe('pan')
    const target = revealEditor(viewport, view, editor, false, 1, false)!
    expect(target).not.toEqual(viewport)
    expect(target.zoom).toBe(viewport.zoom)
    const center = target.x + (node.x + node.width / 2) * target.zoom
    expect(center - composer.width / 2).toBeGreaterThanOrEqual(view.left)
    expect(center + composer.width / 2).toBeLessThanOrEqual(view.left + view.width)
    expect(target.y + (node.y + node.height + composer.gap) * target.zoom + composer.height).toBeLessThanOrEqual(view.top + view.height)
  })

  it('keeps the viewport still for a visible composer, drag and multi-selection', () => {
    expect(composerSelectionPan({ left: 100, top: 250, width: 600, height: 220 }, view)).toBeNull()
    for (const [count, drag] of [[1, true], [0, false], [2, false]] as const) {
      expect(revealEditor({ x: -1000, y: 500, zoom: 1 }, view, { node, composer }, true, count, drag)).toBeNull()
    }
  })
})

it('admits a new card only when it has an incoming edge', () => {
  const previousNodes = [{ id: 'source' }]
  expect(selectionRevealMode('card', previousNodes, [])).toBeNull()
  expect(selectionRevealMode('card', previousNodes, [{ target: 'source' }])).toBeNull()
  expect(selectionRevealMode('card', previousNodes, [{ target: 'card' }])).toBe('fit')
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
  for (const height of [580, 800]) {
    const target = revealEditor(viewport, { ...view, height }, editor, true, 1, false)!
    expect(target.y + (10 + 420 + composer.gap) * target.zoom + 220).toBeLessThanOrEqual(view.top + height)
    if (height === 800) expect(target.zoom).toBe(1)
  }
})

it('restores a remembered selection clipped only above the card and keeps a giant selection editable at its zoom', () => {
  const current = { x: 0, y: 0, zoom: 1 }
  const editor = { node: { x: 120, y: view.top + 10, width: 600, height: 200 }, composer }
  const moved = revealEditor(current, view, editor, true, 1, false)!
  expect(moved.y + editor.node.y - 40 - 38).toBeGreaterThanOrEqual(view.top + 6)
  const giant = { ...editor, node: { ...editor.node, height: 1500 } }
  const pan = revealEditor(current, view, giant, false, 1, false)!
  const editorTop = pan.y + giant.node.y + giant.node.height + composer.gap
  expect(pan.zoom).toBe(1)
  expect(editorTop).toBeGreaterThanOrEqual(view.top)
  expect(editorTop + composer.height).toBeLessThanOrEqual(view.top + view.height)
})

it('fits a remembered giant editor even when its submit button is already aligned with the bottom', () => {
  const editor = { node: { ...node, x: 200, y: 0, height: 700 }, composer }
  const viewport = { zoom: 1, x: 0, y: view.top + view.height - editor.node.height - composer.gap - composer.height }
  const target = revealEditor(viewport, view, editor, true, 1, false)!
  expect(target.zoom).toBeLessThan(1)
  expect(target.y - 40 * target.zoom - 38).toBeGreaterThanOrEqual(view.top + 6)
  expect(target.y + (700 + composer.gap) * target.zoom + composer.height).toBeLessThanOrEqual(view.top + view.height)
})
