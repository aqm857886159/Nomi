/* global process */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { DIMENSIONS, buildReport, runRealUserGates, selectJourneys, validateManifest } from './real-user-test-gates.mjs'
import { REAL_USER_TEST_MANIFEST } from '../tests/system/real-user-test-gates.mjs'

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-real-user-gates-'))

test('the manifest registers the three product journeys and existing MCP coverage across H/B/E/T/N', () => {
  const validation = validateManifest(REAL_USER_TEST_MANIFEST, { root: process.cwd() })
  assert.deepEqual(validation.errors, [])
  assert.deepEqual(validation.dimensions, DIMENSIONS)
  assert.ok(REAL_USER_TEST_MANIFEST.journeys.some((journey) => journey.id === 'resident-composer-receipt'))
  assert.ok(REAL_USER_TEST_MANIFEST.journeys.some((journey) => journey.id === 'storyboard-agent-canonical'))
  assert.ok(REAL_USER_TEST_MANIFEST.journeys.some((journey) => journey.id === 'production-mcp'))
  assert.ok(REAL_USER_TEST_MANIFEST.journeys.some((journey) => journey.id === 'mcp-l1-handshake'))
})

test('manifest validation rejects empty, duplicate, unknown, and incomplete entries', () => {
  const base = {
    schemaVersion: 1,
    dimensions: [...DIMENSIONS],
    journeys: [
      {
        id: 'one',
        capability: 'one',
        command: { command: 'node', args: ['tests/ux/one.mjs'] },
        provider: { loopback: { state: 'loopback' }, live: { state: 'blocked', reason: 'auth' } },
        dimensions: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, { status: 'ready', evidence: 'x' }])),
        persistence: { status: 'required', evidence: 'x' },
        restart: { status: 'required', evidence: 'x' },
        visual: { status: 'not-applicable', reason: 'x' },
      },
    ],
  }
  assert.ok(validateManifest(null, { root: process.cwd() }).errors.some((error) => /manifest/.test(error)))
  assert.ok(
    validateManifest({ ...base, journeys: [] }, { root: process.cwd() }).errors.some((error) => /journey/.test(error)),
  )
  assert.ok(
    validateManifest(
      { ...base, journeys: [base.journeys[0], { ...base.journeys[0], id: 'one' }] },
      { root: process.cwd() },
    ).errors.some((error) => /duplicate id/.test(error)),
  )
  assert.ok(
    validateManifest(
      { ...base, journeys: [{ ...base.journeys[0], dimensions: { ...base.journeys[0].dimensions, H: undefined } }] },
      { root: process.cwd() },
    ).errors.some((error) => /missing H/.test(error)),
  )
})

test('capability selection rejects empty and unknown capabilities', () => {
  assert.throws(() => selectJourneys(REAL_USER_TEST_MANIFEST, { capability: '' }), /capability selection is empty/)
  assert.throws(() => selectJourneys(REAL_USER_TEST_MANIFEST, { capability: 'does-not-exist' }), /unknown capability/)
  const selected = selectJourneys(REAL_USER_TEST_MANIFEST, { capability: 'resident-composer-receipt,production-mcp' })
  assert.deepEqual(
    selected.map((journey) => journey.id),
    ['resident-composer-receipt', 'production-mcp'],
  )
})

test('a passing loopback execution writes actionable H/B/E/T/N, persistence, restart, and visual report evidence', async () => {
  const runDir = tempDir()
  const manifest = {
    schemaVersion: 1,
    dimensions: [...DIMENSIONS],
    journeys: [
      {
        id: 'passing',
        capability: 'passing',
        command: { command: 'node', args: ['-e', 'process.stdout.write("PASS")'] },
        provider: {
          loopback: { state: 'loopback', evidence: 'local boundary' },
          live: { state: 'blocked', reason: 'credentials required' },
        },
        dimensions: Object.fromEntries(
          DIMENSIONS.map((dimension) => [dimension, { status: 'ready', evidence: `${dimension} assertion` }]),
        ),
        persistence: { status: 'required', evidence: 'disk receipt' },
        restart: { status: 'required', evidence: 'cold readback' },
        visual: { status: 'pending-review', evidence: 'captured screenshots require human review' },
      },
    ],
  }
  const result = await runRealUserGates({
    manifest,
    provider: 'loopback',
    runDir,
    execute: async () => ({ status: 'passed', exitCode: 0, stdout: 'PASS', stderr: '' }),
  })
  assert.equal(result.exitCode, 0)
  assert.equal(result.summary.passed, 1)
  assert.equal(result.summary.blocked, 0)
  assert.equal(result.journeys[0].dimensions.H.status, 'passed')
  assert.equal(result.journeys[0].dimensions.N.status, 'passed')
  assert.equal(result.journeys[0].persistence.status, 'passed')
  assert.equal(result.journeys[0].restart.status, 'passed')
  assert.equal(result.journeys[0].visual.status, 'pending-review')
  assert.match(
    fs.readFileSync(path.join(runDir, 'report.md'), 'utf8'),
    /\| passing \| loopback \| blocked \| passed \| passed \| passed \| passed \| passed \| passed \| passed \| pending-review \|/,
  )
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8')).summary, result.summary)
})

