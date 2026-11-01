#!/usr/bin/env node
// Coordinator only. Configure the authorized model in an external plan, never put credentials in it.
// Every paid guard, credential access, build check and receipt is owned by openPaidWalk.
import fs from 'node:fs'
import { openPaidWalk, DEFAULT_PAID_BRAIN } from './_paidRun.mjs'
import { runRelayVideoPaidSteps } from './_relayVideoPaidSteps.mjs'
import { createRecordedRelayWalk, flushRelayRecording, readRelayRecordedRequests } from './_relayVideoResponseRecording.mjs'

const RELAY_BUILD_MARKER = 'relay-video-artifact-v1'

const plan = JSON.parse(fs.readFileSync(process.env.NOMI_RELAY_PAID_PLAN, 'utf8'))
if (plan.vendorKey !== DEFAULT_PAID_BRAIN.vendorKey || plan.shape !== 'plural-url' || plan.duration !== 1 || plan.resolution !== '360p') throw new Error('Paid plan is outside the single authorized minimum configuration')
if (typeof plan.queryPath !== 'string' || !plan.queryPath.startsWith('/')) throw new Error('Paid plan must provide the documented query path before credential preparation')
const paid = await openPaidWalk('relay-video-onboarding-real.paid.mjs', 'relay-video-onboarding-real', [DEFAULT_PAID_BRAIN], {
  buildMarkers: [RELAY_BUILD_MARKER], env: { ...process.env, APIMART_API_KEY: "" },
  createWalk: (name, options) => createRecordedRelayWalk(name, { ...options, env: { ...options.env, NOMI_RELAY_RECORD_MODEL: plan.modelKey } }, plan.baseUrl),
})
let failure
let win, app
try {
  ;({ win, app } = await paid.walk.start({ first: true }))
  const creates = () => readRelayRecordedRequests(paid.walk).filter((entry) => entry.stage === 'create' && entry.method === 'POST')
  await runRelayVideoPaidSteps({ paid, win, plan, freeOnly: process.env.NOMI_RELAY_FREE_ONLY === '1', readCreates: () => creates().length,
    readCreateBodies: () => creates().map((entry) => ({ model: entry.modelMatches ? plan.modelKey : null, ...entry.parameters })) })
} catch (error) { failure = error; process.exitCode = 1; if (win) await paid.walk.snap('relay-blocked').catch(() => {}) }
finally {
  try { await flushRelayRecording(app) } catch (error) { failure ??= error; process.exitCode = 1 }
  await paid.finish(failure)
}
