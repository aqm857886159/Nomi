import { makeTempDir } from './_test-temp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import assert from 'node:assert/strict'
import { load } from 'js-yaml'
import { BUILD_GATE_STATUS, BUILD_GATE_WALK } from './nightly-build-gate.mjs'
import * as summary from './nightly-walk-summary.mjs'

const { classifyRow, summarizeRows, updateIssue, makeLogReader, readRows, wakeVerdict } = summary
const row = (walk, status = 1, log = `${walk}.log`) => ({ walk, status, seconds: 3, log })
const receipt = (run = '2', sha = 'b'.repeat(40)) => ({ run, sha, attempt: '1', time: '2026-11-09T03:17:00Z', url: `https://github.com/o/r/actions/runs/${run}` })
const ids = ['0', '1', '2', '3', 'packaged-mac']
function evidence(rows, current = receipt()) {
  const batches = ids.map((batch, i) => ({ batch, walks: rows.filter((r, n) => n % ids.length === i && r.walk !== BUILD_GATE_WALK).map((r) => r.walk) }))
  return { receipt: current, expectedBatches: batches, manifests: batches.map((b) => ({ ...b, ...current })), sentinels: batches.map((b) => ({ batch: b.batch, ...current, result: 'success' })), needs: { walks: { result: 'success' }, 'packaged-mac': { result: 'success' } } }
}
const summarize = (rows, options = evidence(rows)) => summarizeRows(rows, () => 'AssertionError: expected one, received zero', options)
function fakeGh(body = '', exists = true, acceptedComments = []) {
  const calls = []
  const run = (args) => {
    calls.push(args)
    if (args[1] === 'list') return JSON.stringify(exists ? [{ number: 1121, title: summary.ISSUE_TITLE }] : [])
    if (args[1] === 'view') return JSON.stringify({ body, comments: acceptedComments.map((body) => ({ body })) })
    if (args[1] === 'edit' || args[1] === 'create') body = fs.readFileSync(args[args.indexOf('--body-file') + 1], 'utf8')
    if (args[1] === 'comment') {
      const message = fs.readFileSync(args[args.indexOf('--body-file') + 1], 'utf8')
      calls[calls.length - 1] = [...args, message]; acceptedComments.push(message)
    }
    return ''
  }
  return { calls, run, get body() { return body }, get comments() { return calls.filter((a) => a[1] === 'comment').map((a) => a.at(-1)) } }
}
function publish(rows, previous = '', options = evidence(rows)) {
  const gh = fakeGh(previous)
  updateIssue({ result: summarize(rows, options), repo: 'o/r', run: gh.run })
  return gh
}
function replay(run) {
  const root = new URL('./fixtures/nightly-summary/', import.meta.url)
  const data = JSON.parse(fs.readFileSync(new URL(`${run}.json`, root), 'utf8'))
  const rows = []
  for (const name of fs.readdirSync(root).filter((n) => n.startsWith(`${run}-`) && n.endsWith('.tsv'))) {
    for (const line of fs.readFileSync(new URL(name, root), 'utf8').trim().split('\n')) {
      const [walk, status, seconds, log] = line.split('\t'); rows.push({ walk, status: Number(status), seconds: Number(seconds), log })
    }
  }
  const current = receipt(run, data.sha); current.time = data.time
  const options = evidence([], current)
  const walks = data.selected.filter((w) => !w.endsWith('.e2e.mjs'))
  options.expectedBatches = ids.map((batch) => ({ batch, walks: batch === 'packaged-mac' ? data.selected.filter((w) => w.endsWith('.e2e.mjs')) : walks.filter((w, i) => i % 4 === Number(batch)) }))
  // Historical workflow had no manifest/sentinel: do not fabricate protocol evidence.
  options.manifests = []; options.sentinels = []
  options.needs = { walks: { result: 'failure' }, 'packaged-mac': { result: data.jobs.find((j) => j.name === 'Packaged smoke (macOS)').conclusion } }
  return { rows, options, data }
}

test('A1 real 11-04 replay: failed batches plus one exit0 never recovers', () => {
  const { rows, options } = replay('41818135076')
  assert.equal(rows.length, 1)
  const result = summarize(rows, options)
  assert.equal(result.integrity.complete, false)
  assert.equal(result.missing.length, 366)
  assert.match(result.markdown, /批次|infrastructure/)
  const gh = fakeGh('legacy body')
  updateIssue({ result, repo: 'o/r', run: gh.run })
  assert.doesNotMatch(gh.body + gh.comments.join('\n'), /已恢复/)
  assert.match(gh.body, /walks.*failure/)
})

