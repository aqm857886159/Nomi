import { makeTempDir } from './_test-temp.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { buildReportData, normalizeFailureMessage, renderMarkdown } from './agent-trajectory-report.mjs'

function makeRun(prefix, files) {
  const runDir = makeTempDir(prefix)
  const trajectoriesDir = path.join(runDir, 'trajectories')
  fs.mkdirSync(trajectoriesDir)
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(trajectoriesDir, `${name}.jsonl`), content)
  return runDir
}

function call({ caseId, name, errorKind = 'none', retryOf, isError = false, resultText = '', seq = 0 }) {
  return JSON.stringify({ caseId, toolCallId: `call_${caseId}${seq}`, name, args: {}, isError, resultText, hasResult: true, seq, errorKind, attempt: 1, settled: true, ...(retryOf ? { retryOf } : {}) })
}

test('counts calls, errors, retries, zero-call cases, and normalizes failure messages', () => {
  const run = makeRun('trajectory-report-', {
    A1: [
      call({ caseId: 'A1', name: 'draft_shots', errorKind: 'arg_rejected', isError: true, resultText: 'op-abcdef12 failed on gen-v2-video-abc123-def456 call_deadbeef at 123 ms', seq: 0 }),
      call({ caseId: 'A1', name: 'draft_shots', errorKind: 'domain_failed', isError: true, retryOf: 'call_A10', resultText: 'domain failed', seq: 1 }),
      'not json',
    ].join('\n'),
    A2: '',
  })
  const report = buildReportData([run], { labels: ['synthetic'], top: 10 })
  const summary = report.runs[0].summary
  assert.deepEqual(summary, {
    cases: 2,
    totalCalls: 2,
    arg_rejected: 1,
    domain_failed: 1,
    retries: 1,
    malformedLines: 1,
    callsPerCase: { min: 0, median: 1, max: 2 },
    zeroToolCallCases: ['A2'],
  })
  assert.equal(report.runs[0].tools[0].tool, 'draft_shots')
  assert.ok(report.runs[0].topFailures.some((item) => item.message === 'op-# failed on gen-v#-#-#-# call_# at # ms'))
  assert.equal(normalizeFailureMessage('  one\n two  123 '), 'one two #')
})

test('comparison preserves run order and includes tools missing from a run', () => {
  const first = makeRun('trajectory-report-first-', {
    A1: call({ caseId: 'A1', name: 'alpha' }),
  })
  const second = makeRun('trajectory-report-second-', {
    B1: call({ caseId: 'B1', name: 'beta', retryOf: 'call_old' }),
  })
  const report = buildReportData([first, second], { labels: ['first', 'second'] })
  assert.deepEqual(report.comparison.summary.map((item) => item.label), ['first', 'second'])
  assert.deepEqual(report.comparison.tools.map((item) => item.tool), ['alpha', 'beta'])
  assert.deepEqual(report.comparison.tools[0].runs.map((item) => item.calls), [1, 0])
  assert.match(renderMarkdown(report), /\| first calls \| first arg_rejected \| first domain_failed \| first retries \| second calls \|/)
})

test('real run1 reproduces the headline totals when evidence is present', (t) => {
  const run1 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs/evidence/2026-09-21-askback-real-model')
  if (!fs.existsSync(path.join(run1, 'trajectories'))) {
    t.skip('real run1 evidence directory is missing')
    return
  }
  const report = buildReportData([run1]).runs[0]
  assert.equal(report.summary.totalCalls, 121)
  assert.equal(report.summary.arg_rejected, 14)
  assert.equal(report.summary.domain_failed, 40)
  assert.equal(report.summary.retries, 45)
  assert.deepEqual(report.tools.find((item) => item.tool === 'draft_shots'), { tool: 'draft_shots', calls: 47, arg_rejected: 14, domain_failed: 22, retries: 33 })
  assert.deepEqual(report.tools.find((item) => item.tool === 'generate'), { tool: 'generate', calls: 10, arg_rejected: 0, domain_failed: 10, retries: 8 })
})
