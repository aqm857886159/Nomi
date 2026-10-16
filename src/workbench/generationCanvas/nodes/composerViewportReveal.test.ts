import { describe, expect, it } from 'vitest'
import { composerViewportTranslation } from './composerViewportReveal'

const stage = { left: 60, top: 40, right: 1280, bottom: 889 }
describe('canvas composer action reachability', () => {
  const matrix = [
    {
      population: 'WorkBuddy portrait below stage',
      box: { left: 110, top: 735, right: 670, bottom: 1006 },
      delta: { x: 0, y: -189 },
    },
    {
      population: 'dense manual canvas left edge',
      box: { left: -128, top: 200, right: 432, bottom: 600 },
      delta: { x: 196, y: 0 },
    },
    { population: 'already reachable composer', box: { left: 110, top: 200, right: 670, bottom: 600 }, delta: null },
    {
      population: 'oversized composer action corner',
      box: { left: -100, top: -400, right: 1500, bottom: 1300 },
      delta: { x: -228, y: -483 },
    },
    { population: 'right edge', box: { left: 1000, top: 200, right: 1560, bottom: 600 }, delta: { x: -288, y: 0 } },
    { population: 'top edge', box: { left: 110, top: -100, right: 670, bottom: 300 }, delta: { x: 0, y: 148 } },
    {
      population: 'bottom left corner',
      box: { left: -128, top: 735, right: 432, bottom: 1006 },
      delta: { x: 196, y: -189 },
    },
    { population: 'text node width', box: { left: -100, top: 200, right: 180, bottom: 600 }, delta: { x: 168, y: 0 } },
  ]
  it.each(matrix)('reveals $population with minimal translation', ({ box, delta }) => {
    expect(composerViewportTranslation(box, stage)).toEqual(delta)
  })
  it.each([NaN, Infinity, -Infinity])('does not write an invalid viewport for %s geometry', (bad) => {
    expect(composerViewportTranslation({ left: bad, top: 200, right: 670, bottom: 600 }, stage)).toBeNull()
  })
  it('validates inherited DOMRect coordinates as well as plain records', () => {
    const invalidRect = Object.create({ left: NaN, top: 200, right: 670, bottom: 600 })
    expect(composerViewportTranslation(invalidRect, stage)).toBeNull()
  })
  it('does not move a hidden or collapsed stage', () => {
    expect(
      composerViewportTranslation(
        { left: 110, top: 200, right: 670, bottom: 600 },
        { left: 0, right: 0, top: 0, bottom: 0 },
      ),
    ).toBeNull()
  })
})
