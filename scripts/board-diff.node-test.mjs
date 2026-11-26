// Values here exercise the reader contract. The two real #1665 captures are separate walk artifacts.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkBoardManifest } from './check-board-parity.mjs'
import * as gauge from './board-diff.mjs'

const element = 'account'
const candidate = '001-div'
const values = {
  text: '余额', fontSize: 12, lineHeight: 18, fontWeight: 400, monospace: false,
  color: 'ink-60', backgroundColor: 'transparent', fontVariantNumeric: 'normal',
  x: 0, y: 0, width: 200, height: 56, gapBefore: null, iconPath: null,
  ...Object.fromEntries(['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].map(c => ['radius' + c, 10])),
  ...Object.fromEntries(['Top', 'Right', 'Bottom', 'Left'].flatMap(s => [
    ['padding' + s, 12], ['border' + s + 'Width', 1], ['border' + s + 'Color', 'line'],
    ['parentPadding' + s, 0],
  ])),
}
const manifest = { board: 'Gauge', stage: 'built', elements: [
  { id: element, candidates: [candidate], status: 'implemented', states: ['zh-en'] },
] }
const sample = (screen = values, board = values) => ({ candidate, element, board, screen })
const report = (...samples) => gauge.buildDiffReport({ board: 'Gauge', locale: 'zh-CN', theme: 'light', sourceSha256: 'a'.repeat(64) }, samples)
const gate = (reports, decisions = [], legacy = new Map()) => checkBoardManifest({
  board: 'Gauge', manifest: { ...manifest, decisions }, candidates: [{ id: candidate }],
  evidence: { reports, legacy, sourceSha256: 'a'.repeat(64) },
})
const decision = property => ({ candidate, property, reason: '已核两边取值', approvedBy: '设计负责人' })

describe('R4 reads measured candidates', () => {
  it('requires coverage even if an old assertion name is present', () => {
    assert.match(gate([]).join('\n'), /差异清单/)
  })
  it('equal labels are green; removing, swapping or truncating observations is red', () => {
    const r = report(sample())
    assert.deepEqual(r.differences, [])
    assert.deepEqual(gate([r]), [])
    for (const bad of [
      { ...r, samples: [] }, { ...r, sourceSha256: 'b'.repeat(64) },
      { ...r, board: 'Other' }, { ...r, samples: [sample({ ...values, fontSize: undefined })] },
    ]) assert.ok(gate([bad]).length)
  })
  it('a decision consumes only its own property and needs a reason and approver', () => {
    const r = report(sample({ ...values, radiusTopLeft: 6, fontWeight: 700 }))
    assert.deepEqual(new Set(r.differences.map(d => d.property)), new Set(['radiusTopLeft', 'fontWeight']))
    assert.match(gate([r]).join('\n'), /radiusTopLeft/)
    const partial = gate([r], [decision('radiusTopLeft')]).join('\n')
    assert.doesNotMatch(partial, /radiusTopLeft/)
    assert.match(partial, /fontWeight/)
    assert.deepEqual(gate([r], [decision('radiusTopLeft'), decision('fontWeight')]), [])
    assert.ok(gate([r], [{ ...decision('radiusTopLeft'), approvedBy: '' }, decision('fontWeight')]).length)
    assert.ok(gate([{ ...r, differences: [] }]).length)
  })
  it('an unmatched candidate is always red and cannot be approved as measured', () => {
    const r = report(sample(null))
    assert.match(gate([r], [decision('pair')]).join('\n'), /配对/)
  })
  it('an equal off-scale board font still requires a board decision', () => {
    const off = { ...values, fontSize: 15 }
    const r = report(sample(off, off))
    assert.match(gate([r]).join('\n'), /fontSize/)
    assert.deepEqual(gate([r], [decision('fontSize')]), [])
  })
  it('legacy coverage is per element and candidate; a newly claimed candidate cannot borrow another slot', () => {
    assert.deepEqual(gate([], [], new Map([[element, new Set([candidate])]])), [])
    assert.ok(gate([], [], new Map([[element, new Set(['old'])]])).length)
    assert.ok(gate([report(sample({ ...values, height: 60 }))], [], new Map([[element, new Set([candidate])]])).length)
  })
})
