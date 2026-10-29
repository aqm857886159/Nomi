// One user journey for rehearsal and the coordinator's paid run. Never submits media generation.
import assert from 'node:assert/strict'
import { require as tsxRequire } from 'tsx/cjs/api'
import { clickOrFail, expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { readLaneTranscripts } from './agent-lane-observer.mjs'
import { transcriptFacts } from './_agentShotScopeScore.mjs'
import { readProductionRuns } from './_paidRun.mjs'
import { APPROVAL_CARD, CANVAS_PANEL, COMPOSER, DOCUMENT, ERROR_BAR, INTERVENTION_CONFIRM,
  COMPOSER_PERMISSION, permissionTier, chooseAssistantModel, openCanvas, sendCanvas } from './agent-runtime-walk-support.mjs'

const { collectStandardSchemaFailures } = tsxRequire('../../electron/shared/agentCapabilities/modelVisibleJsonSchema.ts', import.meta.url)
export const DEFAULT_SCHEMA_DRAFT_IMAGE = Object.freeze({ vendorKey: 'apimart', modelKey: 'gemini-3.1-flash-image-preview' })
const STORY = '雨后，红色纸船漂在水洼里。一只橘猫坐在窗台上看着纸船。'

export async function runToolSchemaJourney(paid, brain, locale = 'zh-CN', image = DEFAULT_SCHEMA_DRAFT_IMAGE) {
  const { walk } = paid
  const { app, win } = await walk.start({ first: true })
  walk.report.bootstrapErrors = []
  win.on('pageerror', error => walk.report.bootstrapErrors.push(String(error)))
  win.on('console', message => { if (message.type() === 'error') walk.report.bootstrapErrors.push(message.text()) })
  await win.reload({ waitUntil: 'domcontentloaded' })
  // Official Undici diagnostics observe actual dispatch across SDK fetch wrappers, without mutation.
  // https://github.com/nodejs/undici/blob/main/docs/docs/api/DiagnosticsChannel.md
  // Headers and message content never cross into the report; retain schemas + HTTP status only.
  await app.evaluate(() => {
    const diagnostics = process.getBuiltinModule('node:diagnostics_channel')
    const { Buffer } = process.getBuiltinModule('node:buffer')
    globalThis.__toolSchemaHttp = []
    globalThis.__toolSchemaCaptureProblems = []
    const pending = new WeakMap()
    diagnostics.channel('undici:request:create').subscribe(({ request }) => {
      const item = { chunks: [], bytes: 0 }
      pending.set(request, item)
      // Pinned SDK transport source: undici@6.19.8 lib/core/request.js / client-h1.js.
      // Observe chunks after writing; forward the existing callback unchanged. Never consume its body stream.
      const sent = request.onBodySent
      if (typeof sent !== 'function') { globalThis.__toolSchemaCaptureProblems.push('Missing Undici body-sent hook'); return }
      request.onBodySent = function(chunk) {
        try {
          const bytes = Buffer.from(chunk)
          item.bytes += bytes.length
          if (item.bytes <= 2 * 1024 * 1024) item.chunks.push(bytes)
        } catch { globalThis.__toolSchemaCaptureProblems.push('Uncaptured request-body chunk') }
        return sent.apply(this, arguments)
      }
    })
    diagnostics.channel('undici:request:headers').subscribe(({ request, response }) => {
      try {
        const item = pending.get(request)
        const bytes = typeof request.body === 'string' || Buffer.isBuffer(request.body)
          ? request.body : item?.bytes <= 2 * 1024 * 1024 ? Buffer.concat(item.chunks) : null
        if (!bytes) return
        const body = JSON.parse(String(bytes))
        if (Array.isArray(body.tools) && body.tools.length) globalThis.__toolSchemaHttp.push({ tools: body.tools, status: response.statusCode })
      } catch { /* Non-JSON / uncaptured request: cannot be counted as observed tool acceptance. */ }
    })
  })
  await paid.lockToAuthorizedModels(win)
  const { projectRoot } = await walk.newProject()
  await win.locator(DOCUMENT).fill(STORY)
  await expect(win.locator(DOCUMENT)).toHaveText(STORY)
  if (locale === 'en') {
    await clickOrFail(win.getByRole('button', { name: /^(设置|Settings)$/ }).first(), 'settings')
    await clickOrFail(win.locator('[data-settings-tab-id="general"]'), 'general')
    await clickOrFail(win.locator('[data-settings-locale="en"]'), 'English')
    await clickOrFail(win.locator('[data-settings-close]'), 'close settings')
  }
  await openCanvas(win)
  await chooseAssistantModel(win, paid.label(brain.vendorKey, brain.modelKey), CANVAS_PANEL)
  const panel = win.locator(CANVAS_PANEL)
  await clickOrFail(panel.locator(COMPOSER_PERMISSION), 'permission tier')
  await clickOrFail(panel.locator(permissionTier('request')), 'require confirmation before media generation')
  await expect(panel.locator(COMPOSER)).toHaveAttribute('data-approval-mode', 'request')
  const modelHint = `${image.vendorKey}/${image.modelKey}`
  const ask = locale === 'en'
    ? `Read my manuscript, then draft exactly two shots: a red paper boat in a puddle, and an orange cat on a windowsill. Use ${modelHint} as the image model for the drafts. Only create drafts. Do not generate media, ask for a model or submit paid tasks.`
    : `先读我的文稿，拆成两镜草稿：水洼里的红色纸船、窗台上的橘猫。草稿的图片模型选 ${modelHint}。只建草稿，不生成、不询问模型、不提交付费任务。`
  await sendCanvas(win, ask)
  await expect.poll(async () => {
    const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}`)
    if (await card.count()) {
      const kind = await card.first().getAttribute('data-kind')
      assert.ok(['approval-reversible', 'plan'].includes(kind), `Unexpected intervention: ${kind}`)
      await card.first().locator(INTERVENTION_CONFIRM).click()
    }
    const error = win.locator(`${CANVAS_PANEL} ${ERROR_BAR}`)
    walk.report.schemaProbeFacts = transcriptFacts(readLaneTranscripts(projectRoot)).calls.map(call => ({ name: call.name, isError: call.isError, result: call.resultText?.slice(0, 1200) }))
    const errorCount = await error.count()
    assert.equal(errorCount, 0, errorCount ? await error.first().textContent() : 'Agent error surface')
    const facts = transcriptFacts(readLaneTranscripts(projectRoot))
    return facts.settled
  }, { timeout: stationTimeout({ turns: 1, operations: 2 }), message: 'The single manuscript-to-shots turn must settle' }).toBe(true)
  await expect(win.locator(`${CANVAS_PANEL} ${COMPOSER}`)).toHaveAttribute('data-mode', 'idle')
  const facts = transcriptFacts(readLaneTranscripts(projectRoot))
  walk.report.schemaTextFacts = facts.texts
  walk.report.schemaCaptureProblems = await app.evaluate(() => globalThis.__toolSchemaCaptureProblems)
  const wire = await app.evaluate(() => globalThis.__toolSchemaHttp)
  assert.deepEqual(walk.report.schemaCaptureProblems, [])
  assert.ok(wire.length > 0, 'No observed HTTP tool-bearing request; acceptance is unverified')
  const schemaFailures = []
  for (const record of wire) {
    assert.ok(record.status >= 200 && record.status < 300, `Gateway HTTP ${record.status}`)
    assert.ok(record.tools.some(tool => tool.function?.name === 'stage_shot'), 'Actual full catalog must include stage_shot')
    for (const tool of record.tools) collectStandardSchemaFailures(tool.function.parameters, tool.function.name, schemaFailures)
  }
  assert.deepEqual(schemaFailures, [])
  const successful = facts.calls.filter(call => call.isError === false)
  assert.ok(facts.calls.some(call => call.name === 'read_script' && call.isError === false && call.resultText.includes('红色纸船')), 'Must read the actual manuscript')
  assert.ok(facts.calls.some(call => call.name === 'draft_shots' && call.isError === false), 'Must execute draft_shots')
  assert.equal(successful.length, facts.calls.length, 'No rejected or missing tool result may count as success')
  assert.equal(facts.calls.some(call => call.name === 'generate'), false, 'No media generation')
  const runs = readProductionRuns(projectRoot).filter(run => run.generationPlan)
  const shots = runs.flatMap(run => run.generationPlan.shots ?? [])
  assert.equal(shots.length, 2, 'Two shots must be persisted by the real tool execution')
  await walk.snap(`schema-${locale}`)
  return { locale, http: wire.map(record => ({ status: record.status, toolNames: record.tools.map(tool => tool.function.name) })),
    calls: facts.calls.map(call => ({ name: call.name, isError: call.isError })),
    toolWriteCorrect: `${successful.length}/${facts.calls.length}`, turnSuccess: '1/1', persistedShots: shots.length }
}
