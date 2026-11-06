#!/usr/bin/env node
// Coordinator only. Requires a profile already upgraded by this build; encrypted credentials stay inside openPaidWalk.
import { require as tsxRequire } from 'tsx/cjs/api'
import { openPaidWalk } from './_paidRun.mjs'
import { ENV_KEY_VAR } from './_paidEnvKey.mjs'
import { clickOrFail, expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'

const { CATALOG_LATEST_SAMPLES, runCatalogLatestSamples } = tsxRequire('./catalogLatestSamples.ts', import.meta.url)
const paid = await openPaidWalk('catalog-latest-real.paid.mjs', 'catalog-latest-real',
  CATALOG_LATEST_SAMPLES.map(({ modelKey }) => ({ vendorKey: 'apimart', modelKey })), {
    env: { ...process.env, [ENV_KEY_VAR]: '' },
    buildMarkers: ['suno-sounds-v6-mini', 'claude-haiku-5-5'], recordAllowedBodies: true,
  })
const { walk } = paid
let failure
try {
  const { win } = await walk.start({ first: true })
  await walk.newProject()
  walk.report.samples = await runCatalogLatestSamples(async (sample) => {
    const nodeId = `catalog-sample-${sample.modelKey}`
    const request = { kind: sample.kind, prompt: sample.kind === 'chat' ? 'Reply with OK.' : 'A soft bell.',
      extras: { modelKey: sample.modelKey, ...sample.params, maxRetries: 0, nodeId } }
    if (sample.kind !== 'chat') {
      const { grantId } = await win.evaluate((id) => window.nomiDesktop.tasks.grantSpend({ nodeIds: [id], maxAttemptsPerNode: 1 }), nodeId)
      request.extras.grantId = grantId
    }
    const pending = win.evaluate((input) => window.nomiDesktop.tasks.run({ vendor: 'apimart', request: input }), request)
    // Preserve an early rejection while waiting for the ordinary generation confirmation.
    pending.catch(() => {})
    if (sample.kind !== 'chat') {
      await clickOrFail(win.locator('[data-spend-confirm-action="confirm"]'), `Approve ${sample.family} once`)
    }
    let result = await pending
    if (!['succeeded', 'failed'].includes(result.status)) {
      await expect.poll(async () => {
        result = await win.evaluate((input) => window.nomiDesktop.tasks.result(input), {
          vendor: 'apimart', taskId: result.id, taskKind: sample.kind, modelKey: sample.modelKey, prompt: request.prompt,
        })
        return result.status
      }, { timeout: stationTimeout({ operations: 8 }), intervals: [3000] }).toMatch(/^(succeeded|failed)$/)
    }
    await walk.snap(`sample-${sample.modelKey}`)
    return { status: result.status, taskId: result.id, assets: result.assets, raw: result.raw }
  })
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
}
