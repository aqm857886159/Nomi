#!/usr/bin/env node
// Coordinator only. Requires a profile already upgraded by this build; encrypted credentials stay inside openPaidWalk.
import fs from 'node:fs'
import path from 'node:path'
import { require as tsxRequire } from 'tsx/cjs/api'
import { openPaidWalk } from './_paidRun.mjs'
import { ENV_KEY_VAR } from './_paidEnvKey.mjs'
import { clickOrFail } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'

const { CATALOG_LATEST_SAMPLES, actualChargeOf, runCatalogLatestSamples, settleSampleTask, taskResultOf } = tsxRequire('./catalogLatestSamples.ts', import.meta.url)
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
  // 回执一条一落：报告里的 samples 随时是最新的，另追加一行到 samples.jsonl（进程被杀也留得下）。失败那条也写。
  const receiptsFile = path.join(walk.outputDir, 'samples.jsonl')
  walk.report.samplesFile = receiptsFile
  walk.report.samples = []
  await runCatalogLatestSamples(async (sample, note) => {
    const nodeId = `catalog-sample-${sample.modelKey}`
    const request = { kind: sample.kind, prompt: 'A soft bell.',
      extras: { modelKey: sample.modelKey, ...sample.params, maxRetries: 0, nodeId, projectId } }
    const { grantId } = await win.evaluate((id) => window.nomiDesktop.tasks.grantSpend({ nodeIds: [id], maxAttemptsPerNode: 1 }), nodeId)
    request.extras.grantId = grantId
    const pending = win.evaluate((input) => window.nomiDesktop.tasks.run({ vendor: 'apimart', request: input }), request)
    // Preserve an early rejection while waiting for the ordinary generation confirmation.
    pending.catch(() => {})
    await clickOrFail(win.locator('[data-spend-confirm-action="confirm"]'), `Approve ${sample.family} once`)
    const submitted = await pending
    // 受理就记任务号：之后轮询超时抛出，这条回执里也有它（去后台查账，不重下）。
    note({ taskId: taskResultOf(submitted).id ?? null })
    const result = await settleSampleTask(submitted, (taskId) => win.evaluate((input) => window.nomiDesktop.tasks.result(input), {
      vendor: 'apimart', taskId, taskKind: sample.kind, modelKey: sample.modelKey, prompt: request.prompt,
    }), { timeoutMs: stationTimeout({ operations: 8 }), intervalMs: 3000 })
    await walk.snap(`sample-${sample.modelKey}`)
    return { status: result.status, taskId: result.id, charge: actualChargeOf(result.raw) ?? '未知', assets: result.assets, raw: result.raw }
  }, {
    from,
    record: (receipt, all) => {
      walk.report.samples = all
      fs.appendFileSync(receiptsFile, `${JSON.stringify(receipt)}\n`)
    },
  })
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
}
