import { makeTempDir } from '../../../scripts/_test-temp.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { copyTranscripts, saveReport, scoreCollectedAgent } from './sweep-evidence.mjs'
import { createResponseCapture, providerFailure } from './sweep-response.mjs'
test('legacy native entries export without reconstructing messages; checksum and provenance retained', () => {
  const temp = makeTempDir('sweep-native-')
  try {
    const source = path.join(temp, 'profile/project/.nomi'), output = path.join(temp, 'out')
    fs.mkdirSync(source, { recursive: true })
    const data = { header: { type: 'session', version: 3, id: 'session' }, leafId: 'two', entries: [
      { id: 'one', parentId: null, type: 'message', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'native thought' }, { type: 'toolCall', id: 'call', name: 'read', arguments: { path: 'file' } }] } },
      { id: 'two', parentId: 'one', type: 'message', message: { role: 'toolResult', toolCallId: 'call', toolName: 'read', content: [{ type: 'text', text: 'result' }], isError: false } },
    ] }
    const snapshot = { format: 'nomi.pi-work-context', data, sha256: createHash('sha256').update(JSON.stringify(data)).digest('hex') }
    const file = path.join(source, 'agent-thread-context-v1.json')
    const write = () => fs.writeFileSync(file, JSON.stringify({ records: { thread: { source: 'native', snapshot: JSON.stringify(snapshot) } } }))
    write()
    const files = copyTranscripts(path.join(temp, 'profile'), output)
    const entries = fs.readFileSync(files[0], 'utf8').trim().split('\n').map(JSON.parse)
    assert.deepEqual(entries, [data.header, ...data.entries])
    assert.equal(JSON.parse(fs.readFileSync(`${files[0]}.source.json`)).leafId, 'two')
    const tools = JSON.parse(fs.readFileSync(path.join(output, 'tools.json')))
    assert.equal(tools[0].name, 'read'); assert.equal(tools[0].ok, true)
    snapshot.sha256 = 'invalid'; write()
    assert.throws(() => copyTranscripts(path.join(temp, 'profile'), output), /checksum/)
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})
test('ledger lists every deviation and repaired failures separately', () => {
  const temp = makeTempDir('sweep-report-')
  try {
    saveReport(temp, [{ id: 'case', surface: 'storyboard', costCny: 0, stations: [{ id: 'first' }, { id: 'later', surface: 'export', status: 'unreachable' }], deviations: [
      { station: 'first', surface: 'storyboard', phenomenon: 'a|b\nnext', layer: '契约', repaired: true, repairedBy: 'fixture' },
      { station: 'later', surface: 'export', phenomenon: 'blocked', layer: '测试装配', repaired: false },
    ] }], [{ id: 'future', status: 'needs-stage-4', reason: 'not reachable' }], 3)
    const report = fs.readFileSync(path.join(temp, 'report.md'), 'utf8')
    assert.match(report, /a\\\|b next/)
    assert.match(report, /case\/first：fixture/)
    assert.match(report, /\| storyboard \| 1 \| 1 \| 1 \| 1 \| 0 \|/)
    assert.match(report, /\| export \| 1 \| 0 \| 0 \| 1 \| 0 \|/)
    assert.match(report, /needs-stage-4/)
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})
test('collected Agent failures cannot become perfect R30 even after repair or scheduler finish', () => {
  const input = { tools: [{ ok: true }], stations: [{ id: '02', status: 'failed' }], deviations: [{ station: '02', repaired: true }], stationId: '02', population: 'loopback', attempted: true }
  assert.deepEqual(scoreCollectedAgent(input).turns, { numerator: 0, denominator: 1 })
  assert.equal(scoreCollectedAgent(input).firstTool.numerator, 0)
  assert.equal(scoreCollectedAgent({ ...input, deviations: [], stations: [{ id: '02', status: 'passed' }] }).turns.numerator, 1)
  assert.equal(scoreCollectedAgent({ ...input, deviations: [{ station: '02', assertion: 'feel:font-size' }] }).turns.numerator, 1, 'UI findings do not misrepresent a successful Agent turn')
})
test('response capture drains pending bodies and preserves capture failures; prose error is not failure', async () => {
  let resolve, written
  const body = new Promise(r => { resolve = r })
  const recorder = createResponseCapture({ write(_file, text) { written = text } })
  const record = {}
  recorder.capture({ status: 200, text: () => body }, 'response.txt', record)
  const drained = recorder.drain()
  assert.equal(written, undefined)
  resolve(JSON.stringify({ choices: [{ message: { content: 'An error is a useful teaching example.' } }] }))
  assert.deepEqual(await drained, [])
  assert.ok(written.includes('error'))
  assert.equal(providerFailure([record]), null)
  assert.match(providerFailure([{ httpStatus: 400, providerError: { message: 'bad schema' } }]), /bad schema/)
  const failing = createResponseCapture({ write() { throw Error('disk unavailable') } })
  failing.capture(new Response('body'), 'failed.txt', {})
  assert.deepEqual(await failing.drain(), [{ file: 'failed.txt', message: 'disk unavailable' }])
})
test('drain waits for in-flight headers and bodies registered after drain starts', async () => {
  let headers, body, registered, written, done = false
  const waitHeaders = new Promise(resolve => { headers = resolve })
  const waitBody = new Promise(resolve => { body = resolve })
  const bodyRegistered = new Promise(resolve => { registered = resolve })
  const recorder = createResponseCapture({ write(_file, text) { written = text } })
  const request = recorder.track(async () => {
    await waitHeaders
    recorder.capture({ status: 200, text: () => waitBody }, 'late-response.txt', {})
    registered()
  })
  const drained = recorder.drain().then(errors => { done = true; return errors })
  headers()
  await bodyRegistered
  assert.equal(done, false)
  body('late body')
  await request
  assert.deepEqual(await drained, [])
  assert.equal(written, 'late body')
  let dispatched = false
  await assert.rejects(recorder.track(() => { dispatched = true }), /DRAINING/)
  assert.equal(dispatched, false)
})
test('feel ledger aggregates three stations once with count=3 and first evidence', () => {
  const temp = makeTempDir('sweep-dedup-')
  try {
    const deviations = ['first', 'second', 'third'].map((station, i) => ({
      station, surface: 'storyboard', assertion: 'feel:font-size', layer: 'UI', screenshot: `${station}.png`,
      actual: { rule: 'font-size', text: ['重复小字'], target: ['span'], rects: [{ x: i }] }, phenomenon: '重复小字',
    }))
    saveReport(temp, [{ id: 'case', surface: 'storyboard', stations: [], deviations }], [], 3)
    const rows = fs.readFileSync(path.join(temp, 'report.md'), 'utf8').split('\n').filter(row => row.includes('重复小字'))
    assert.equal(rows.length, 1)
    assert.match(rows[0], /\| 3 \|/)
    assert.match(rows[0], /case\/first/)
    assert.match(rows[0], /case\/first.png/)
    assert.equal(deviations.length, 3)
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})
test('feel identity spans cases but preserves rule, text, target and surface; functional failures stay individual', () => {
  const temp = makeTempDir('sweep-identity-')
  try {
    const hit = { station: 'first', surface: 'storyboard', assertion: 'feel:font-size', actual: { rule: 'font-size', text: ['identity-text'], target: ['span'] } }
    const variants = [hit, { ...hit, actual: { ...hit.actual, rule: 'clipping' } },
      { ...hit, actual: { ...hit.actual, text: ['other-text'] } },
      { ...hit, actual: { ...hit.actual, target: ['button'] } }, { ...hit, surface: 'export' }]
    const functional = { station: 'first', surface: 'storyboard', assertion: 'toEqual', phenomenon: 'functional-failure' }
    saveReport(temp, [
      { id: 'one', surface: 'storyboard', stations: [], deviations: [...variants, functional, functional] },
      { id: 'two', surface: 'storyboard', stations: [], deviations: [hit] },
    ], [], 3)
    const report = fs.readFileSync(path.join(temp, 'report.md'), 'utf8')
    const rows = report.split('\n').filter(row => /identity-text|other-text/.test(row))
    assert.equal(rows.length, 5)
    assert.match(rows[0], /\| 2 \|/)
    assert.equal(report.split('\n').filter(row => row.includes('functional-failure')).length, 2)
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})
