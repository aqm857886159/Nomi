import assert from 'node:assert/strict'
import test from 'node:test'

import {
  auditCiAnnotations,
  collectRunAnnotations,
  evaluateAnnotations,
} from './ci-annotation-hygiene.mjs'

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body }
}

test('collects annotations only from completed jobs in the exact workflow run', async () => {
  const requested = []
  const fetchImpl = async (url, options) => {
    requested.push({ url, authorization: options.headers.Authorization })
    if (url.includes('/actions/runs/123/jobs')) {
      return response({
        jobs: [
          { id: 10, name: 'Contracts', status: 'completed', conclusion: 'success' },
          { id: 11, name: 'Desktop Linux', status: 'completed', conclusion: 'success' },
          { id: 12, name: 'Quality Gate', status: 'in_progress', conclusion: null },
        ],
      })
    }
    if (url.includes('/check-runs/10/annotations')) {
      return response([{ annotation_level: 'warning', path: '.github', message: 'deprecated action' }])
    }
    if (url.includes('/check-runs/11/annotations')) return response([])
    throw new Error(`Unexpected URL: ${url}`)
  }

  const result = await collectRunAnnotations({
    repository: 'owner/repo',
    runId: '123',
    token: 'test-token',
    fetchImpl,
  })

  assert.deepEqual(result.jobs, [
    { id: 10, name: 'Contracts', conclusion: 'success' },
    { id: 11, name: 'Desktop Linux', conclusion: 'success' },
  ])
  assert.equal(result.annotations[0].message, 'deprecated action')
  assert.ok(requested.every((request) => request.authorization === 'Bearer test-token'))
  assert.ok(requested.every((request) => !request.url.includes('/check-runs/12/')))
})

test('rejects warnings by default and requires documented, unexpired exceptions', () => {
  const annotations = [
    { jobName: 'Contracts', path: '.github', message: 'Node.js 20 is deprecated', level: 'warning' },
    { jobName: 'Contracts', path: 'src/a.ts', message: 'Unexpected any', level: 'warning' },
    { jobName: 'Contracts', path: 'src/b.ts', message: 'Compile failed', level: 'failure' },
    { jobName: 'Unit', path: 'src/a.ts', message: 'informational', level: 'notice' },
  ]
  const strict = evaluateAnnotations(annotations, { schemaVersion: 1, entries: [] }, new Date('2026-08-30T00:00:00Z'))
  assert.equal(strict.delegated.length, 1)
  assert.equal(strict.delegated[0].owner, 'lint:ci warning budget')
  assert.equal(strict.unexpected.length, 2)

  const allowlisted = evaluateAnnotations(
    annotations,
    {
      schemaVersion: 1,
      entries: [
        {
          jobPattern: '^Contracts$',
          messagePattern: 'Node\\.js 20 is deprecated',
          reason: 'Temporary upstream migration window',
          expires: '2026-09-01',
        },
      ],
    },
    new Date('2026-08-30T00:00:00Z'),
  )
  assert.equal(allowlisted.allowed.length, 1)
  assert.equal(allowlisted.delegated.length, 1)
  assert.equal(allowlisted.unexpected.length, 1)
  assert.equal(allowlisted.expiredAllowlistEntries.length, 0)

  const expired = evaluateAnnotations(
    annotations,
    {
      schemaVersion: 1,
      entries: [
        {
          messagePattern: 'deprecated',
          reason: 'Expired migration window',
          expires: '2026-08-29',
        },
      ],
    },
    new Date('2026-08-30T00:00:00Z'),
  )
  assert.equal(expired.delegated.length, 1)
  assert.equal(expired.unexpected.length, 2)
  assert.equal(expired.expiredAllowlistEntries.length, 1)
})

test('fails closed with machine-readable context when GitHub evidence is unavailable', async () => {
  const report = await auditCiAnnotations({
    repository: 'owner/repo',
    runId: '123',
    runAttempt: '2',
    token: 'test-token',
    allowlist: { schemaVersion: 1, entries: [] },
    now: new Date('2026-08-30T00:00:00Z'),
    fetchImpl: async () => response({}, { ok: false, status: 403 }),
  })

  assert.equal(report.passed, false)
  assert.equal(report.runId, '123')
  assert.equal(report.runAttempt, '2')
  assert.match(report.error.message, /HTTP 403/)
})

test('rejects malformed allowlist expiry instead of creating a permanent warning bypass', () => {
  assert.throws(
    () =>
      evaluateAnnotations(
        [],
        {
          schemaVersion: 1,
          entries: [{ messagePattern: 'warning', reason: 'Invalid expiry', expires: 'later' }],
        },
        new Date('2026-08-30T00:00:00Z'),
      ),
    /invalid YYYY-MM-DD expiry/,
  )
})
