#!/usr/bin/env node
// Coordinator only. Requires a profile already upgraded by this build; encrypted credentials stay inside openPaidWalk.
import { require as tsxRequire } from 'tsx/cjs/api'
import { openPaidWalk } from './_paidRun.mjs'
import { ENV_KEY_VAR } from './_paidEnvKey.mjs'
import { clickOrFail } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'

const { CATALOG_LATEST_SAMPLES, runCatalogLatestSamples, settleSampleTask } = tsxRequire('./catalogLatestSamples.ts', import.meta.url)
const paid = await openPaidWalk('catalog-latest-real.paid.mjs', 'catalog-latest-real',
  CATALOG_LATEST_SAMPLES.map(({ modelKey }) => ({ vendorKey: 'apimart', modelKey })), {
    env: { ...process.env, [ENV_KEY_VAR]: '' },
    buildMarkers: ['suno-sounds-v6-mini', 'claude-haiku-5-5'], recordAllowedBodies: true,
  })
const { walk } = paid
let failure
try {
  const { win } = await walk.start({ first: true })
  const opened = await walk.newProject()
  // Synchronous audio (TTS) stores its bytes in the project, so every request names the project like the canvas does.
  const projectId = opened?.projectId ?? walk.report.projectId
  if (!projectId) throw new Error('paid samples need an open project')
  // Resume after a recorded run instead of paying again for samples that already succeeded.
  const from = process.env.NOMI_CATALOG_LATEST_FROM || undefined
  walk.report.resumedFrom = from ?? null
  walk.report.samples = await runCatalogLatestSamples(async (sample) => {
    const nodeId = `catalog-sample-${sample.modelKey}`
    const request = { kind: sample.kind, prompt: sample.kind === 'chat' ? 'Reply with OK.' : 'A soft bell.',
      extras: { modelKey: sample.modelKey, ...sample.params, maxRetries: 0, nodeId, projectId } }
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
    const result = await settleSampleTask(await pending, (taskId) => win.evaluate((input) => window.nomiDesktop.tasks.result(input), {
      vendor: 'apimart', taskId, taskKind: sample.kind, modelKey: sample.modelKey, prompt: request.prompt,
    }), { timeoutMs: stationTimeout({ operations: 8 }), intervalMs: 3000 })
    await walk.snap(`sample-${sample.modelKey}`)
    return { status: result.status, taskId: result.id, assets: result.assets, raw: result.raw }
  }, { from })
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
}