test('a failed execution is failed, never SKIP, and does not become a pass in the report', async () => {
  const runDir = tempDir()
  const manifest = {
    schemaVersion: 1,
    dimensions: [...DIMENSIONS],
    journeys: [
      {
        id: 'failing',
        capability: 'failing',
        command: { command: 'node', args: ['-e', 'process.exit(1)'] },
        provider: { loopback: { state: 'loopback' }, live: { state: 'blocked', reason: 'auth' } },
        dimensions: Object.fromEntries(
          DIMENSIONS.map((dimension) => [dimension, { status: 'ready', evidence: 'assertion' }]),
        ),
        persistence: { status: 'required', evidence: 'receipt' },
        restart: { status: 'required', evidence: 'readback' },
        visual: { status: 'not-applicable', reason: 'no screenshot acceptance' },
      },
    ],
  }
  const result = await runRealUserGates({
    manifest,
    provider: 'loopback',
    runDir,
    execute: async () => ({ status: 'failed', exitCode: 1, stdout: '', stderr: 'boom' }),
  })
  assert.equal(result.exitCode, 1)
  assert.equal(result.summary.failed, 1)
  assert.equal(result.journeys[0].dimensions.H.status, 'failed')
  assert.doesNotMatch(fs.readFileSync(path.join(runDir, 'report.md'), 'utf8'), /SKIP.*pass/i)
})

test('a child runner that reports SKIP is failed closed rather than promoted to pass', async () => {
  const runDir = tempDir()
  const manifest = {
    schemaVersion: 1,
    dimensions: [...DIMENSIONS],
    journeys: [
      {
        id: 'skipped',
        capability: 'skipped',
        command: { command: 'node', args: ['-e', ''] },
        provider: { loopback: { state: 'loopback' }, live: { state: 'blocked', reason: 'auth' } },
        dimensions: Object.fromEntries(
          DIMENSIONS.map((dimension) => [dimension, { status: 'ready', evidence: 'assertion' }]),
        ),
        persistence: { status: 'not-applicable', reason: 'fixture' },
        restart: { status: 'not-applicable', reason: 'fixture' },
        visual: { status: 'not-applicable', reason: 'fixture' },
      },
    ],
  }
  const result = await runRealUserGates({
    manifest,
    provider: 'loopback',
    runDir,
    execute: async () => ({ status: 'skipped', exitCode: 0 }),
  })
  assert.equal(result.exitCode, 1)
  assert.equal(result.summary.failed, 1)
  assert.equal(result.journeys[0].status, 'failed')
  assert.equal(result.journeys[0].dimensions.H.status, 'failed')
})

test('a blocked live provider is explicit, not executed, and returns a blocking exit code', async () => {
  const runDir = tempDir()
  let executed = false
  const result = await runRealUserGates({
    manifest: REAL_USER_TEST_MANIFEST,
    provider: 'live',
    capability: 'production-mcp',
    runDir,
    execute: async () => {
      executed = true
      return { status: 'passed', exitCode: 0 }
    },
  })
  assert.equal(executed, false)
  assert.equal(result.exitCode, 2)
  assert.equal(result.summary.blocked, 1)
  assert.equal(result.journeys[0].selectedProvider.state, 'blocked')
  assert.match(fs.readFileSync(path.join(runDir, 'report.md'), 'utf8'), /blocked.*credentials|authorization/i)
})

test('buildReport remains useful for a report consumer without requiring child-process execution', () => {
  const report = buildReport({
    provider: 'loopback',
    summary: { selected: 0, passed: 0, failed: 0, blocked: 0, ok: true },
    journeys: [],
  })
  assert.match(report, /H \| B \| E \| T \| N/)
  assert.match(report, /Persistence \| Restart \| Visual/)
})
