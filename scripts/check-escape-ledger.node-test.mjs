// 逃逸账本门岗的判据测试（R17：加规则必须先证明它会咬人）：判据层喂假数据，另有真目录端到端
// （构造一条不合格的 fixed 条目 → CLI 退出 1；补齐后 → 退出 0）。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CANDIDATE_MAX_DAYS,
  ESCAPE_LEDGER_DIR,
  IRON_LAW_CHECKS,
  escapeEntryPath,
  escapeIdOfPath,
  fixedTransitions,
  loadEscapeLedger,
  looksClassLevel,
  validateEscapeLedger,
} from './escape-ledger-lib.mjs'
import { META_FILE, formatEntryJson } from './lib/entryDirectory.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')

const CONTRACT = 'docs/fixes/2026-10-06-sample.root-cause.json'
const MATRIX = 'tests/experience-laws/sampleMatrix.test.mjs'
const MATRIX_SOURCE = "import { ROWS } from './sampleCatalog.mjs'\nfor (const row of ROWS) { test(row.id, () => {}) }\n"
const CONTRACT_SOURCE = JSON.stringify({ detected_by: 'user', prevention: { kind: 'type-constraint' }, note: MATRIX })
const FILES = new Map([
  [CONTRACT, CONTRACT_SOURCE],
  [MATRIX, MATRIX_SOURCE],
  [IRON_LAW_CHECKS['⑫'], '// catalog'],
  ['tests/experience-laws/single.test.mjs', "test('one scenario', () => { expect(1).toBe(1) })\n"],
])
const exists = (rel) => FILES.has(rel)
const read = (rel) => FILES.get(rel) ?? ''

const entry = (over = {}) => ({
  id: 'LAW12-sample', since: '2026-10-05', source: 't', category: 'interaction-semantics',
  problem: '点了行首的小方框，这一镜却变灰了', existingInvariants: [], ironLaws: ['⑫'], useCases: ['S6'], fullWalkJourneys: [],
  status: 'candidate', manualReview: 'pending', evidence: [], completionCommits: [], ...over,
})
const fixed = (over = {}) => entry({
  status: 'fixed', manualReview: 'reviewed', rootCauseContract: CONTRACT, fixedInPr: 1030,
  classCheck: { kind: 'matrix', file: MATRIX }, ...over,
})
const ledger = (entries) => ({
  $schemaVersion: 1,
  statusValues: ['candidate', 'reviewed', 'fixed'],
  categories: { 'interaction-semantics': '点击目标的用户预期与实际结果不一致' },
  entries,
})
const check = (entries, today = '2026-10-06') => validateEscapeLedger(ledger(entries), { today, exists, read })

test('合格的 fixed（根因合同 + 类级检查 + PR 号）：绿', () => {
  assert.deepEqual(check([fixed()]).errors, [])
  const ironLaw = fixed({ classCheck: { kind: 'iron-law', ref: '⑫', file: IRON_LAW_CHECKS['⑫'] } })
  assert.deepEqual(check([{ ...ironLaw, rootCauseContract: CONTRACT }]).errors.filter((m) => !/没有点名这条类检查/.test(m)), [])
})

test('咬人：fixed 缺根因合同 / 缺类检查 / 缺 PR 号，各自红', () => {
  assert.match(check([fixed({ rootCauseContract: undefined })]).errors.join('\n'), /必须带根因合同/)
  assert.match(check([fixed({ rootCauseContract: 'docs/fixes/missing.root-cause.json' })]).errors.join('\n'), /根因合同不存在/)
  assert.match(check([fixed({ classCheck: undefined })]).errors.join('\n'), /必须挂一条类级检查/)
  assert.match(check([fixed({ fixedInPr: undefined })]).errors.join('\n'), /合入的 PR 号/)
  assert.match(check([fixed({ fixedInPr: 0 })]).errors.join('\n'), /合入的 PR 号/)
})

