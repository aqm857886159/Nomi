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
  ownsText: true, fixedHeight: true, intrinsicWidth: false, text: '余额', fontSize: 12, lineHeight: 18, fontWeight: 400, monospace: false,
  color: 'ink-60', backgroundColor: 'transparent', fontVariantNumeric: 'normal',
  x: 0, y: 0, width: 200, height: 56, gapBefore: null, gapAfter: null, iconPath: null,
  ...Object.fromEntries(['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].map(c => ['radius' + c, 10])),
  ...Object.fromEntries(['Top', 'Right', 'Bottom', 'Left'].flatMap(s => [
    ['padding' + s, 12], ['border' + s + 'Width', 1], ['border' + s + 'Color', 'line'],
  ])),
}
const manifest = { board: 'Gauge', stage: 'built', elements: [
  { id: element, component: 'Account', candidates: [candidate], status: 'implemented', states: ['selected'] },
] }
const sample = (screen = values, board = values) => ({ candidate, element, board, screen })
const report = (...samples) => gauge.buildDiffReport({ board: 'Gauge', locale: 'zh-CN', theme: 'light', screenRevision: 'aaedadf48', sourceSha256: 'a'.repeat(64) }, samples)
const gate = (reports, decisions = [], legacy = new Map()) => checkBoardManifest({
  board: 'Gauge', manifest: { ...manifest, decisions }, candidates: [{ id: candidate }],
  evidence: { reports, legacy, sourceSha256: 'a'.repeat(64) },
})
const decision = (property, board, screen) => ({ candidate, property, board, screen, reason: '已核两边取值', approvedBy: '设计负责人' })

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
    const partial = gate([r], [decision('radiusTopLeft', 10, 6)]).join('\n')
    assert.doesNotMatch(partial, /radiusTopLeft/)
    assert.match(partial, /fontWeight/)
    assert.deepEqual(gate([r], [decision('radiusTopLeft', 10, 6), decision('fontWeight', 400, 700)]), [])
    assert.ok(gate([r], [{ ...decision('radiusTopLeft', 10, 6), approvedBy: '' }, decision('fontWeight', 400, 700)]).length)
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
    assert.deepEqual(gate([r], [decision('fontSize', 15, 15)]), [])
  })
  it('legacy coverage is per element and candidate; a newly claimed candidate cannot borrow another slot', () => {
    assert.deepEqual(gate([], [], new Map([[element, new Set([candidate])]])), [])
    assert.ok(gate([], [], new Map([[element, new Set(['old'])]])).length)
    assert.ok(gate([report(sample({ ...values, height: 60 }))], [], new Map([[element, new Set([candidate])]])).length)
  })
})

