#!/usr/bin/env node
import path from 'node:path'
// One minimum configured image trial. Coordination only; use the copied encrypted-profile route.
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'
import { ENV_KEY_VAR } from './_paidEnvKey.mjs'
import { openPaidWalk } from './_paidRun.mjs'
import { runTryModelIntentJourney, TRIAL_MODEL } from './_tryModelIntentSteps.mjs'

const paid = await openPaidWalk('try-model-intent-lock-real.paid.mjs', 'try-model-intent-lock-real', [TRIAL_MODEL], {
  env: { ...process.env, [ENV_KEY_VAR]: '' },
  receiptRoot: (walk) => path.join(walk.settingsDir, 'app-executions'),
  buildMarkers: ['try-model-intent-lock'], recordAllowedBodies: true,
  createWalk: (name, options) => createRuntimeWalk(name, { ...options, env: { ...options.env, NOMI_MCP_HTTP_PORT: '0' } }),
})
let failure
try { await runTryModelIntentJourney(paid) }
catch (error) { failure = error; process.exitCode = 1 }
finally { await paid.finish(failure) }
