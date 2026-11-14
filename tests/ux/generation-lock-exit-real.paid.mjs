#!/usr/bin/env node
// Coordinator-only paid entry. Rehearse first (NOMI_PAID_REHEARSAL=no-key, generic receipt in openPaidWalk); the forwarding proxy enforces a thirteen-image ceiling, reserving one of fourteen for the coordinator price probe.
import { LOCK_EXIT_JOURNEY_CONDITIONS, applyLockExitJourneyConditions } from './_generationLockExitHosting.mjs'
import path from 'node:path'
import { openPaidWalk, DEFAULT_PAID_BRAIN } from './_paidRun.mjs'
import { ENV_KEY_VENDOR } from './_paidEnvKey.mjs'
import { createRuntimeWalk, openCanvas } from './agent-runtime-walk-support.mjs'
import { createLockExitJourneyProxy, LOCK_EXIT_JOURNEY_REPLY_HOLD_MS } from './_generationLockExitProxy.mjs'
import { generationLockExitJourney, lockExitFixtureInput, LOCK_EXIT_BUILD_MARKERS } from './_generationLockExitSteps.mjs'

const model = { vendorKey: ENV_KEY_VENDOR, modelKey: 'gpt-image-2' }
let launchEnv
const paid = await openPaidWalk('generation-lock-exit-real.paid.mjs', 'generation-lock-exit-real', [DEFAULT_PAID_BRAIN, model], {
  buildMarkers: LOCK_EXIT_BUILD_MARKERS,
  hostedUploads: LOCK_EXIT_JOURNEY_CONDITIONS.hostedUploads,
  createWalk: (name, options) => { launchEnv = options.env; return createRuntimeWalk(name, { env: launchEnv }) },
})
const { walk } = paid
let proxy, failure
try {
  // 上游从 openPaidWalk 拿：真付费 = 名单上的真供应商；演练 = 本机替身（不转发），代理照样插在中间、走同一条路。
  const upstream = paid.vendorUpstream()
  const target = upstream.target
  if (!target || (!paid.rehearsal && !/^https:\/\//.test(target))) throw new Error('The authorized upstream API origin is missing')
  proxy = await createLockExitJourneyProxy({ target, imageModel: model.modelKey, maxImages: 13 })
  Object.assign(launchEnv, upstream.launchEnvVia(proxy.origin))
  const { win } = await walk.start({ first: true })
  await paid.lockToAuthorizedModels(win)
  await applyLockExitJourneyConditions(win)
  await win.evaluate(() => localStorage.setItem('__nomiE2E', '1'))
  const project = await walk.newProject()
  const report = await generationLockExitJourney({ page: win, ...lockExitFixtureInput(project, walk.fixture), model, proxy,
    locale: 'zh-CN',
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
  walk.report.proxy = { simulated: ['concurrency refusal', 'discarding one accepted reply'], fakeDelayMs: LOCK_EXIT_JOURNEY_REPLY_HOLD_MS, maxImages: 13, reservedPriceProbe: 1, requests: proxy.records }
} catch (error) { failure = error; process.exitCode = 1 }
finally { if (proxy) await proxy.close(); await paid.finish(failure) }