describe('candidate identity across different markup', () => {
  const row = (index, parent, text = '', mark, tag = 'div') => ({
    index, parent, own: text, label: '', mark, tag, values: { ...values, text, ownsText: Boolean(text) },
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
  const initial = new Map([[element, new Map([[candidate, { text: 'old' }], ['still-owed', { text: 'same' }]])]])
  const previous = new Map([[element, new Map([['still-owed', { text: 'same' }], ['newly-added', { text: 'new' }]])]])
  const legacy = remainingLegacy(initial, previous)
  assert.deepEqual([...legacy.get(element).keys()], ['still-owed'])
  assert.match(gate([], [], legacy).join('\n'), /001-div.*差异清单/)
  assert.equal(remainingLegacy(initial, new Map()).size, 0)
  for (const changed of [{ text: 'different' }, { text: 'same', tag: 'input' }]) {
    const edited = new Map([[element, new Map([['still-owed', changed]])]])
    assert.equal(remainingLegacy(legacy, edited).get(element).has('still-owed'), false)
  }
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
  fs.writeFileSync(file, JSON.stringify({ ...receipt, samples: [sample({ ...values, paddingLeft: 8 })] }))
  assert.match(readErrors().join('\n'), /原始读数/)
  fs.writeFileSync(file, JSON.stringify({ ...receipt, sourceSha256: '0'.repeat(64) }))
  assert.match(readErrors().join('\n'), /指纹|哈希/)
})

describe('ModelSurfaces · #1665 第三轮验收的实测读数', () => {
  const fromWalk = file => JSON.parse(readFileSync(new URL(
    '../docs/evidence/2026-11-26-c0-board-diff/' + file + '.diff.json', import.meta.url), 'utf8'))
  const zh = fromWalk('zh-CN.light')
  const en = fromWalk('en.dark')
  const tracks = { 'zh-CN.light': zh, 'en.dark': en }
  // These v1 receipts predate DOM ownership metadata. Use only the named, reviewed
  // observations in unit probes. Full v2 receipts must come from the host browser.
  function probe(sample, { text = false, height = false, icon = false } = {}) {
    const value = v => v && { ...v, text: text ? v.text : '', ownsText: text, intrinsicWidth: icon, fixedHeight: height || icon }
    return { ...sample, board: value(sample.board), screen: value(sample.screen) }
  }
  const observed = JSON.parse(readFileSync(new URL('./fixtures/model-settings-board-diff.json', import.meta.url), 'utf8'))

  function expectDelta(rows, id, property, board, screen) {
    const found = rows.filter(row => row.candidate === id && row.property === property)
    assert.deepEqual(found.map(row => [row.board, row.screen]), [[board, screen]], id + ' ' + property)
  }

  it('第一轮两轨各量 40 个候选，9 个未配对的候选逐个保留', () => {
    for (const [r, count] of [[zh, 277], [en, 279]]) {
      assert.equal(r.screenRevision, 'aaedadf48f37482e55093e66312036a8bdd86feb')
      assert.equal(r.samples.length, 40)
      assert.equal(r.differences.length, count)
      assert.equal(r.version, 1)
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
        const trackData = tracks[track]
        const source = trackData.samples.find(s => s.candidate === candidate)
        if (section === '§1.3') {
          // The old walk recorded the cell's padding on its label. Check those historical
          // values here; the paired-grid probe below exercises the new direct measurements.
          assert.deepEqual([source.board[property], source.screen[property]], [board, screen])
        } else {
          const sample = probe(source, { text: Boolean(source.board.text), height: property === 'height', icon: candidate.endsWith('-svg') })
          expectDelta(gauge.buildDiffReport(trackData, [sample]).differences, candidate, property, board, screen)
        }
      }
    })
  }

  it('两轨保留缺少的美元额、额外本机说明；仅示例数字及打码格式不同消解', () => {
    for (const [r, ids] of [[zh, ['064-span-523', '071-span-近7天花了', '057-span-skf3a9存在系统钥匙']],
      [en, ['243-span-523', '250-span-Last7days', '236-span-skf3a9insyst']]]) {
      const [currency, annotation, masked] = ids.map(id => probe(r.samples.find(s => s.candidate === id), { text: true }))
      const rows = gauge.buildDiffReport(r, [currency, annotation, masked]).differences
      expectDelta(rows, currency.candidate, 'pair', '$5.23', null)
      expectDelta(rows, annotation.candidate, 'text', annotation.board.text, annotation.screen.text)
      assert.ok(!rows.some(d => d.candidate === masked.candidate && d.property === 'text'))
    }
  })

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
      const rows = gauge.buildDiffReport(r, r.samples.filter(s => ids.includes(s.candidate)).map(s => probe(s, { text: true }))).differences
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
    const s = probe(zh.samples.find(row => row.candidate === '052-div'))
    const r = gauge.buildDiffReport(zh, [s])
    const check = decisions => checkBoardManifest({
      board: r.board, candidates: [{ id: s.candidate }],
      manifest: { board: r.board, stage: 'built', decisions, elements: [
        { id: s.element, candidates: [s.candidate], component: 'ModelAccountCard', status: 'implemented', states: ['selected'] },
      ] },
      evidence: { reports: [r], sourceSha256: r.sourceSha256 },
    })
    const all = r.differences.map(d => ({ ...decision(d.property, d.board, d.screen), candidate: d.candidate }))
    const errors = check(all.filter(d => d.property !== 'radiusTopLeft'))
    assert.equal(errors.length, 1)
    assert.match(errors[0], /052-div radiusTopLeft 10 → 6/)
    assert.deepEqual(check(all), [])
  })

  it('两边不读圆角时第 1 组断言必红，还原实测值即绿', () => {
    const s = probe(zh.samples.find(row => row.candidate === '052-div'))
    const corners = { radiusTopLeft: 0, radiusTopRight: 0, radiusBottomLeft: 0, radiusBottomRight: 0 }
    const mutated = { ...s, board: { ...s.board, ...corners }, screen: { ...s.screen, ...corners } }
    const checkRadius = r => expectDelta(r.differences, s.candidate, 'radiusTopLeft', 10, 6)
    assert.throws(() => checkRadius(gauge.buildDiffReport(zh, [mutated])), assert.AssertionError)
    checkRadius(gauge.buildDiffReport(zh, [s]))
  })
})

