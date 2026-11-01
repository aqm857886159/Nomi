#!/usr/bin/env node
// Coordinator only: one text-model turn, no generated media. Credentials copied encrypted by openPaidWalk.
// NOMI_SPEND_OK=1 NOMI_SCHEMA_VENDOR=<configured vendor key> NOMI_SCHEMA_MODEL=<configured model key> node tests/ux/tool-schema-real.paid.mjs
// Run the zero-cost rehearsal first. No retries, fallback model or extra HTTP probe.
import { DEFAULT_PAID_BRAIN, openPaidWalk } from './_paidRun.mjs'
import { ENV_KEY_VAR } from './_paidEnvKey.mjs'
import { DEFAULT_SCHEMA_DRAFT_IMAGE, runToolSchemaJourney } from './_toolSchemaSteps.mjs'
const brain = { vendorKey: process.env.NOMI_SCHEMA_VENDOR || DEFAULT_PAID_BRAIN.vendorKey,
  modelKey: process.env.NOMI_SCHEMA_MODEL || DEFAULT_PAID_BRAIN.modelKey }
const image = { vendorKey: process.env.NOMI_SCHEMA_IMAGE_VENDOR || DEFAULT_SCHEMA_DRAFT_IMAGE.vendorKey,
  modelKey: process.env.NOMI_SCHEMA_IMAGE_MODEL || DEFAULT_SCHEMA_DRAFT_IMAGE.modelKey }
const paid = await openPaidWalk('tool-schema-real.paid.mjs', 'tool-schema-real', [brain, image], {
  env: { ...process.env, [ENV_KEY_VAR]: '' },
  buildMarkers: ['outside the common model schema profile'], recordAllowedBodies: true,
})
let failure
try {
  paid.walk.report.schemaJourney = await runToolSchemaJourney(paid, brain, 'zh-CN', image)
  console.log(JSON.stringify(paid.walk.report.schemaJourney))
} catch (error) { failure = error; process.exitCode = 1 }
finally { await paid.finish(failure) }
