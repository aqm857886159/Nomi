#!/usr/bin/env node
import path from 'node:path'
// Zero-cost rehearsal, using the same journey with a loopback provider and an empty network allowlist.
import { openPaidWalk, DEFAULT_PAID_BRAIN } from './_paidRun.mjs'
import { ENV_KEY_VAR } from './_paidEnvKey.mjs'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'
import { holdFirstProviderAnswer, runTryModelIntentJourney, runUnreadableRecordJourney, TRIAL_MODEL } from './_tryModelIntentSteps.mjs'

const hold = holdFirstProviderAnswer()
const paid = await openPaidWalk('try-model-intent-lock-real.rehearsal.walk.mjs', 'try-model-intent-lock-rehearsal', [DEFAULT_PAID_BRAIN, TRIAL_MODEL], {
  env: { ...process.env, CI: '', NOMI_SPEND_OK: '1', [ENV_KEY_VAR]: 'rehearsal-fake-key-0123456789abcdef' },
  receiptRoot: (walk) => path.join(walk.settingsDir, 'app-executions'),
  buildMarkers: ['try-model-intent-lock', 'model-trial-uncertain-prior'],
  createWalk: (name, options) => createRuntimeWalk(name, { ...options, generationProvider: 'apimart', seedApimartKey: false,
    trustFixtureOrigin: true, env: { ...options.env, ...hold.env, NOMI_WALK_ALLOW_ORIGINS: '', NOMI_MCP_HTTP_PORT: '0' } }),
})
paid.walk.fixture.respond({ label: 'rehearsal connection check', match: () => true, reply: { type: 'text', text: 'OK' } })
let failure
try {
  await runTryModelIntentJourney(paid, { hold, providerCreates: () => paid.walk.fixture.images.length,
    afterJourney: (journey) => runUnreadableRecordJourney(paid, journey) })
  paid.walk.report.paidCalls = 0
}
catch (error) { failure = error; process.exitCode = 1 }
finally { await paid.finish(failure) }
