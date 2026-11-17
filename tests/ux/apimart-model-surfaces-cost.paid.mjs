#!/usr/bin/env node
import assert from 'node:assert/strict'
import path from 'node:path'
import { openPaidWalk, paidRunRefusal } from './_paidRun.mjs'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'
import { assertModelCostRehearsal, createModelCostProxy, MODEL_COST } from './_modelSurfaceCostSupport.mjs'
import { modelSurfaceCostSteps } from './_modelSurfaceCostSteps.mjs'

const file = process.env.NOMI_MODEL_COST_REHEARSAL_RECEIPT
// Receipt rejection precedes opt-in so stale-proof can be tested without granting spend.
if (file) assertModelCostRehearsal(file)
const refusal = paidRunRefusal('apimart-model-surfaces-cost.paid.mjs')
assert(!refusal, refusal)
assert(file, 'NOMI_MODEL_COST_REHEARSAL_RECEIPT must identify the green free rehearsal')
assert(!('APIMART_API_KEY' in process.env), 'This walk requires the opaque real-profile credential route, not env-key onboarding')
let launchEnv
const paid = await openPaidWalk('apimart-model-surfaces-cost.paid.mjs', 'apimart-model-surfaces-cost', [MODEL_COST], {
  buildMarkers: ['onboardingProviders.account.outputEstimate', 'size_quality_token_formula'],
  createWalk: (name, options) => { launchEnv = options.env; return createRuntimeWalk(name, { env: launchEnv }) },
})
let proxy, failure
try {
  const target = paid.walk.report.networkAllowlist.find(origin => ['https://api.apimart.ai', 'https://api.apib.ai'].includes(origin))
  assert(target, 'Only a declared official APIMart origin can be sampled')
  proxy = await createModelCostProxy(target)
  Object.assign(launchEnv, { NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify(['https://api.apimart.ai', 'https://api.apib.ai'].map(from => ({ from, to: proxy.origin }))), NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: proxy.origin })
  const { win } = await paid.walk.start({ first: true })
  await paid.lockToAuthorizedModels(win)
  const project = await paid.walk.newProject()
  paid.walk.report.modelCost = await modelSurfaceCostSteps({ page: win, projectId: project.projectId, proxy, locale: 'zh-CN', screenshotDir: path.join(paid.walk.outputDir, 'shots') })
  paid.walk.report.modelCostPosts = proxy.records
} catch (error) { failure = error; paid.walk.report.modelCost = error.report; process.exitCode = 1 }
finally { if (proxy) await proxy.close(); await paid.finish(failure) }
