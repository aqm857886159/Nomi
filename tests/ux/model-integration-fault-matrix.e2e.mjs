// J3 release fault matrix: run the focused fail-closed suites as one command.
// The suites use controlled fixtures and never contact a provider; this is not a live-provider claim.
import { execFileSync } from 'node:child_process'
import { assert } from './_modelIntegrationHarness.mjs'

const suites = [
  'electron/catalog/secretsFailClosed.test.ts',
  'electron/integrationCertification/operationLedger.test.ts',
  'electron/integrationCertification/promotionJournal.test.ts',
  'electron/integrationCertification/service.test.ts',
  'electron/providerAdapter/certificationMedia.test.ts',
  'electron/vendor/boundedResponse.test.ts',
  'electron/hardenedFetch.test.ts',
  'electron/ai/onboarding/modelListProbe.test.ts',
]

try {
  const output = execFileSync('pnpm', ['exec', 'vitest', 'run', ...suites], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert(/Test Files\s+\d+ passed/.test(output), 'focused J3 suites report passing test files')
  assert(/Tests\s+\d+ passed/.test(output), 'focused J3 suites report passing tests')
  console.log(`MODEL INTEGRATION J3 PASS: ${suites.length} focused fail-closed suites; zero provider requests`)
} catch (error) {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : 'unknown'
  console.error(`MODEL INTEGRATION J3 FAIL: focused suites exited with status ${status}`)
  process.exitCode = 1
}