describe('审查反例 · 实际差异的归属与收据的边界', () => {
  it('反例 4 · 子字号改坏只报该子一条，容器继承字号和兄弟坐标不连坐', () => {
    const panel = { ...values, text: '', ownsText: false, fixedHeight: false, intrinsicWidth: false }
    const label = { ...values, ownsText: true, fixedHeight: false, intrinsicWidth: false }
    const r = report(
      { ...sample({ ...panel, fontSize: 16, height: 70, width: 180 }, panel), candidate: 'panel' },
      { ...sample({ ...label, fontSize: 16 }, label), candidate: 'child' },
      { ...sample({ ...label, x: 9, y: 14 }, label), candidate: 'sibling' },
    )
    assert.deepEqual(r.differences.map(d => [d.candidate, d.property]), [['child', 'fontSize']])
  })

  it('反例 5 · 只差示例数字和打码格式时清单为空，货币、附注和大小写留下', () => {
    const compare = (board, screen) => report(sample({ ...values, text: screen }, { ...values, text: board })).differences
    assert.deepEqual(compare('Image 24', 'Image 26'), [])
    assert.deepEqual(compare('sk-••••f3a9 · vault', '••••-key · vault'), [])
    for (const [a, b] of [['Total $5.23', 'Total'], ['近 7 天', '近 7 天 · 本机'], ['connected 24', 'Connected 26']]) {
      assert.deepEqual(compare(a, b).map(d => [d.property, d.board, d.screen]), [['text', a, b]])
    }
  })

  it('缺真实屏提交、逐轨少候选或批准值漂移均失败', () => {
    const r = report(sample({ ...values, fontWeight: 700 }))
    const approval = { ...decision('fontWeight', 400, 700), board: 400, screen: 700 }
    for (const screenRevision of [undefined, 'HEAD', 'abcdefz', '1'.repeat(41)]) {
      assert.match(gate([{ ...r, screenRevision }], [approval]).join('\n'), /提交|Revision/)
    }
    const m = { ...manifest, elements: [{ ...manifest.elements[0], states: ['zh-en','dark'] }] }
    const verify = (reports, decisions) => checkBoardManifest({ board: 'Gauge', manifest: { ...m, decisions },
      candidates: [{ id: candidate }], evidence: { reports, sourceSha256: r.sourceSha256 } })
    const en = { ...r, locale: 'en', theme: 'dark' }
    assert.deepEqual(verify([r, en], [approval]), [])
    assert.match(verify([r], [approval]).join('\n'), /en/)
    assert.match(verify([r, { ...en, theme: 'light' }], [approval]).join('\n'), /dark/)
    assert.match(verify([r, en], [{ ...approval, locale: 'en', theme: 'dark' }]).join('\n'), /zh-CN\/light/)
    const drift = report(sample({ ...values, fontWeight: 800 }))
    assert.match(verify([drift, en], [approval]).join('\n'), /800/)
    const unbound = { candidate, property: 'fontWeight', reason: '同意', approvedBy: '设计' }
    assert.match(verify([r, en], [unbound]).join('\n'), /未登记/)
  })

  it('同文字的不同交互角色需显式配对', () => {
    for (const role of ['button', 'link', 'textbox']) {
      const row = { index: 0, parent: -1, tag: 'button', role, own: 'Open', values }
      const target = { ...row, tag: 'span', role: null }
      const pair = screen => gauge.pairCandidates([{ row, candidate, element }], [row], [screen])[0].screen
      assert.equal(pair(target), null)
      assert.ok(pair({ ...target, mark: candidate }))
      assert.ok(pair({ ...target, role }))
    }
  })
})

it('同一候选 id 重抽后文字、标签或几何发生变化，工作树立即失去欠账豁免', async () => {
  const { writeFileSync } = await import('node:fs')
  const path = await import('node:path')
  const { REPO_ROOT } = await import('./board-extract.mjs')
  const { boardEvidence } = await import('./board-diff-evidence.mjs')
  const dir = makeTempDir('diff-census-')
  const record = { id: candidate, text: '同一个截断前缀 A', tag: 'span', bbox: [0, 0, 12, 18] }
  const name = path.relative(REPO_ROOT, path.join(dir, 'Gauge.board.json')).split(path.sep).join('/')
  const base = new Map([[name, new Map([[element, new Map([[candidate, record]])]])]])
  const verify = c => {
    writeFileSync(path.join(dir, 'Gauge.candidates.json'), JSON.stringify({ candidates: [c] }))
    return gate([], [], boardEvidence(dir, 'Gauge', base).legacy)
  }
  assert.deepEqual(verify(record), [])
  for (const change of [{ text: '同一个截断前缀 B' }, { tag: 'button' }, { bbox: [0, 0, 24, 18] }]) {
    assert.match(verify({ ...record, ...change }).join('\n'), /缺差异清单/)
  }
})

