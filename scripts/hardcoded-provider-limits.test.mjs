import assert from 'node:assert/strict'
import { test } from 'vitest'
import { scanHardcodedProviderLimits } from './hardcoded-provider-limits.mjs'

const scan = (code) => scanHardcodedProviderLimits(code, 'electron/provider.ts')
for (const code of [
  'const BATCH_CONCURRENCY = 8',
  'const options = { concurrency: 8 }',
  'function submit(concurrency = 6) {}',
  'const CONCURRENCY_OPTIONS = [1, 2, 4, 6, 8].map(String)',
  'const concurrency = limits.inflight ?? 6',
  'function normalizeConcurrency(value) { return Math.max(1, Math.min(8, value)) }',
  'const cap = 8; const concurrency = cap',
  'const DEFAULT_RPM = 120',
  'const RATE_LIMIT = 120',
  'const PROVIDER_RATE_LIMIT = 120',
  'const MAX_INFLIGHT = 8',
  'const MAX_CONCURRENT_REQUESTS = 8',
  'const REQUESTS_PER_MINUTE = 120',
  'const requestLimit = 30',
  'const rateLimit = { limit: 20 }',
  'const quota = { rateLimit: 4 }',
  'const priority = { concurrency: 4, rpm: 120 }',
  'const quota = { requestsPerMinute: 120 }',
  'const quota = { maxInflight: 8 }',
  'provider.concurrency = 8',
  'class Queue { concurrency = 8 }',
  'const limiter = pLimit(8)',
  'function limits() { return { concurrency: 8 } }',
  'const workers = 8',
  'const poolSize = 4',
  'const maxActive = 6',
  'const parallelism = 12',
  'const maxWorkers = 3',
  'scheduler.acquire({ scope: "provider", inflight: 8 })',
]) {
  test(`reject executable capacity: ${code}`, () => assert.ok(scan(code).length > 0))
}
for (const code of [
  'const concurrency = contract.limits.inflight',
  'const concurrency = Math.min(contract.limits.inflight, userPreference)',
  'const concurrency = Math.max(1, Math.floor(preference))',
  'const rateLimit = parseProviderContract(contractData)',
  'const rateLimitStreak = 0',
  'const FAILURE_PRIORITY: Record<FailureKind, number> = { unsupported: 0, invalid_response: 1, upstream: 2, network: 3, rate_limit: 4, auth: 5 }',
  'const fileSizeLimit = 1024',
  'const limit = 800; const width = Math.min(800, requestedWidth)',
  '// const concurrency = 8\nconst help = "concurrency = 8"',
  'function concurrentQueue() { return [] }',
  'const quota = { concurrency: observed.inflight }',
  'const quota = { concurrency: contract.inflight ?? observed.inflight }',
  'const preference = input >= 1 ? Math.floor(input) : undefined; scheduler.acquire({ scope: "user", inflight: preference })',
  'function CanvasConcurrencySelect() { return <Select columns={2} /> }',
]) {
  test(`accept derived quota / unrelated number: ${code}`, () => assert.deepEqual(scan(code), []))
}
test('reports original source lines without stripping comments or string URLs', () => {
  const hits = scan('/* comment\n * line two */\nconst concurrency = 8\n')
  assert.equal(hits[0].line, 3)
})
