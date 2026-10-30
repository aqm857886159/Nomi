#!/usr/bin/env node
// AI declaration -> existing explanation/controls -> one text and two image tasks.
// Isolated profile, strict loopback, fake credential; no model brain or paid generation.
import fs from 'node:fs'
import path from 'node:path'
import { createRuntimeWalk, readProject } from './agent-runtime-walk-support.mjs'
import { openCustomApiWizard, openModelSettings } from './_shell.mjs'
import { expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { startRelayVideoFixture, relayDeclaration, FAKE_RELAY_KEY } from './_relayVideoFixture.mjs'
import { waitForRelayLaunch, relayModelClient, captureRelayScreen, prepareRelayVideo, generateRelayVideo, createRelayProject, relayModelOption } from './_relayVideoWalk.mjs'

const locale = process.env.NOMI_RELAY_LOCALE || 'zh-CN'
const evidence = process.env.NOMI_RELAY_EVIDENCE_DIR
if (!evidence || !path.isAbsolute(evidence)) throw new Error('NOMI_RELAY_EVIDENCE_DIR must name an isolated evidence directory')
fs.mkdirSync(evidence, { recursive: true })
const models = [{ id: 'opaque-dual-video', duration: 1, resolution: '360p' }, { id: 'opaque-frame-video', frameOnly: true, duration: 3, resolution: '540p' }]
const relay = await startRelayVideoFixture({ models })
const report = { locale, hits: relay.hits, models }
const walk = await createRuntimeWalk('relay-capability-projection', { env: { NOMI_WALK_ALLOW_ORIGINS: '', NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: relay.baseUrl } })
let win, client, failure
const capture = async (name) => captureRelayScreen(win, evidence, `${locale}-${name}`)
try {
  report.launch = await waitForRelayLaunch({ limitMs: Math.max(1, Number(process.env.NOMI_RELAY_LAUNCH_DEADLINE_MS || Date.now() + 2 * 60 * 60 * 1000) - Date.now()) })
  ;({ win } = await walk.start({ first: true }))
  await win.evaluate((l) => localStorage.setItem('nomi:locale:v1', l), locale)
  await win.reload()
  await openModelSettings(win)
  await openCustomApiWizard(win)
  await win.getByPlaceholder(/如：TOAPI|Example: TOAPI/).fill('Loopback capability')
  await win.getByPlaceholder('https://api.openai.com/v1').fill(relay.baseUrl)
  await win.getByPlaceholder('sk-...').fill(FAKE_RELAY_KEY)
  await win.getByRole('button', { name: /保存连接|Save connection/i, exact: true }).click()
  await win.locator('[data-model-connection-saved]').waitFor({ timeout: stationTimeout() })
  const vendor = (await win.evaluate(() => window.nomiDesktop.modelCatalog.listVendors())).find((v) => v.name === 'Loopback capability')
  expect(vendor?.key).toBeTruthy()
  await win.locator('[data-settings-close]').click()
  client = await relayModelClient({ settingsDir: walk.settingsDir, userDataDir: walk.userDataDir, tempRoot: walk.report.tempRoot,
    env: { NOMI_WALK_ALLOW_ORIGINS: '', NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: relay.baseUrl } })
  const card = relayDeclaration(relay.baseUrl, { id: models[0].id })
  // This mock accepts inline images; declare that fact before submitting local references.
  card.assetIngestion = { strategy: 'inline-base64', accepts: ['image'], sourceUrl: card.sources[0].url }
  card.models[0].modes.push(relayDeclaration(relay.baseUrl, { frameOnly: true }).models[0].modes[0])
  const frame = relayDeclaration(relay.baseUrl, { id: models[1].id, frameOnly: true }).models[0]
  frame.parameters[0] = { key: 'duration', label: locale === 'en' ? 'Duration' : '时长', type: 'number', min: 3, max: 16, default: 3 }
  frame.parameters[1] = { key: 'resolution', label: locale === 'en' ? 'Resolution' : '清晰度', type: 'select', options: [{ value: '540p', label: '540p' }], default: '540p' }
  for (const model of [card.models[0], frame]) if (locale === 'en') for (const p of model.parameters) p.label = p.key === 'duration' ? 'Duration' : 'Resolution'
  card.models.push(frame)
  fs.writeFileSync(path.join(evidence, 'declaration-card.json'), JSON.stringify(card, null, 2))
  report.declaration = await client.call('nomi_model_setup', { action: 'submit_declaration', vendorKey: vendor.key, declaration: JSON.stringify(card) })
  report.specifications = []
  for (const model of models) report.specifications.push(await client.call('nomi_read', { target: 'model', modelId: model.id, vendor: vendor.key }))
  fs.writeFileSync(path.join(evidence, 'model-specifications.json'), JSON.stringify(report.specifications, null, 2))
  expect(report.specifications[1].modes.map((mode) => mode.modeId)).toEqual(['i2v'])
  // The existing capability form displays the projection; it is never edited to prepare the test.
  for (const model of models) {
    await openModelSettings(win)
    await win.locator(`[data-model-home-connection="${vendor.key}"]`).click()
    await win.getByText(model.id, { exact: true }).last().click()
    await win.getByRole('button', { name: new RegExp(`设置 ${model.id} 的输入与生成方式|Set inputs and generation for ${model.id}`) }).click()
    await win.locator('[data-model-settings-page="capability"]').waitFor({ timeout: stationTimeout() })
    await capture(`${model.id}-explanation`)
    await win.locator('[data-model-settings-dialog]').getByRole('button', { name: /^(关闭|Close)$/ }).click()
    await win.locator('[data-settings-close]').click()
  }
  const prepared = await prepareRelayVideo({ win, newProject: () => createRelayProject(walk, win), model: { vendorKey: vendor.key, modelKey: models[0].id }, capture })
  const node = prepared.node
  await node.locator('[data-parameter-summary]').click()
  const panel = win.locator('[data-agent-parameter-panel]')
  await panel.waitFor({ timeout: stationTimeout() })
  expect(await panel.locator('[data-agent-parameter-control="duration"]').innerText()).toContain('1')
  expect(await panel.locator('[data-agent-parameter-control="resolution"]').innerText()).toContain('360p')
  await capture('dual-parameters')
  await win.keyboard.press('Escape')
  report.textResult = await generateRelayVideo({ win, prepared, capture: (name) => capture(`text-${name}`) })
  fs.copyFileSync(report.textResult.media.filePath, path.join(evidence, "text-result.mp4"))
  expect(relay.tasks.size).toBe(1)
  const textBody = relay.hits.find((h) => h.method === 'POST').body
  expect(Number(textBody.duration)).toBe(1)
  expect(textBody.resolution).toBe('360p')
  // The picker follows current inputs. Add a real reference through its existing input owner.
  await win.keyboard.press('Escape')
  await node.locator('[data-asset-add-tile]').first().click()
  await win.locator('[data-testid="asset-picker"]').first().locator('input[type="file"]').setInputFiles(path.resolve('resources/onboarding-demo/shot-5.jpg'))
  await expect.poll(async () => (await readProject(win, prepared.projectId)).payload.generationCanvas.nodes.find((n) => n.id === prepared.nodeId)?.meta?.archetype?.modeId, { timeout: stationTimeout() }).toBe('i2v')
  await win.keyboard.press('Escape')
  await node.click({ position: { x: 8, y: 8 } })
  await node.locator('[data-bar-segment="model-params"] button').first().click()
  await relayModelOption(win, models[1].id).click()
  await expect.poll(async () => (await readProject(win, prepared.projectId)).payload.generationCanvas.nodes.find((n) => n.id === prepared.nodeId)?.meta?.archetype?.modeId, { timeout: stationTimeout() }).toBe('i2v')
  await node.locator('[contenteditable="true"]').last().fill('A glass marble rolls slowly')
  const runButton = node.locator('[data-bar-segment="generate"]')
  await expect(node.locator('[data-asset-slot] img').first()).toBeVisible()
  const referenceProof = await proveProbe(node.locator('[data-asset-slot] img'), 'the required reference image is present before removal')
  await node.locator('[data-asset-slot] [data-asset-tile-remove]').click()
  await expectAbsent(node.locator('[data-asset-slot] img'), { provenBy: referenceProof, message: 'removing the required reference leaves an empty input' })
  await expect(runButton).toBeDisabled()
  expect(await node.locator('[data-asset-slot]').count()).toBe(1)
  await capture('frame-required')
  expect(relay.tasks.size).toBe(1)
  await node.locator('[data-asset-slot] [data-asset-add-tile]').click()
  const picker = win.locator('[data-testid="asset-picker"]').first()
  await picker.locator('input[type="file"]').setInputFiles(path.resolve('resources/onboarding-demo/shot-5.jpg'))
  await expect(node.locator('[data-asset-slot] img').first()).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(runButton).toBeEnabled()
  await node.locator('[data-parameter-summary]').click()
  expect(await panel.locator('[data-agent-parameter-control="resolution"]').innerText()).toContain('540p')
  await capture('frame-parameters')
  await win.keyboard.press('Escape')
  report.imageResult = await generateRelayVideo({ win, prepared, capture: (name) => capture(`frame-${name}`) })
  fs.copyFileSync(report.imageResult.media.filePath, path.join(evidence, "image-result.mp4"))
  expect(relay.tasks.size).toBe(2)
  const posts = relay.hits.filter((h) => h.method === 'POST')
  expect(posts).toHaveLength(2)
  expect(posts[1].body.image_urls).toHaveLength(1)
  expect(Number(posts[1].body.duration)).toBe(3)
  expect(posts[1].body.resolution).toBe('540p')
  // Exercise the non-default image route of the dual-mode declaration too.
  await win.keyboard.press('Escape')
  await node.locator('[data-bar-segment="model-params"] button').first().click()
  await relayModelOption(win, models[0].id).click()
  await expect.poll(async () => (await readProject(win, prepared.projectId)).payload.generationCanvas.nodes.find((n) => n.id === prepared.nodeId)?.meta?.archetype?.modeId, { timeout: stationTimeout() }).toBe('i2v')
  await node.locator('[data-parameter-summary]').click()
  const dualDuration = panel.locator('[data-agent-parameter-control="duration"]')
  const slider = dualDuration.getByRole('slider')
  if (await slider.count()) await slider.press('Home')
  else await dualDuration.getByRole('spinbutton').fill('1')
  expect(await panel.locator('[data-agent-parameter-control="resolution"]').innerText()).toContain('360p')
  await capture('dual-image-parameters')
  await win.keyboard.press('Escape')
  report.reattachedDualImage = !(await node.locator('[data-asset-slot] img').count())
  if (report.reattachedDualImage) {
    await node.locator('[data-asset-slot] [data-asset-add-tile]').click()
    await win.locator('[data-testid="asset-picker"]').first().locator('input[type="file"]').setInputFiles(path.resolve('resources/onboarding-demo/shot-5.jpg'))
    await expect(node.locator('[data-asset-slot] img').first()).toBeVisible()
    await win.keyboard.press('Escape')
  }
  report.dualImageResult = await generateRelayVideo({ win, prepared, capture: (name) => capture(`dual-image-${name}`) })
  fs.copyFileSync(report.dualImageResult.media.filePath, path.join(evidence, 'dual-image-result.mp4'))
  expect(relay.tasks.size).toBe(3)
  const allPosts = relay.hits.filter((h) => h.method === 'POST')
  expect(allPosts).toHaveLength(3)
  expect(allPosts[2].body.model).toBe(models[0].id)
  expect(allPosts[2].body.image_urls).toHaveLength(1)
  expect(Number(allPosts[2].body.duration)).toBe(1)
  expect(allPosts[2].body.resolution).toBe('360p')
  report.manualCapabilityEdits = 0
} catch (error) {
  failure = error
  report.error = String(error?.stack ?? error)
  if (win) await capture('blocked').catch(() => {})
  process.exitCode = 1
} finally {
  await client?.close()
  await walk.finish(failure)
  await relay.close()
  fs.writeFileSync(path.join(evidence, `${locale}-report.json`), JSON.stringify(report, null, 2))
  fs.cpSync(walk.outputDir, path.join(evidence, 'runtime'), { recursive: true })
  fs.rmSync(walk.outputDir, { recursive: true, force: true })
}
