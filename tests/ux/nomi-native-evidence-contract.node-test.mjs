import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test, { after } from 'node:test'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { validateNativeWalkEvidence, assertNativeProjectIsolation } from './nomi-native-evidence-contract.mjs'

const directory = makeTempDir('nomi-native-evidence-')
after(() => fs.rmSync(directory, { recursive: true, force: true }))
const layers = ['fetch', 'http', 'https', 'socket', 'chromium']
const launches = [{ pid: 101 }, { pid: 202 }]
const report = { result: 'passed', launches, textRequests: 3, imageRequests: 0, paidCalls: 0, unexpected: [] }
function log(name, events) {
  const file = path.join(directory, `${name}.jsonl`)
  fs.writeFileSync(file, events.map((event) => JSON.stringify(event)).join('\n'))
  return file
}
const loaded = launches.map(({ pid }) => ({ kind: 'guard-loaded', pid, layers }))
const validLog = log('complete', loaded)
test('every actual native launch has all five layers and exact offline request accounting', () => {
  const receipt = validateNativeWalkEvidence(report, validLog, 3)
  assert.equal(receipt.blockedAttempts, 0)
  assert.equal(receipt.errors.length, 0)
})
test('missing native guard evidence fails closed', () => {
  assert.throws(() => validateNativeWalkEvidence(report, path.join(directory, 'missing.jsonl'), 3))
})
test('empty native guard evidence fails closed', () => {
  assert.throws(() => validateNativeWalkEvidence(report, log('empty', []), 3))
})
test('duplicate first PID cannot stand in for the second actual native launch', () => {
  assert.throws(() => validateNativeWalkEvidence(report, log('duplicate-pid', [loaded[0], loaded[0]]), 3))
})
test('unrelated PID cannot stand in for the second actual native launch', () => {
  assert.throws(() => validateNativeWalkEvidence(report, log('wrong-pid', [loaded[0], { ...loaded[1], pid: 303 }]), 3))
})
test('missing guard layer and blocked/error evidence fail closed', () => {
  assert.throws(() => validateNativeWalkEvidence(report, log('missing-layer', [loaded[0], { ...loaded[1], layers: layers.slice(1) }]), 3))
  for (const kind of ['blocked', 'guard-error']) assert.throws(() => validateNativeWalkEvidence(report, log(kind, [...loaded, { kind }]), 3))
})
test('cleanup/collect failure returned normally by runtime finish cannot certify functional success', () => {
  assert.throws(() => validateNativeWalkEvidence({ ...report, result: 'failed', error: 'owned cleanup failed' }, validLog, 3))
})
test('extra image, text or paid requests cannot certify the bounded native walk', () => {
  for (const extra of [{ imageRequests: 1 }, { textRequests: 4 }, { paidCalls: 1 }]) assert.throws(() => validateNativeWalkEvidence({ ...report, ...extra }, validLog, 3))
})
test('unexpected/malformed request accounting cannot certify the bounded native walk', () => {
  for (const extra of [{ unexpected: [{}] }, { imageRequests: undefined }, { textRequests: NaN }]) assert.throws(() => validateNativeWalkEvidence({ ...report, ...extra }, validLog, 3))
})
test('all original native record types retain their own project marker family', () => {
  const bytes = JSON.stringify([{ kind: 'header' }, { kind: 'entry', text: 'PROJECT_B_PROMPT PROJECT_B_DONE' }, { kind: 'usage' }])
  assertNativeProjectIsolation(bytes, 'PROJECT_B_', 'PROJECT_A_')
})
test('foreign switch prompt and partial stream cannot enter another project transcript', () => {
  for (const marker of ['PROJECT_A_SWITCH_PROMPT', 'PROJECT_A_SWITCH_PARTIAL']) {
    const bytes = JSON.stringify([{ kind: 'entry', text: 'PROJECT_B_PROMPT PROJECT_B_DONE' }, { kind: 'value', note: marker }])
    assert.throws(() => assertNativeProjectIsolation(bytes, 'PROJECT_B_', 'PROJECT_A_'))
  }
})