test('A2 real 11-08 replay: 380 expected, 190 received, 190 missing', () => {
  const { rows, options } = replay('42471617380')
  const result = summarize(rows, options)
  assert.equal(rows.length, 190)
  assert.equal(result.failed.length, 75)
  assert.equal(result.missing.length, 190)
  assert.equal(result.passed.length, 113)
  assert.match(result.markdown, /缺失 190/)
  assert.match(result.markdown, /不可.*比较/)
  assert.equal(result.integrity.complete, false)
})

test('A3 exit125 is skipped, never green or recovery', () => {
  const rows = [row('a.walk.mjs', 0), row('b.walk.mjs', 125), row('c.walk.mjs', 124)]
  const result = summarize(rows)
  assert.equal(result.passed.length, 1)
  assert.equal(result.skipped.length, 1)
  assert.equal(result.total, 2)
  assert.match(result.markdown, /1\/3 passed; 1 failed; 1 skipped/)
  const gh = publish([row('skip.walk.mjs', 125)])
  assert.doesNotMatch(gh.body + gh.comments.join(''), /已恢复/)
})

test('A4 merge cross-night state: missing/skip preserve red; green to red records episode and prior green', () => {
  const first = publish([row('old.walk.mjs'), row('new.walk.mjs', 0)])
  let state = summary.readState(first.body).state
  assert.equal(state.walks['old.walk.mjs'].firstObservedRed, null, 'bootstrap red is stock, unknown first red')
  const rows = [row('new.walk.mjs')]
  const next = publish(rows, first.body, evidence([row('old.walk.mjs'), ...rows], receipt('3', 'c'.repeat(40))))
  state = summary.readState(next.body).state
  assert.equal(state.walks['old.walk.mjs'].lastKnownStatus, 'red')
  assert.equal(state.walks['old.walk.mjs'].latestEvidenceRun, '2')
  assert.equal(state.walks['new.walk.mjs'].firstObservedRed.sha, 'c'.repeat(40))
  assert.equal(state.walks['new.walk.mjs'].firstObservedRed.run, '3')
  assert.equal(state.walks['new.walk.mjs'].lastGreen.sha, 'b'.repeat(40))
  assert.equal(next.comments.length, 1)
  const skip = publish([row('old.walk.mjs', 125)], next.body)
  assert.equal(summary.readState(skip.body).state.walks['old.walk.mjs'].lastKnownStatus, 'red')
  const green = publish([row('new.walk.mjs', 0)], next.body)
  const again = publish([row('new.walk.mjs')], green.body)
  assert.equal(summary.readState(again.body).state.walks['new.walk.mjs'].episodes.length, 1)
  assert.equal(again.comments.length, 1)
})

test('A5 corrupt/missing prior state is unknown and cannot announce recovery', () => {
  const first = publish([row('x.walk.mjs')])
  for (const bad of [first.body.replace('"version":1', '"version":9'), first.body.replace('"encoding":"gzip-base64"', '"encoding":"bad"'), '<!-- nightly-state:start -->bad JSON<!-- nightly-state:end -->', 'legacy body']) {
    const gh = publish([row('x.walk.mjs', 0)], bad)
    assert.match(gh.body, /unknown/)
    assert.doesNotMatch(gh.body + gh.comments.join(''), /已恢复/)
  }
})

test('A6 new red comment lists each failure and provenance once; stock red stays silent, no at characters', () => {
  const green = publish([row('a.walk.mjs', 0), row('b.walk.mjs', 0)])
  const rows = [row('a.walk.mjs'), row('b.walk.mjs')]
  const next = publish(rows, green.body, evidence(rows, receipt('3', 'c'.repeat(40))))
  assert.equal(next.comments.length, 1)
  for (const walk of ['a.walk.mjs', 'b.walk.mjs']) assert.match(next.comments[0], new RegExp(walk.replaceAll('.', '\\.')))
  for (const text of ['AssertionError', '#artifacts', 'c'.repeat(40), 'b'.repeat(40), 'https://github.com/o/r/actions/runs/3', '建议主人']) assert.ok(next.comments[0].includes(text), text)
  assert.doesNotMatch(next.comments[0], /@/)
  const repeat = publish(rows, next.body, evidence(rows, receipt('4')))
  assert.equal(repeat.comments.length, 0)
  assert.equal(publish(rows).comments.length, 0, 'bootstrap is stock')
  const unknown = publish([...rows, row('brand-new.walk.mjs')], next.body)
  assert.match(unknown.comments[0], /首次观测红.*基线未知/)
})

