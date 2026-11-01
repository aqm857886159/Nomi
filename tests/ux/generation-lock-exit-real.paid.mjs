#!/usr/bin/env node
// Coordinator-only paid entry. Rehearse first; the forwarding proxy enforces a fourteen-image ceiling.
import path from 'node:path'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { openPaidWalk, DEFAULT_PAID_BRAIN } from './_paidRun.mjs'
import { ENV_KEY_VENDOR } from './_paidEnvKey.mjs'
import { createRuntimeWalk, openCanvas } from './agent-runtime-walk-support.mjs'
import { createGenerationLockExitProxy } from './_generationLockExitProxy.mjs'
import { generationLockExitJourney, LOCK_EXIT_BUILD_MARKERS } from './_generationLockExitSteps.mjs'

// A partial rehearsal is not authorization to spend on an unfinished four-stage journey.
const receiptPath = process.env.NOMI_LOCK_EXIT_REHEARSAL_RECEIPT
assert.ok(receiptPath, 'Provide the green four-stage rehearsal receipt before running the paid entry')
const rehearsal = JSON.parse(fs.readFileSync(receiptPath, 'utf8'))
assert.equal(rehearsal.status, 'passed', 'The free rehearsal must pass first')
assert.deepEqual(rehearsal.report?.stages, ['storyboard', 'canvas', 'list', 'restart'], 'All four real-scenario stages must be rehearsed')
const model = { vendorKey: ENV_KEY_VENDOR, modelKey: 'gpt-image-2' }
let launchEnv
const paid = await openPaidWalk('generation-lock-exit-real.paid.mjs', 'generation-lock-exit-real', [DEFAULT_PAID_BRAIN, model], {
  buildMarkers: LOCK_EXIT_BUILD_MARKERS,
  hostedUploads: true,
  createWalk: (name, options) => { launchEnv = options.env; return createRuntimeWalk(name, { env: launchEnv }) },
})
const { walk } = paid
let proxy, failure
try {
  const target = walk.report.networkAllowlist[0]
  if (!target || !/^https:\/\//.test(target)) throw new Error('The authorized upstream API origin is missing')
  proxy = await createGenerationLockExitProxy({ target, imageModel: model.modelKey, maxImages: 14 })
  Object.assign(launchEnv, { NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: target, to: proxy.origin }]), NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: proxy.origin })
  const { win } = await walk.start({ first: true })
  await paid.lockToAuthorizedModels(win)
  await win.evaluate(() => localStorage.setItem('__nomiE2E', '1'))
  const project = await walk.newProject()
  const report = await generationLockExitJourney({ page: win, projectId: project.id, model, proxy,
    textLabel: paid.label(DEFAULT_PAID_BRAIN.vendorKey, DEFAULT_PAID_BRAIN.modelKey), locale: 'zh-CN',
    screenshotDir: path.join(walk.outputDir, 'shots'),
    restart: async () => {
      await walk.stopApp()
      const { win: reopened } = await walk.start()
      await reopened.locator('[data-project-card]', { hasText: project.name }).first().click()
      await openCanvas(reopened)
      return reopened
    },
  })
  walk.report.generationLockExit = report
  walk.report.proxy = { simulated: ['concurrency refusal', 'discarding one accepted reply'], maxImages: 14, requests: proxy.records }
} catch (error) { failure = error; process.exitCode = 1 }
finally { if (proxy) await proxy.close(); await paid.finish(failure) }
