#!/usr/bin/env node
// Investigation walk: faithful local protocols, fake key, isolated data, no model brain or public calls.
import fs from 'node:fs'
import path from 'node:path'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'
import { openCustomApiWizard, openModelSettings } from './_shell.mjs'
import { expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { startRelayVideoFixture, relayDeclaration, RELAY_CASES, FAKE_RELAY_KEY } from './_relayVideoFixture.mjs'
import { relayModelClient, captureRelayScreen, prepareRelayVideo, generateRelayVideo, createRelayProject } from './_relayVideoWalk.mjs'

const cases = process.env.NOMI_RELAY_CASES_FILE ? JSON.parse(fs.readFileSync(process.env.NOMI_RELAY_CASES_FILE, 'utf8')) : RELAY_CASES
const shape = process.env.NOMI_RELAY_SHAPE || 'plural-url'
const locale = process.env.NOMI_RELAY_LOCALE || 'zh-CN'
const evidence = path.resolve(process.env.NOMI_RELAY_EVIDENCE_DIR || '.tmp/relay-video-onboarding')
fs.mkdirSync(evidence, { recursive: true })
const target = cases.find((m) => m.id === process.env.NOMI_RELAY_TARGET) ?? cases[2] ?? cases[0]
const relay = await startRelayVideoFixture({ shape, models: cases, listedIds: cases.filter((m) => m.id !== target.id).map((m) => m.id) })
const walk = await createRuntimeWalk('relay-video-onboarding', { env: { NOMI_WALK_ALLOW_ORIGINS: '', NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: relay.baseUrl } })
const report = { shape, locale, modelKey: target.id, steps: [], hits: relay.hits }
let failure
let client
let win
const capture = async (tag) => {
  const text = await captureRelayScreen(win, evidence, `${locale}-${shape}-${tag}`)
  report.steps.push({ tag, text })
  return text
}
try {
  ;({ win } = await walk.start({ first: true }))
  await win.evaluate((l) => localStorage.setItem('nomi:locale:v1', l), locale)
  await win.reload()
  await openModelSettings(win)
  await capture('settings-entry')
  await openCustomApiWizard(win)
  await win.getByPlaceholder(/如：TOAPI|Example: TOAPI/).fill('Loopback relay')
  await win.getByPlaceholder('https://api.openai.com/v1').fill(relay.baseUrl)
  await win.getByPlaceholder('sk-...').fill(FAKE_RELAY_KEY)
  await capture('filled')
  await win.locator('[data-model-connection-diagnostics] summary').click()
  await win.getByRole('button', { name: /测试连接|Test connection/i, exact: true }).click()
  await expect.poll(async () => relay.hits.filter((h) => h.path.endsWith('/models')).length, { timeout: stationTimeout() }).toBeGreaterThan(0)
  await capture('detected')
  await win.getByRole('button', { name: /保存连接|Save connection/i, exact: true }).click()
  await win.locator('[data-model-connection-saved]').waitFor({ timeout: stationTimeout() })
  await capture('connection-saved')
  report.postsBeforeAgentDeclaration = relay.hits.filter((h) => h.method === 'POST').length
  expect(report.postsBeforeAgentDeclaration, 'connection discovery never submits generation before the AI declaration').toBe(0)
  // c: a document-reading agent now replaces the incomplete default wire with its explicit contract.
  if (await win.locator('[data-settings-close]').isVisible()) await win.locator('[data-settings-close]').click()
  const vendors = await win.evaluate(() => window.nomiDesktop.modelCatalog.listVendors())
  const vendor = vendors.find((v) => v.name === 'Loopback relay')
  expect(vendor?.key).toBeTruthy()
  client = await relayModelClient({ settingsDir: walk.settingsDir, userDataDir: walk.userDataDir, tempRoot: walk.report.tempRoot,
    env: { NOMI_TEST_NETWORK_GUARD: '1', NOMI_WALK_ALLOW_ORIGINS: '', NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: relay.baseUrl },
  })
  const declaration = relayDeclaration(relay.baseUrl, { id: target.id, shape, frameOnly: target.frameOnly, ...(target.queryPath ? { queryPath: target.queryPath } : {}) })
  const sourceUrl = process.env.NOMI_RELAY_DOC_URL || target.sourceUrl
  if (sourceUrl) {
    declaration.sources = [{ url: sourceUrl, evidence: 'Creation, query, inputs and limits transcribed from this documented protocol' }]
    declaration.assetIngestion.sourceUrl = sourceUrl
    declaration.models[0].modes[0].sourceUrls = [sourceUrl]
  }
  if (shape === 'plural-url') {
    declaration.models[0].parameters[0] = { key: 'duration', label: '时长', type: 'number', min: target.duration, max: target.maxDuration ?? 15, default: target.duration }
    declaration.models[0].parameters[1] = { key: 'resolution', label: '清晰度', type: 'select', options: (target.resolutions ?? [target.resolution]).map((value) => ({ value, label: value })), default: target.resolution }
  }
  report.declaration = await client.call('nomi_model_setup', { action: 'submit_declaration', vendorKey: vendor.key, declaration: JSON.stringify(declaration) })
  report.modelAfterDeclaration = await win.evaluate(async (wanted) => {
    const rows = await window.nomiDesktop.modelCatalog.listModels({})
    const row = rows.find((m) => m.vendorKey === wanted.vendorKey && m.modelKey === wanted.modelKey)
    return row ? { enabled: row.enabled, kind: row.kind, published: row.published, publishedModes: row.publishedModes, availability: row.availability } : null
  }, { vendorKey: vendor.key, modelKey: target.id })
  await openModelSettings(win)
  await capture('declared')
  await win.locator('[data-settings-close]').click()
  // d: the real canvas path, including a visible model choice and one generate click.
  const prepared = await prepareRelayVideo({ win, newProject: () => createRelayProject(walk, win), model: { vendorKey: vendor.key, modelKey: target.id }, capture })
  report.canvasSelection = { projection: prepared.projection, neededReload: prepared.neededReload }
  report.landed = await generateRelayVideo({ win, prepared, capture })
  report.generationCreateCount = relay.hits.filter((hit) => hit.method === 'POST').length
  expect(report.generationCreateCount, 'one visible generate action submits one provider request').toBe(1)
  expect(relay.tasks.size, 'the journey owns exactly one provider task').toBe(1)
  fs.copyFileSync(report.landed.media.filePath, path.join(evidence, 'landed.mp4'))
} catch (error) {
  failure = error
  report.error = String(error?.stack ?? error)
  if (win) await capture('blocked').catch(() => {})
  process.exitCode = 1
} finally {
  await client?.close()
  await walk.finish(failure)
  await relay.close()
  report.createdTasks = relay.tasks.size
  fs.writeFileSync(path.join(evidence, `${locale}-${shape}-report.json`), JSON.stringify(report, null, 2))
  fs.cpSync(walk.outputDir, path.join(evidence, 'runtime'), { recursive: true })
  fs.rmSync(walk.outputDir, { recursive: true, force: true })
}