test('A7 unrecognized failure, timeout and absent log are undetermined, never product', () => {
  assert.equal(classifyRow(row('a.walk.mjs'), 'expected one').kind, 'unknown')
  assert.equal(classifyRow(row('a.walk.mjs', 124), 'running').kind, 'unknown')
  assert.equal(classifyRow(row('a.walk.mjs'), null).kind, 'unknown')
  assert.equal(classifyRow(row(BUILD_GATE_WALK, BUILD_GATE_STATUS), null).kind, 'gate')
  const fixtures = ['ECONNREFUSED', 'ENOENT /Users/fixture/example', 'ERR_MODULE_NOT_FOUND', 'model-catalog ENOENT', 'ENOENT Movies/real-media']
  assert.equal(fixtures.length, summary.ENV_SIGNATURES.length)
  for (const log of fixtures) assert.equal(classifyRow(row('a.walk.mjs'), log).kind, 'env')
})

test('A8 --read-state prints machine JSON without accessing gh or writing files', (t) => {
  const root = makeTempDir('nomi-nightly-state-'); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const body = path.join(root, 'issue.md'); fs.writeFileSync(body, publish([row('a.walk.mjs')]).body)
  const output = execFileSync(process.execPath, ['scripts/nightly-walk-summary.mjs', '--read-state', body], { encoding: 'utf8', env: { ...process.env, GH_REPO: 'invalid/repo' } })
  const result = JSON.parse(output)
  assert.equal(result.status, 'ok')
  assert.equal(result.state.walks['a.walk.mjs'].lastKnownStatus, 'red')
  fs.writeFileSync(body, 'bad state')
  const bad = spawnSync(process.execPath, ['scripts/nightly-walk-summary.mjs', '--read-state', body], { encoding: 'utf8' })
  assert.equal(JSON.parse(bad.stdout).status, 'unknown')
  assert.equal(bad.status, 1)
})

test('complete successful observed green can recover once; body keeps human notes and current state', () => {
  const red = publish([row('a.walk.mjs')], 'Human note before ledger')
  const green = publish([row('a.walk.mjs', 0)], red.body)
  assert.equal(green.comments.length, 1)
  assert.match(green.comments[0], /已恢复/)
  assert.match(green.body, /Human note before ledger/)
  assert.equal(publish([row('a.walk.mjs', 0)], green.body).comments.length, 0)
  assert.equal(summary.readState(green.body).state.walks['a.walk.mjs'].lastKnownStatus, 'green')
})

test('invalid/duplicate/unexpected rows and stale manifests/sentinels fail closed', () => {
  const rows = [row('a.walk.mjs', 0)]
  for (const mutate of [
    (o) => { o.manifests[0].sha = 'stale' },
    (o) => { o.sentinels[0].run = 'stale' },
    (o) => { o.sentinels[0].attempt = '2' },
    (o) => { o.sentinels[0].result = 'running' },
    (o) => { o.manifests[0].walks = [] },
    (o) => { o.needs.walks.result = 'cancelled' },
    (o) => { o.needs = {} },
  ]) {
    const options = evidence(rows); mutate(options)
    assert.equal(summarize(rows, options).integrity.complete, false)
    assert.doesNotMatch(publish(rows, '', options).comments.join(''), /已恢复/)
  }
  const duplicate = summarize([rows[0], rows[0]], evidence(rows))
  assert.equal(duplicate.passed.length, 0)
  assert.equal(duplicate.missing.length, 1)
  assert.equal(summarize([row('a.walk.mjs', NaN)], evidence(rows)).passed.length, 0)
  assert.equal(summarize([row('a.walk.mjs', 0), row('surprise', 0)], evidence(rows)).integrity.complete, false)
})

