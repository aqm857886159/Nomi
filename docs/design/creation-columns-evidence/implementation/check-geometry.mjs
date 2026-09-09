/* global URL, console */
// Compare actual Electron controls against the 04:32 approved outer-frame deltas.
import assert from 'node:assert/strict'
import fs from 'node:fs'
const root = new URL('.', import.meta.url)
for (const theme of ['light', 'dark']) {
  const before = JSON.parse(fs.readFileSync(new URL(`before-${theme}.json`, root)))
  const after = JSON.parse(fs.readFileSync(new URL(`after-${theme}.json`, root)))
  let controls = 0
  before.forEach((old, column) => {
    const next = after[column]
    assert.equal(next.radius, '10px')
    assert(next.shadow === 'none' || next.shadow.split('rgba(0, 0, 0, 0) 0px 0px 0px 0px').join('').replaceAll(',', '').trim() === '', 'Visible shadow')
    assert.equal(next.rect.y, 72)
    assert.equal(next.rect.h, 812)
    assert.equal(next.controls.length, old.controls.length)
    old.controls.forEach((control, index) => {
      const current = next.controls[index]
      assert.equal(current.id, control.id, 'Control order/identity changed')
      const delta = ['x', 'y', 'w', 'h'].map(key => current.rect[key] - control.rect[key])
      const expected = column === 0
        ? [[16,17,0,0], [17,17,0,0], [17,17,-1,0], [16,17,0,0], [17,17,-1,0], [16,17,0,0], [17,17,-1,0]][index]
        : column === 1 ? (index < 17 ? [16,2,0,0] : [16,4,0,-4])
          : index < 6 ? [0,4,0,0] : [0,0,0,0]
      assert(expected, 'Unexpected control')
      delta.forEach((value, dimension) => assert(Math.abs(value - expected[dimension]) < 0.05, `${theme}/${control.id}: unexpected geometry ${delta}`))
      controls++
    })
  })
  console.log(`${theme}: ${controls} controls pass; only approved outer-frame deltas`)
}
