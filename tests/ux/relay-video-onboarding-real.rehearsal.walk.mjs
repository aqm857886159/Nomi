#!/usr/bin/env node
// Same free/paid steps, fake credential, strict loopback relay; public network is structurally blocked.
import { openPaidWalk, DEFAULT_PAID_BRAIN } from './_paidRun.mjs'
import { ENV_KEY_VAR, ENV_KEY_ALLOW_CATALOG } from './_paidEnvKey.mjs'
import { createRecordedRelayWalk, flushRelayRecording } from './_relayVideoResponseRecording.mjs'
import { startRelayVideoFixture, FAKE_RELAY_KEY } from './_relayVideoFixture.mjs'
import { runRelayVideoPaidSteps } from './_relayVideoPaidSteps.mjs'
import { expect } from './_assert.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { require as tsxRequire } from 'tsx/cjs/api'

const modelKey = 'opaque-gamma'
const baseUrl = ENV_KEY_ALLOW_CATALOG.vendors[0].baseUrlHint
const relay = await startRelayVideoFixture({ models: [{ id: modelKey }, { id: DEFAULT_PAID_BRAIN.modelKey }] })
const redirects = JSON.stringify([{ from: baseUrl, to: relay.baseUrl }])
const network = { NOMI_TEST_NETWORK_GUARD: '1', NOMI_TEST_NETWORK_REDIRECTS: redirects, NOMI_WALK_ALLOW_ORIGINS: '', NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: relay.baseUrl }
const paid = await openPaidWalk('relay-video-onboarding-real.rehearsal.walk.mjs', 'relay-video-onboarding-rehearsal', [DEFAULT_PAID_BRAIN], {
  env: { ...process.env, CI: '', NOMI_SPEND_OK: '1', [ENV_KEY_VAR]: FAKE_RELAY_KEY }, vendorNetwork: false,
  // Same response recorder and generation steps as the coordinator-only paid run.
  // The real script additionally enforces its protocol repair marker; rehearsal always uses a fake key.
  createWalk: async (name, options) => {
    const walk = await createRecordedRelayWalk(name, { ...options, env: { ...options.env, ...network, NOMI_RELAY_RECORD_MODEL: modelKey } }, relay.baseUrl)
    // The generic fixture seeds only its own connection. Restore public built-in rows, never a key.
    // Otherwise the existing visible helper tests an artificial missing-direct-key-contract state.
    const file = path.join(walk.settingsDir, 'model-catalog.json')
    const { applyBuiltinSeeds } = tsxRequire('../../electron/catalog/seedBuiltins.ts', import.meta.url)
    const state = applyBuiltinSeeds(JSON.parse(fs.readFileSync(file, 'utf8')), new Date().toISOString()).state
    fs.writeFileSync(file, JSON.stringify(state))
    return walk
  },
})
let failure
let win, app
try {
  ;({ win, app } = await paid.walk.start({ first: true }))
  await win.evaluate((locale) => localStorage.setItem('nomi:locale:v1', locale), process.env.NOMI_RELAY_LOCALE || 'zh-CN')
  await win.reload()
  const creates = () => relay.hits.filter((h) => h.method === 'POST' && h.path === '/v1/videos/generations')
  await runRelayVideoPaidSteps({ paid, win, mcpEnv: network, readCreates: () => creates().length, readCreateBodies: () => creates().map((hit) => hit.body), plan: { vendorKey: DEFAULT_PAID_BRAIN.vendorKey, modelKey, baseUrl, shape: 'plural-url', queryPath: '/v1/videos/generations', sourceUrl: 'https://docs.example.test/video', duration: 1, resolution: '360p' } })
  expect(relay.tasks.size).toBe(1)
  expect(relay.hits.filter((hit) => hit.method === 'POST')).toHaveLength(1)
  paid.walk.report.paidCalls = 0
} catch (error) { failure = error; process.exitCode = 1; if (win) await paid.walk.snap('relay-blocked').catch(() => {}) }
finally {
  try {
    await flushRelayRecording(app)
    if (!failure) {
      const recorded = fs.readFileSync(paid.walk.report.responseRecording.file, 'utf8').trim().split('\n').map(JSON.parse)
      expect(recorded.filter((entry) => entry.kind === 'request' && entry.stage === 'create')).toHaveLength(1)
      expect(recorded.some((entry) => entry.stage === 'query' && entry.kind === 'json')).toBe(true)
      paid.walk.report.recordedContractResponses = recorded.length
    }
  } catch (error) { failure ??= error; process.exitCode = 1 }
  await paid.finish(failure); await relay.close()
  if (process.env.NOMI_RELAY_EVIDENCE_DIR) {
    fs.cpSync(paid.walk.outputDir, process.env.NOMI_RELAY_EVIDENCE_DIR, { recursive: true })
    fs.rmSync(paid.walk.outputDir, { recursive: true, force: true })
  }
}