test('retained red outside current selection blocks recovery; integrity regression comments once', () => {
  const first = publish([row('old.walk.mjs'), row('a.walk.mjs', 0)])
  const next = publish([row('a.walk.mjs', 0)], first.body)
  assert.doesNotMatch(next.comments.join(''), /已恢复/)
  assert.equal(summary.readState(next.body).state.walks['old.walk.mjs'].lastKnownStatus, 'red')
  const options = evidence([row('a.walk.mjs', 0)]); options.sentinels = []
  const broken = publish([row('a.walk.mjs', 0)], next.body, options)
  assert.equal(broken.comments.length, 1)
  assert.match(broken.comments[0], /完整性/)
  assert.equal(publish([row('a.walk.mjs', 0)], broken.body, options).comments.length, 0)
})

test('manifest and sentinel CLI work before dependencies; workflow carries needs and always uploads', (t) => {
  const workflow = load(fs.readFileSync('.github/workflows/nightly-walkthroughs.yml', 'utf8'))
  for (const job of [workflow.jobs.walks, workflow.jobs['packaged-mac']]) {
    const start = job.steps.findIndex((s) => s.name === 'Record selected manifest and batch sentinel')
    assert.ok(start > 0 && start < job.steps.findIndex((s) => s.name === 'Install dependencies'))
    const finish = job.steps.find((s) => s.name === 'Record batch conclusion')
    assert.equal(finish.if, 'always()')
    assert.match(finish.env.BATCH_RESULT, /job.status/)
    assert.equal(job.steps.find((s) => s.uses?.startsWith('actions/upload-artifact')).if, 'always()')
  }
  assert.equal(workflow.jobs.report.steps.find((s) => s.name === 'Publish summary and update issue').env.NIGHTLY_NEEDS, '${{ toJSON(needs) }}')
  assert.equal(workflow.jobs.report.steps.find((s) => s.uses?.startsWith('actions/download-artifact'))['continue-on-error'], true)
  const root = makeTempDir('nomi-nightly-manifest-'); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const env = { ...process.env, GITHUB_SHA: 'b'.repeat(40), GITHUB_RUN_ID: '2', GITHUB_RUN_ATTEMPT: '1', BATCH_RESULT: 'failure' }
  for (const batch of ['0', 'packaged-mac']) {
    execFileSync(process.execPath, ['scripts/nightly-walk-summary.mjs', '--manifest', root, batch], { env })
    execFileSync(process.execPath, ['scripts/nightly-walk-summary.mjs', '--finish', root, batch], { env })
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, `batch-${batch}.json`))).result, 'failure')
    assert.ok(JSON.parse(fs.readFileSync(path.join(root, `selected-${batch}.json`))).walks.length > 0)
  }
})

test('readRows and log reader retain explicit status, missing logs and wake thresholds', (t) => {
  const root = makeTempDir('nomi-nightly-logs-'); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(path.join(root, 'results-0.tsv'), 'a.walk.mjs\t0\t3\tnightly-walks/a.log\nb.walk.mjs\t125\t1\tb.log\n')
  fs.writeFileSync(path.join(root, 'a.log'), 'hello')
  assert.deepEqual(readRows(root).map((r) => r.status), [0, 125])
  assert.equal(makeLogReader(root)(readRows(root)[0]), 'hello')
  assert.equal(makeLogReader(root)(readRows(root)[1]), null)
  assert.equal(wakeVerdict({ failed: 30, total: 1000, gate: 0 }).red, false)
  assert.equal(wakeVerdict({ failed: 31, total: 1000, gate: 0 }).red, true)
  assert.equal(wakeVerdict({ failed: 2, total: 10, gate: 0 }).red, false)
  assert.equal(wakeVerdict({ failed: 3, total: 11, gate: 0 }).red, true)
})

test('untrusted run/batch observations never clear a known red or advance evidence', () => {
  const first = publish([row('a.walk.mjs')])
  for (const mutate of [
    (o) => { o.manifests[0].sha = 'stale' },
    (o) => { o.sentinels[0].attempt = 'old' },
  ]) {
    const rows = [row('a.walk.mjs', 0)]; const options = evidence(rows); mutate(options)
    const state = summary.readState(publish(rows, first.body, options).body).state
    assert.equal(state.walks['a.walk.mjs'].lastKnownStatus, 'red')
    assert.equal(state.walks['a.walk.mjs'].lastObservedStatus, 'missing')
  }
  const wrongBatch = summarize([{ ...row('a.walk.mjs', 0), batch: '3' }], evidence([row('a.walk.mjs')]))
  assert.equal(wrongBatch.missing.length, 1)
  assert.equal(wrongBatch.passed.length, 0)
})