test('咬人：只测单个场景的不算类级；铁律引用要对得上文件和声明', () => {
  const single = fixed({ classCheck: { kind: 'matrix', file: 'tests/experience-laws/single.test.mjs' } })
  assert.match(check([{ ...single }]).errors.join('\n'), /看不出是类级检查/)
  const wrongFile = fixed({ classCheck: { kind: 'iron-law', ref: '⑫', file: MATRIX } })
  assert.match(check([wrongFile]).errors.join('\n'), /铁律 ⑫ 的检查文件是/)
  const undeclared = fixed({ ironLaws: [], classCheck: { kind: 'iron-law', ref: '⑫', file: IRON_LAW_CHECKS['⑫'] } })
  assert.match(check([undeclared]).errors.join('\n'), /没有声明属于铁律 ⑫/)
  assert.match(check([fixed({ classCheck: { kind: 'iron-law', ref: '⑬', file: MATRIX } })]).errors.join('\n'), /classCheck\.ref 必须是铁律/)
  assert.match(check([fixed({ classCheck: { kind: 'matrix', file: 'tests/experience-laws/gone.test.mjs' } })]).errors.join('\n'), /不存在/)
  assert.match(check([fixed({ classCheck: { kind: 'unit', file: MATRIX } })]).errors.join('\n'), /kind 必须是/)
})

test('咬人：根因合同必须有 detected_by、结构性预防，并点名这条类检查', () => {
  const swap = (source) => { FILES.set(CONTRACT, source) }
  try {
    swap(JSON.stringify({ prevention: { kind: 'x' }, note: MATRIX }))
    assert.match(check([fixed()]).errors.join('\n'), /缺 detected_by/)
    swap(JSON.stringify({ detected_by: 'user', note: MATRIX }))
    assert.match(check([fixed()]).errors.join('\n'), /没有结构性预防/)
    swap(JSON.stringify({ detected_by: 'user', prevention: { kind: 'x' } }))
    assert.match(check([fixed()]).errors.join('\n'), /没有点名这条类检查/)
    swap('{ not json')
    assert.match(check([fixed()]).errors.join('\n'), /不是合法 JSON/)
  } finally { swap(CONTRACT_SOURCE) }
  assert.deepEqual(check([fixed()]).errors, [])
})

test('账本格式不合法 → 红：未登记类别、重复 id、缺 since、状态非法、没复核就 fixed', () => {
  const text = (entries) => check(entries).errors.join('\n')
  assert.match(text([entry({ category: 'nope' })]), /没在 categories 里登记/)
  assert.match(text([entry(), entry()]), /id 重复/)
  assert.match(text([entry({ since: undefined })]), /since 必须是 YYYY-MM-DD/)
  assert.match(text([entry({ status: 'done' })]), /status 必须是/)
  assert.match(text([fixed({ manualReview: 'pending' })]), /必须先人工复核/)
  assert.match(text([entry({ problem: '坏了' })]), /problem 必须写清/)
  assert.match(validateEscapeLedger({ ...ledger([]), $schemaVersion: 2 }, { today: '2026-10-06' }).errors.join(), /\$schemaVersion/)
})

test(`candidate 停留超过 ${CANDIDATE_MAX_DAYS} 天 → 警告（不阻断）；刚好 ${CANDIDATE_MAX_DAYS} 天不警告`, () => {
  const stale = check([entry({ since: '2026-09-20' })], '2026-10-06')
  assert.deepEqual(stale.errors, [])
  assert.match(stale.warnings.join('\n'), /candidate 已停留 16 天/)
  assert.equal(check([entry({ since: '2026-09-22' })], '2026-10-06').warnings.length, 0)
  assert.equal(check([fixed({ since: '2026-08-01' })], '2026-10-06').warnings.length, 0, '已结账的不再提醒')
})

