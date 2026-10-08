import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { watchCredential, recordBlocked } from './credential-precheck.mjs'

test('hung decrypt is killed and recorded blocked, later stations are unreachable', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-test-'))
  let killed = 0
  try {
    await assert.rejects(watchCredential({ directory, timeoutMs: 40,
      screen: { state: 'locked', source: 'fixture' }, kill: () => killed++,
      run: () => new Promise(() => {}) }), error => {
      assert.equal(error.code, 'CREDENTIAL_BLOCKED')
      const report = { stations: [], deviations: [] }
      recordBlocked(directory, report, error.receipt, ['02', '03'])
      assert.equal(report.result, 'blocked')
      assert.deepEqual(report.stations.map(s => s.status), ['blocked', 'unreachable', 'unreachable'])
      return true
    })
    assert.equal(killed, 1)
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'credential-precheck.json'))).reason, 'locked-screen')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('successful marker disarms decrypt deadline while later billing remains separate', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-test-'))
  try {
    const result = await watchCredential({ directory, timeoutMs: 20, screen: { state: 'unknown' },
      kill: () => assert.fail('must not kill'), run: async marker => {
        fs.writeFileSync(marker, JSON.stringify({ status: 'ready' }))
        await new Promise(resolve => setTimeout(resolve, 50))
        return 'attached'
      } })
    assert.equal(result, 'attached')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('decrypt uses the application function exactly once and only emits a safe status', async () => {
  const { decryptForDispatch } = await import('./credential-main.mjs')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-main-'))
  const marker = path.join(directory, 'marker.json')
  try {
    for (const outcome of ['secret-fixture-value', '', new Error('sensitive native error')]) {
      let calls = 0
      const invoke = () => decryptForDispatch({ record: { enc: 'safeStorage', apiKey: 'ciphertext-fixture' },
        credentialMarker: marker, decrypt: () => { calls++; if (outcome instanceof Error) throw outcome; return outcome } })
      if (outcome === 'secret-fixture-value') assert.equal(invoke(), outcome)
      else assert.throws(invoke, /CREDENTIAL_BLOCKED/)
      assert.equal(calls, 1)
      assert.doesNotMatch(fs.readFileSync(marker, 'utf8'), /secret-fixture|ciphertext|sensitive/)
    }
    assert.throws(() => decryptForDispatch({ credentialMarker: marker, decrypt: () => assert.fail('no key must not decrypt') }), /CREDENTIAL_BLOCKED/)
    assert.equal(JSON.parse(fs.readFileSync(marker)).reason, 'no-key')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('native synchronous hang cannot defeat the parent deadline', async () => {
  const { spawn } = await import('node:child_process')
  const { once } = await import('node:events')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-native-'))
  const child = spawn(process.execPath, ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)'], { stdio: 'ignore' })
  const ended = once(child, 'exit')
  try {
    await assert.rejects(watchCredential({ directory, timeoutMs: 80, screen: { state: 'unknown' },
      kill: () => child.kill('SIGKILL'), run: () => new Promise(() => {}) }), error => {
      assert.equal(error.receipt.reason, 'keychain-denied')
      assert.equal(error.receipt.screen.state, 'unknown')
      return true
    })
    const [, signal] = await ended
    assert.equal(signal, 'SIGKILL')
  } finally { child.kill('SIGKILL'); fs.rmSync(directory, { recursive: true, force: true }) }
})

test('explicit decrypt rejection is blocked; assembly failures are not disguised as credentials', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-errors-'))
  try {
    await assert.rejects(watchCredential({ directory, screen: { state: 'unlocked' }, kill: () => {},
      run: marker => { fs.writeFileSync(marker, JSON.stringify({ status: 'blocked', reason: 'keychain-denied' })); throw Error('native secret') } }), error => {
      assert.equal(error.code, 'CREDENTIAL_BLOCKED')
      assert.equal(error.receipt.reason, 'keychain-denied')
      assert.doesNotMatch(JSON.stringify(error.receipt), /native secret/)
      return true
    })
    await assert.rejects(watchCredential({ directory, screen: { state: 'unknown' }, kill: () => assert.fail('assembly is not decryption'),
      run: () => { throw Error('module missing') } }), /module missing/)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('C0 missing credentials writes blocked and eight unreachable stations without launching', async () => {
  const { spawnSync } = await import('node:child_process')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-c0-'))
  try {
    const preload = 'data:text/javascript,' + encodeURIComponent(`import os from 'node:os'; os.homedir = () => ${JSON.stringify(directory)}`)
    const result = spawnSync(process.execPath, ['--import', preload, fileURLToPath(new URL('./c0-short-film.walk.mjs', import.meta.url)), '--real'], {
      env: { ...process.env, NOMI_SWEEP_CASE_DIR: directory, NOMI_WALK_MODE: 'collect', NOMI_REAL_PROFILE_USER_DATA: directory }, encoding: 'utf8', timeout: 10000,
    })
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(fs.readFileSync(path.join(directory, 'report.json')))
    assert.equal(report.result, 'blocked')
    assert.equal(report.credentialPrecheck.reason, 'no-key')
    assert.equal(report.paidCalls, 0)
    assert.equal(report.stations.filter(s => s.status === 'unreachable').length, 8)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('sweep report marks blocked without counting a failure or a reached paid station', async () => {
  const { saveReport } = await import('./sweep-evidence.mjs')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-report-'))
  try {
    fs.writeFileSync(path.join(directory, 'run.json'), JSON.stringify({ mode: 'real-text' }))
    const paid = { id: 'paid', surface: 'agent-panel', costCny: 0 }
    recordBlocked(directory, paid, { status: 'blocked', reason: 'no-key' }, ['agent'])
    const free = { id: 'free', surface: 'timeline', costCny: 0, stations: [{ id: 'timeline', status: 'passed' }], deviations: [] }
    saveReport(directory, [paid, free], [], 3)
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'run.json'))).status, 'blocked')
    const markdown = fs.readFileSync(path.join(directory, 'report.md'), 'utf8')
    assert.match(markdown, /paid：blocked/)
    assert.match(markdown, /agent-panel \| 1 \| 0 \| 0 \| 0 \| 0/)
    assert.match(markdown, /timeline \| 1 \| 1 \| 0 \| 0 \| 0/)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