test('read-state rejects corrupted decoded schemas and returns JSON for an unreadable file', (t) => {
  const root = makeTempDir('nomi-nightly-read-state-'); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const missing = spawnSync(process.execPath, ['scripts/nightly-walk-summary.mjs', '--read-state', path.join(root, 'absent.md')], { encoding: 'utf8' })
  assert.equal(missing.status, 1)
  assert.equal(JSON.parse(missing.stdout).status, 'unknown')
  const first = publish([row('a.walk.mjs')])
  const state = summary.readState(first.body).state
  for (const mutate of [
    (s) => { delete s.walks },
    (s) => { s.walks['a.walk.mjs'].lastKnownStatus = 'orange' },
    (s) => { s.walks['a.walk.mjs'].firstObservedRed = {} },
    (s) => { s.walks['a.walk.mjs'].episodes = [null] },
    (s) => { s.latestRun = null },
  ]) {
    const bad = structuredClone(state); mutate(bad)
    const encoded = JSON.stringify({ version: 1, encoding: 'gzip-base64', data: gzipSync(JSON.stringify(bad)).toString('base64') })
    const body = `<!-- nightly-state:start -->${encoded}<!-- nightly-state:end -->`
    assert.equal(summary.readState(body).status, 'unknown')
    assert.doesNotMatch(publish([row('a.walk.mjs', 0)], body).comments.join(''), /已恢复/)
  }
})

test('hundreds of receipt-bearing states fit the issue; write failures never silently discard evidence', () => {
  const data = JSON.parse(fs.readFileSync(new URL('./fixtures/nightly-summary/42471617380.json', import.meta.url)))
  const green = data.selected.map((walk) => row(walk, 0))
  const first = publish(green, 'Historical summary '.repeat(400))
  const reds = green.map((r, i) => ({ ...r, status: i < 150 ? 1 : 0 }))
  const next = publish(reds, first.body)
  assert.ok(next.body.length < 65000)
  assert.ok(next.comments[0].length < 65000)
  assert.equal(summary.readState(next.body).state.walks[data.selected[0]].firstObservedRed.run, '2')
  assert.equal(next.comments.length, 1)
  const gh = fakeGh('human notes')
  assert.throws(() => updateIssue({ result: summarize([row('a.walk.mjs')]), repo: 'o/r', run(args) { if (args[1] === 'view') throw new Error('cannot read body'); return gh.run(args) } }), /cannot read body/)
  assert.equal(gh.calls.some((c) => ['edit', 'create', 'comment'].includes(c[1])), false)
})

test('comment failure retains first-red evidence for next run; accepted-but-uncertain comments are not duplicated', () => {
  const green = publish([row('a.walk.mjs', 0)])
  const redRows = [row('a.walk.mjs')]
  for (const accepted of [false, true]) {
    const transport = fakeGh(green.body)
    assert.throws(() => updateIssue({ result: summarize(redRows, evidence(redRows, receipt('3', 'c'.repeat(40)))), repo: 'o/r', run(args) {
      if (args[1] !== 'comment') return transport.run(args)
      if (accepted) transport.run(args)
      throw new Error('comment transport failed')
    } }), /comment transport failed/)
    const pending = summary.readState(transport.body).state
    assert.ok(pending.pendingComment)
    assert.equal(pending.walks['a.walk.mjs'].firstObservedRed.run, '3')
    const next = fakeGh(transport.body, true, [...transport.comments])
    updateIssue({ result: summarize(redRows, evidence(redRows, receipt('4', 'd'.repeat(40)))), repo: 'o/r', run: next.run })
    assert.equal(next.comments.length, accepted ? 0 : 1)
    if (!accepted) {
      assert.match(next.comments[0], /run 3/)
      assert.ok(next.comments[0].includes('c'.repeat(40)))
    }
    assert.equal(summary.readState(next.body).state.pendingComment, null)
    assert.equal(summary.readState(next.body).state.walks['a.walk.mjs'].firstObservedRed.run, '3')
  }
})
