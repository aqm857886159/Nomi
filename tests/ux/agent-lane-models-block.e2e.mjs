import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { stationTimeout } from './_station-budget.mjs'
// Real resident storyboard launch -> IPC -> native lane -> loopback HTTP.
// The fixture supplies directory rows and a remote response, never composer context.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { launchNomiApp } from './_launchApp.mjs'
import { createAgentRuntimeFixture, FIXTURE_VENDOR, FIXTURE_TEXT_MODEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import { expect } from './_assert.mjs'
import { DOCUMENT } from './agent-runtime-walk-support.mjs'
import { newProjectEntry } from './_shell.mjs'

const root = process.cwd()
const tempRoot = makeTempDir('nomi-models-block-')
const settingsDir = path.join(tempRoot, 'settings')
const fixture = await createAgentRuntimeFixture({ rootDir: root, settingsDir })
const catalogPath = path.join(settingsDir, 'model-catalog.json')
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
for (const [modelKey, archetypeId, taskKind] of [
  ['MiniMax-H3', 'minimax-h3', 'text_to_video'],
  ['video-reference-only', 'vidu-q3', 'image_to_video'],
]) {
  catalog.models.push({ vendorKey: FIXTURE_VENDOR, modelKey, kind: 'video', labelZh: modelKey,
    enabled: true, published: true, meta: { archetypeId } })
  catalog.mappings.push({ id: modelKey, vendorKey: FIXTURE_VENDOR, modelKey, taskKind, enabled: true,
    create: { method: 'POST', path: '/unused', body: { model: '{{model.modelKey}}' } } })
}
fs.writeFileSync(catalogPath, JSON.stringify(catalog))
const packaged = process.argv[2]
let launched
try {
  launched = await launchNomiApp({ tempRoot, settingsDir, settleMs: 0,
    ...(packaged ? { executablePath: path.join(path.resolve(packaged), 'Contents/MacOS/Nomi') } : {}),
    env: { NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '', NOMI_DESKTOP_DEV: '', NOMI_DISABLE_AUTO_UPDATE: '1' } })
  const { app, win } = launched
  if (packaged) console.log('asar sha256', createHash('sha256').update(fs.readFileSync(path.join(packaged, 'Contents/Resources/app.asar'))).digest('hex'))
  const listing = await app.evaluate(({ app }) => {
    const req = process.mainModule.require.bind(process.mainModule)
    const compiled = app.getAppPath() + '/dist-electron/catalog/'
    return req(compiled + 'modelCatalogListing.js').deriveModelListing(req(compiled + 'catalogStore.js').readCatalog())
      .filter((row) => row.kind === 'video' && row.keyStatus === 'ok')
  })
  assert.ok(['MiniMax-H3', 'video-reference-only'].every((key) => listing.some((row) => row.modelKey === key)), 'Fixture must expose both text and reference-only video models')
  await win.evaluate(({ vendorKey, modelKey }) => {
    localStorage.setItem('nomi:locale:v1', 'zh-CN')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
    localStorage.setItem('nomi.assistantModel', JSON.stringify({ vendorKey, modelKey }))
  }, { vendorKey: FIXTURE_VENDOR, modelKey: FIXTURE_TEXT_MODEL })
  await win.reload({ waitUntil: 'domcontentloaded' })
  await newProjectEntry(win).click()
  await expect(win.locator(DOCUMENT)).toBeVisible()
  fixture.expectText({ label: 'resident storyboard launch', reply: { type: 'text', text: 'MODELS_BLOCK_VERIFIED' } })
  await win.locator(DOCUMENT).fill('小禾来到河边修鞋摊，拍摄修鞋师傅。请拆成分镜。')
  await win.locator(DOCUMENT).selectText()
  await win.locator('.workbench-selection-popover').getByRole('button', { name: '拆成镜头', exact: true }).click()
  await expect(win.locator('body')).toContainText('MODELS_BLOCK_VERIFIED', { timeout: stationTimeout({ operations: 2 }) })
  assert.equal(fixture.requests.length, 1)
  const users = fixture.requests[0].body.messages.filter((message) => message.role === 'user')
  const prompt = flattenRequestText({ messages: users })
  const missing = listing.filter((row) => !prompt.includes(`modelKey=${row.modelKey}（`)).map((row) => row.modelKey)
  console.log(JSON.stringify({ entry: 'ProjectAgentResidentShell.launch', availableVideoModels: listing.length,
    injected: listing.length - missing.length, missing, paidCalls: 0 }))
  assert.deepEqual(missing, [], 'Main-process HTTP user prompt must contain every available video model')
  fixture.assertClean()
  console.log('PASS resident launch -> provider prompt; all available video model keys')
} finally {
  await launched?.close()
  await fixture.close()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
