// The small cases exercise pairing and R4. The published walk samples below cover the third acceptance review.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { checkBoardManifest } from './check-board-parity.mjs'
import * as gauge from './board-diff.mjs'
import { makeTempDir } from './_test-temp.mjs'

const element = 'account'
const candidate = '001-div'
const values = {
  text: '余额', fontSize: 12, lineHeight: 18, fontWeight: 400, monospace: false,
  color: 'ink-60', backgroundColor: 'transparent', fontVariantNumeric: 'normal',
  x: 0, y: 0, width: 200, height: 56, gapBefore: null, gapAfter: null, iconPath: null,
  ...Object.fromEntries(['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].map(c => ['radius' + c, 10])),
  ...Object.fromEntries(['Top', 'Right', 'Bottom', 'Left'].flatMap(s => [
    ['padding' + s, 12], ['border' + s + 'Width', 1], ['border' + s + 'Color', 'line'],
    ['parentPadding' + s, 0],
  ])),
}
const manifest = { board: 'Gauge', stage: 'built', elements: [
  { id: element, component: 'Account', candidates: [candidate], status: 'implemented', states: ['zh-en'] },
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

describe('candidate identity across different markup', () => {
  const row = (index, parent, text = '', mark, tag = 'div') => ({
    index, parent, own: text, label: '', mark, tag, values: { ...values, text },
  })
  const claim = (row, candidate) => ({ row, candidate, element: 'panel' })
  it('localizes identical labels to an anchored card and keeps original English case', () => {
    const a = row(1, 0), label = row(2, 1, 'Usage & Prices')
    const b = row(11, 10, '', 'card')
    const samples = gauge.pairCandidates([claim(a, 'card'), claim(label, 'label')], [a, label], [
      b, row(12, 11, 'Usage & prices'), row(13, 10, 'Usage & Prices'),
    ])
    assert.equal(samples[1].screen.text, 'Usage & prices')
  })
  it('ambiguous copies or duplicate markers cannot manufacture coverage', () => {
    const a = row(1, 0, 'Copy')
    for (const mark of [undefined, 'copy']) {
      const [sample] = gauge.pairCandidates([claim(a, 'copy')], [a], [row(2, 0, 'Copy', mark), row(3, 0, 'Copy', mark)])
      assert.equal(sample.screen, null)
    }
  })
  it('pairs an icon by its text owner, even when its actual path is wrong', () => {
    const link = row(1, 0, 'Usage'), icon = row(2, 1, '', undefined, 'svg')
    const actual = row(12, 11, '', undefined, 'svg')
    icon.values.iconPath = 'M0 0h3'
    actual.values.iconPath = 'M1 0h2'
    const samples = gauge.pairCandidates([claim(link, 'link'), claim(icon, 'icon')], [link, icon], [row(11, 0, 'Usage'), actual])
    assert.deepEqual(report(...samples).differences.map(d => [d.candidate, d.property]), [['icon', 'iconPath']])
  })
})

it('repayment retires a candidate even if other candidates on the same legacy element remain', async () => {
  const { remainingLegacy } = await import('./board-diff-evidence.mjs')
  const initial = new Map([[element, new Set([candidate, 'still-owed'])]])
  const previous = new Map([[element, new Set(['still-owed', 'newly-added'])]])
  const legacy = remainingLegacy(initial, previous)
  assert.deepEqual([...legacy.get(element)], ['still-owed'])
  assert.match(gate([], [], legacy).join('\n'), /001-div.*差异清单/)
  assert.equal(remainingLegacy(initial, new Map()).size, 0)
})

it('loads walk JSON from the board directory and rejects a stale or edited receipt', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { boardEvidence } = await import('./board-diff-evidence.mjs')
  const dir = makeTempDir('board-diff-walk-')
  const receipt = report(sample())
  fs.writeFileSync(path.join(dir, 'Gauge.candidates.json'), JSON.stringify({ sourceSha256: receipt.sourceSha256 }))
  fs.mkdirSync(path.join(dir, 'walk/Gauge'), { recursive: true })
  const file = path.join(dir, 'walk/Gauge/home.diff.json')
  const readErrors = () => checkBoardManifest({ board: 'Gauge', manifest, candidates: [{ id: candidate }],
    evidence: boardEvidence(dir, 'Gauge', new Map()) })
  assert.ok(readErrors().length)
  fs.writeFileSync(file, JSON.stringify(receipt))
  assert.deepEqual(readErrors(), [])
  fs.writeFileSync(file, JSON.stringify({ ...receipt, samples: [sample({ ...values, width: 180 })] }))
  assert.match(readErrors().join('\n'), /原始读数/)
  fs.writeFileSync(file, JSON.stringify({ ...receipt, sourceSha256: '0'.repeat(64) }))
  assert.match(readErrors().join('\n'), /指纹|哈希/)
})

describe('ModelSurfaces · #1665 第三轮验收的实测读数', () => {
  const fromWalk = file => JSON.parse(readFileSync(new URL(
    '../docs/evidence/2026-11-26-c0-board-diff/' + file + '.diff.json', import.meta.url), 'utf8'))
  const zh = fromWalk('zh-CN.light')
  const en = fromWalk('en.dark')
  const replay = r => gauge.buildDiffReport(r, r.samples)
  const rowsByTrack = { 'zh-CN.light': replay(zh).differences, 'en.dark': replay(en).differences }
  const observed = JSON.parse(readFileSync(new URL('./fixtures/model-settings-board-diff.json', import.meta.url), 'utf8'))

  function expectDelta(rows, id, property, board, screen) {
    const found = rows.filter(row => row.candidate === id && row.property === property)
    assert.deepEqual(found.map(row => [row.board, row.screen]), [[board, screen]], id + ' ' + property)
  }

  it('两轨的 40 个候选重算出同一份清单，9 个未配对的候选逐个保留', () => {
    for (const [r, count] of [[zh, 277], [en, 279]]) {
      assert.equal(r.screenRevision, 'aaedadf48f37482e55093e66312036a8bdd86feb')
      assert.equal(r.samples.length, 40)
      assert.equal(r.differences.length, count)
      assert.deepEqual(replay(r).differences, r.differences)
      const missing = r.samples.filter(s => s.screen === null).map(s => s.candidate)
      assert.equal(missing.length, 9)
      assert.deepEqual(r.differences.filter(d => d.property === 'pair').map(d => d.candidate), missing)
    }
  })

  // The host walk printed these candidate/property pairs independently of replaying the saved JSON.
  const observationCounts = [3, 1, 3, 2, 2, 2, 4, 3, 4]
  for (const [index, count] of observationCounts.entries()) {
    const section = '§1.' + (index + 1)
    const { label, track, observations } = observed[section]
    it(section + ' ' + label, () => {
      assert.equal(observations.length, count)
      for (const { candidate, property, board, screen } of observations) {
        expectDelta(rowsByTrack[track], candidate, property, board, screen)
      }
    })
  }

  it('§1.3 横线、竖线相对账户卡的左右和底边距离', () => {
    const cell = zh.samples.find(s => s.candidate === '060-div')
    const card = zh.samples.find(s => s.candidate === '052-div')
    function insets(surface) {
      const a = card[surface], g = cell[surface]
      return [g.x - a.x, a.x + a.width - g.x - g.width, a.y + a.height - g.y - g.height]
    }
    assert.deepEqual(insets('board'), [0, 0, 0])
    assert.deepEqual(insets('screen'), [13, 13, 11])
  })

  it('两轨三格标签的字号、行高、墨色相同，18 个属性都不进差异清单', () => {
    for (const [r, ids] of [
      [zh, ['061-span-账户余额', '067-span-这把Key的额度', '071-span-近7天花了']],
      [en, ['240-span-Balance', '246-span-Thiskeyslimi', '250-span-Last7days']],
    ]) {
      const rows = replay(r).differences
      for (const id of ids) {
        const s = r.samples.find(row => row.candidate === id)
        for (const values of [s.board, s.screen]) {
          assert.deepEqual([values.fontSize, values.lineHeight, values.color], [12, 18, 'ink-60'])
        }
        assert.deepEqual(rows.filter(row => row.candidate === id && ['fontSize', 'lineHeight', 'color'].includes(row.property)), [])
      }
    }
  })

  it('实测账户卡留一条未批准即红，补齐拍板人和理由才绿', () => {
    const s = zh.samples.find(row => row.candidate === '052-div')
    const r = gauge.buildDiffReport(zh, [s])
    const check = decisions => checkBoardManifest({
      board: r.board, candidates: [{ id: s.candidate }],
      manifest: { board: r.board, stage: 'built', decisions, elements: [
        { id: s.element, candidates: [s.candidate], component: 'ModelAccountCard', status: 'implemented', states: ['zh-en'] },
      ] },
      evidence: { reports: [r], sourceSha256: r.sourceSha256 },
    })
    const all = r.differences.map(d => ({ ...decision(d.property), candidate: d.candidate }))
    const errors = check(all.filter(d => d.property !== 'radiusTopLeft'))
    assert.equal(errors.length, 1)
    assert.match(errors[0], /052-div radiusTopLeft 10 → 6/)
    assert.deepEqual(check(all), [])
  })

  it('两边不读圆角时第 1 组断言必红，还原实测值即绿', () => {
    const s = zh.samples.find(row => row.candidate === '052-div')
    const corners = { radiusTopLeft: 0, radiusTopRight: 0, radiusBottomLeft: 0, radiusBottomRight: 0 }
    const mutated = { ...s, board: { ...s.board, ...corners }, screen: { ...s.screen, ...corners } }
    const checkRadius = r => expectDelta(r.differences, s.candidate, 'radiusTopLeft', 10, 6)
    assert.throws(() => checkRadius(gauge.buildDiffReport(zh, [mutated])), assert.AssertionError)
    checkRadius(gauge.buildDiffReport(zh, [s]))
  })
})
