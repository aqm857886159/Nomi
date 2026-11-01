#!/usr/bin/env node
// Real Electron, IPC, runtime Zod and disk writes; loopback brain, fake credential, no public egress.
import { DEFAULT_PAID_BRAIN, openPaidWalk } from './_paidRun.mjs'
import { ENV_KEY_VAR } from './_paidEnvKey.mjs'
import { createRuntimeWalk, hasToolResult } from './agent-runtime-walk-support.mjs'
import { DEFAULT_SCHEMA_DRAFT_IMAGE, runToolSchemaJourney } from './_toolSchemaSteps.mjs'
for (const locale of ['zh-CN', 'en']) {
  const paid = await openPaidWalk('tool-schema-real.rehearsal.walk.mjs', `tool-schema-rehearsal-${locale}`, [DEFAULT_PAID_BRAIN, DEFAULT_SCHEMA_DRAFT_IMAGE], {
    env: { ...process.env, CI: '', NOMI_SPEND_OK: '1', [ENV_KEY_VAR]: 'rehearsal-fake-key-0123456789abcdef' },
    buildMarkers: ['outside the common model schema profile'], vendorNetwork: false,
    createWalk: (name, options) => createRuntimeWalk(name, {
      ...options, generationProvider: 'apimart', seedApimartKey: false,
    }),
  })
  paid.walk.fixture.respond({ label: 'manuscript to two drafts', match: body => Array.isArray(body.tools) && body.tools.length > 0,
    reply: body => !hasToolResult(body, 'schema-read')
      ? { type: 'tool', id: 'schema-read', name: 'read_script', args: {} }
      : !hasToolResult(body, 'schema-draft')
        ? { type: 'tool', id: 'schema-draft', name: 'draft_shots', args: { shots: [
          { title: '纸船', taskKind: 'text_to_image', candidate: { providerId: DEFAULT_SCHEMA_DRAFT_IMAGE.vendorKey, modelId: DEFAULT_SCHEMA_DRAFT_IMAGE.modelKey }, prompt: '水洼中的红色纸船' },
          { title: '橘猫', taskKind: 'text_to_image', candidate: { providerId: DEFAULT_SCHEMA_DRAFT_IMAGE.vendorKey, modelId: DEFAULT_SCHEMA_DRAFT_IMAGE.modelKey }, prompt: '窗台上的橘猫' },
        ] } }
        : { type: 'text', text: 'Two drafts created.' },
  })
  paid.walk.fixture.respond({ label: 'non-Agent connection verification', match: () => true, reply: { type: 'text', text: 'OK' } })
  let failure
  try {
    paid.walk.report.schemaJourney = await runToolSchemaJourney(paid, DEFAULT_PAID_BRAIN, locale)
    paid.walk.report.paidCalls = 0
    console.log(JSON.stringify(paid.walk.report.schemaJourney))
  } catch (error) { failure = error; process.exitCode = 1 }
  finally { await paid.finish(failure) }
  if (failure) break
}