test('fixedTransitions：只有 candidate / reviewed → fixed 的算状态转换；已是 fixed 的不重复算', () => {
  const base = ledger([entry({ id: 'a' }), entry({ id: 'b', status: 'reviewed', manualReview: 'reviewed' }), fixed({ id: 'c' })])
  const head = ledger([entry({ id: 'a' }), fixed({ id: 'b' }), fixed({ id: 'c' }), fixed({ id: 'd' })])
  assert.deepEqual(fixedTransitions(base, head), ['b', 'd'])
  assert.deepEqual(fixedTransitions(base, base), [])
  assert.deepEqual(fixedTransitions(null, head), ['b', 'c', 'd'])
})

test('looksClassLevel：遍历清单 / 参数化算，单场景不算', () => {
  assert.equal(looksClassLevel(MATRIX_SOURCE), true)
  assert.equal(looksClassLevel("describe.each(MODEL_ROWS)('m', () => {})"), false, '没有清单来源字样')
  assert.equal(looksClassLevel("import { ledger } from './l'\nit.each(ledger.rows)('x', () => {})"), true)
  assert.equal(looksClassLevel("test('one', () => { expect(1).toBe(1) })"), false)
})

/** 把一份账本对象落成目录（一条一个文件），先清掉旧目录——测试里「整本换掉」就是这个意思。 */
function writeLedgerDirectory(root, value) {
  const dir = path.join(root, ESCAPE_LEDGER_DIR)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const { entries, ...meta } = value
  fs.writeFileSync(path.join(dir, META_FILE), formatEntryJson(meta))
  for (const item of entries) fs.writeFileSync(path.join(root, escapeEntryPath(item.id)), formatEntryJson(item))
}

test('真实账本：现状是绿的', () => {
  const real = loadEscapeLedger(repoRoot)
  const result = validateEscapeLedger(real, {
    today: '2026-10-06',
    exists: (rel) => fs.existsSync(path.join(repoRoot, rel)),
    read: (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8'),
  })
  assert.deepEqual(result.errors, [])
  for (const file of Object.values(IRON_LAW_CHECKS)) assert.ok(fs.existsSync(path.join(repoRoot, file)), `${file} 必须存在（铁律检查文件登记）`)
})

test('端到端：不合格的 fixed 条目 → CLI 退出 1；补齐根因合同、类检查、PR 号后 → 退出 0；candidate 超期只警告', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'escape-ledger-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  }
  const run = (today) => spawnSync(process.execPath, [path.join(here, 'check-escape-ledger.mjs')], {
    encoding: 'utf8', env: { ...process.env, ESCAPE_LEDGER_REPO_ROOT: root, ESCAPE_LEDGER_TODAY: today },
  })
  writeLedgerDirectory(root, ledger([entry({ since: '2026-09-01' }), fixed({ id: 'LAW12-bad', rootCauseContract: undefined, classCheck: undefined, fixedInPr: undefined })]))
  const red = run('2026-10-06')
  assert.equal(red.status, 1, red.stdout + red.stderr)
  assert.match(red.stderr, /LAW12-bad/)
  assert.match(red.stderr, /必须带根因合同/)
  assert.match(red.stderr, /必须挂一条类级检查/)
  assert.match(red.stderr, /合入的 PR 号/)
  assert.match(red.stderr, /candidate 已停留/, '超期的 candidate 在红的同时也要提醒')

  write(CONTRACT, CONTRACT_SOURCE)
  write(MATRIX, MATRIX_SOURCE)
  writeLedgerDirectory(root, ledger([entry({ since: '2026-09-01' }), fixed({ id: 'LAW12-bad' })]))
  const green = run('2026-10-06')
  assert.equal(green.status, 0, green.stdout + green.stderr)
  assert.match(green.stderr, /candidate 已停留/, '只警告、不阻断')
  assert.match(green.stdout, /fixed 1/)
})

