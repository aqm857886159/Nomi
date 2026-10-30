#!/usr/bin/env node
// Coordinator only. Configure the authorized model in an external plan, never put credentials in it.
// Every paid guard, credential access, build check and receipt is owned by openPaidWalk.
import fs from 'node:fs'
import { openPaidWalk, DEFAULT_PAID_BRAIN } from './_paidRun.mjs'
import { paidCredentialSource } from './_paidEnvKey.mjs'
import { runRelayVideoPaidSteps } from './_relayVideoPaidSteps.mjs'
import { waitForRelayLaunch } from './_relayVideoWalk.mjs'

const RELAY_BUILD_MARKER = 'relay-video-artifact-v1'

// Read only the helper's source enum, never a key. This journey must use its visible connection route.
if (paidCredentialSource(process.env) !== 'env-key') throw new Error('This journey requires the existing visible environment-key connection route; no profile fallback')

const paid = await openPaidWalk('relay-video-onboarding-real.paid.mjs', 'relay-video-onboarding-real', [DEFAULT_PAID_BRAIN], { buildMarkers: [RELAY_BUILD_MARKER], recordAllowedBodies: true })
let failure
let win
try {
  const plan = JSON.parse(fs.readFileSync(process.env.NOMI_RELAY_PAID_PLAN, 'utf8'))
  if (plan.vendorKey !== DEFAULT_PAID_BRAIN.vendorKey || plan.shape !== 'plural-url' || plan.duration !== 1 || plan.resolution !== '360p') throw new Error('Paid plan is outside the single authorized minimum configuration')
  paid.walk.report.launchPermission = await waitForRelayLaunch()
  ;({ win } = await paid.walk.start({ first: true }))
  const creates = () => paid.readAllowedRequests().filter((entry) => entry.kind === 'allowed-request' && entry.method === 'POST' && new URL(entry.url).pathname === '/v1/videos/generations')
  await runRelayVideoPaidSteps({ paid, win, plan, freeOnly: process.env.NOMI_RELAY_FREE_ONLY === '1', readCreates: () => creates().length, readCreateBodies: () => creates().map((entry) => JSON.parse(entry.body.text)) })
} catch (error) { failure = error; process.exitCode = 1; if (win) await paid.walk.snap('relay-blocked').catch(() => {}) }
finally { await paid.finish(failure) }