it('未成候选的格以内部认领文字定位，直接比格的 padding 和行到卡边的内缩，各报一次', () => {
  const row = (index, parent, text, mark, props) => ({
    index, parent, own: text, tag: 'div', mark, values: { ...values, ownsText: Boolean(text), text, ...props },
  })
  const rows = side => {
    const design = side === 'board'
    const style = { borderTopWidth: 1, borderBottomWidth: 0, x: design ? 0 : 13, width: design ? 200 : 174 }
    return [
      row(1, -1, '', 'card'), row(2, 1, '', 'grid', style),
      row(3, 2, '', null, { paddingLeft: design ? 14 : 12, paddingTop: design ? 10 : 0 }),
      row(4, 3, 'One', 'label-1'), row(5, 2, '', null, { paddingLeft: design ? 14 : 12 }),
      row(6, 5, 'Two', 'label-2'),
    ]
  }
  const design = rows('board'), screen = rows('screen')
  const claims = design.filter(r => r.mark).map(row => ({ row, candidate: row.mark, element }))
  const paired = gauge.pairCandidates(claims, design, screen)
  const diffs = report(...paired).differences
  const props = diffs.filter(d => d.candidate === 'grid').map(d => [d.part, d.property, d.board, d.screen])
  for (const expected of [['label-1', 'paddingLeft', 14, 12], ['label-1', 'paddingTop', 10, 0],
    ['label-2', 'paddingLeft', 14, 12], [undefined, 'insetLeft', 0, 13], [undefined, 'insetRight', 0, 13]]) {
    assert.equal(props.filter(row => row.every((v, i) => v === expected[i])).length, 1)
  }
  assert.ok(!diffs.some(d => d.property.startsWith('parentPadding') || d.property === 'width'))
  // Both labels in one live cell cannot masquerade as the two distinct designed boxes.
  screen[5].parent = 3
  const ambiguous = report(...gauge.pairCandidates(claims, design, screen))
  assert.deepEqual(ambiguous.differences.filter(d => d.property === 'pair').map(d => d.part), ['label-1', 'label-2'])
})

it('拆在内层 span 的 Key 与直接文字合成一次，已配对的子标签不会被父层再拼一次', () => {
  const row = (index, parent, own, content, mark, inline = false) => ({
    index, parent, own, content, mark, inline, tag: 'span', values: { ...values, ownsText: Boolean(own), text: own },
  })
  const a = row(1, 0, 'sk-••••f3a9 · vault', ['sk-••••f3a9 · vault', 2], 'key')
  const b = row(2, 1, 'Status', ['Status'], 'status', true)
  const actual = row(1, 0, '· vault', [3, ' · vault', 2], 'key')
  actual.values.monospace = true
  actual.values.color = 'ink-40'
  const claims = [a,b].map(row => ({ row, candidate: row.mark, element }))
  const paired = gauge.pairCandidates(claims, [a,b], [actual,b,row(3,1,'••••-key',['••••-key'],null,true)])
  assert.equal(paired[0].screen.text, '••••-key · vault')
  assert.deepEqual(report(...paired).differences.map(d => d.property), ['monospace', 'color'])
})

it('不同候选各占一轨仍然缺覆盖；同一候选须在声明的轨道上逐个出现', () => {
  const ids = ['first', 'second']
  const samples = ids.map(candidate => ({ ...sample(), candidate }))
  const m = { ...manifest, elements: [{ ...manifest.elements[0], candidates: ids, states: ['zh-en', 'dark'] }] }
  const verify = (zh, en) => checkBoardManifest({
    board: 'Gauge', manifest: m, candidates: ids.map(id => ({ id })),
    evidence: { sourceSha256: 'a'.repeat(64), reports: [report(...zh), { ...report(...en), locale: 'en', theme: 'dark' }] },
  })
  const errors = verify([samples[0]], [samples[1]]).join('\n')
  assert.match(errors, /first 缺 locale:en/)
  assert.match(errors, /first 缺 theme:dark/)
  assert.match(errors, /second 缺 locale:zh-CN/)
  assert.deepEqual(verify(samples, samples), [])
})