test('一条一个文件：目录不在 / 缺 _meta.json / 文件坏了 / 文件名和 id 对不上 → CLI 红并点名', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'escape-ledger-dir-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const run = () => spawnSync(process.execPath, [path.join(here, 'check-escape-ledger.mjs')], {
    encoding: 'utf8', env: { ...process.env, ESCAPE_LEDGER_REPO_ROOT: root, ESCAPE_LEDGER_TODAY: '2026-10-06' },
  })
  const missing = run()
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /逃逸账本不存在/)

  writeLedgerDirectory(root, ledger([entry()]))
  assert.equal(run().status, 0, '合格的目录是绿的')

  fs.rmSync(path.join(root, ESCAPE_LEDGER_DIR, META_FILE))
  const noMeta = run()
  assert.equal(noMeta.status, 1)
  assert.match(noMeta.stderr, /_meta[.]json 不存在/)

  writeLedgerDirectory(root, ledger([entry()]))
  fs.writeFileSync(path.join(root, ESCAPE_LEDGER_DIR, 'LAW12-broken.json'), '{ not json')
  const broken = run()
  assert.equal(broken.status, 1)
  assert.match(broken.stderr, /LAW12-broken[.]json 不是合法 JSON/)

  writeLedgerDirectory(root, ledger([entry()]))
  fs.writeFileSync(path.join(root, ESCAPE_LEDGER_DIR, 'LAW12-other.json'), formatEntryJson(entry()))
  const renamed = run()
  assert.equal(renamed.status, 1, '同一个 id 落在两个文件里：文件名对不上')
  assert.match(renamed.stderr, /LAW12-other[.]json：文件名必须是「<id>[.]json」/)
})

test('一条一个文件：id 就是文件名——非法字符、只差大小写都红；路径 ↔ id 一一对应', () => {
  const text = (entries) => check(entries).errors.join(' | ')
  assert.match(text([entry({ id: 'LAW12/evil' })]), /id 只许字母数字开头/)
  assert.match(text([entry({ id: 'law12-sample' }), entry({ id: 'LAW12-sample' })]), /只差大小写/)
  assert.throws(() => escapeEntryPath('../x'), /只许字母数字开头/)
  assert.equal(escapeEntryPath('LAW12-a.b_c'), `${ESCAPE_LEDGER_DIR}/LAW12-a.b_c.json`)
  assert.equal(escapeIdOfPath(escapeEntryPath('LAW12-a.b_c')), 'LAW12-a.b_c')
  assert.equal(escapeIdOfPath(`${ESCAPE_LEDGER_DIR}/${META_FILE}`), null)
  assert.equal(escapeIdOfPath('tests/ux/full-walk/other.json'), null)
  for (const item of loadEscapeLedger(repoRoot).entries) {
    assert.equal(escapeIdOfPath(escapeEntryPath(item.id)), item.id, `真实账本的 ${item.id} 往返不变`)
  }
})

test('loadEscapeLedger：条目按 since + id 稳定排序；读某个提交与读工作树结果相同', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'escape-ledger-ref-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  writeLedgerDirectory(root, ledger([entry({ id: 'b', since: '2026-10-02' }), entry({ id: 'c', since: '2026-10-01' }), entry({ id: 'a', since: '2026-10-02' })]))
  const loaded = loadEscapeLedger(root)
  assert.deepEqual(loaded.entries.map((item) => item.id), ['c', 'a', 'b'])
  const git = (...args) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, encoding: 'utf8' })
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'ledger')
  assert.deepEqual(loadEscapeLedger(root, { ref: 'HEAD' }), loaded)
  fs.rmSync(path.join(root, ESCAPE_LEDGER_DIR), { recursive: true })
  assert.equal(loadEscapeLedger(root), null, '目录不在 → null（由门岗报红）')
  git('rm', '-q', '-r', '--cached', ESCAPE_LEDGER_DIR); git('commit', '-q', '-m', 'drop')
  assert.equal(loadEscapeLedger(root, { ref: 'HEAD' }), null, '那个提交上没有目录 → null')
})
