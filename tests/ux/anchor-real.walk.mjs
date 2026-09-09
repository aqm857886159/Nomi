// C72 red/green receipt rendering in an isolated real Electron shell; zero media requests.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expectCount, expectVisible, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(repoRoot, 'docs/plan/anchor-real-evidence/screenshots')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-anchor-real-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'anchor-real-walk'
const projectRoot = path.join(projectsDir, projectId)
const designId = 'phase-c-design'
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(path.join(projectRoot, 'assets'), { recursive: true })
fs.mkdirSync(outDir, { recursive: true })
fs.mkdirSync(settingsDir, { recursive: true })
fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 12,
  vendors: [{ key: 'apimart', name: 'APIMart', enabled: true, authType: 'none', providerKind: 'openai-compatible', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z' }],
  models: [{ vendorKey: 'apimart', modelKey: 'MiniMax-H3', labelZh: 'MiniMax H3', kind: 'video', enabled: true,
    meta: { archetypeId: 'minimax-h3-apimart', adapter: { state: 'verified', activeRevision: 'anchor-real', publicationModes: ['text_to_video', 'image_to_video'], modes: [{ taskKind: 'text_to_video', state: 'verified' }, { taskKind: 'image_to_video', state: 'verified' }] } },
    createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z' }],
  mappings: [], apiKeysByVendor: {},
}, null, 2))

const phase = process.argv[2] || 'red'
if (!['red', 'green', 'unsupported'].includes(phase)) throw new Error('Use red, green, or unsupported evidence')
const plan = JSON.parse(fs.readFileSync(path.join(repoRoot, `docs/plan/anchor-real-evidence/${phase === 'unsupported' ? 'red' : phase}.json`), 'utf8'))
plan.title = `角色参考 · ${phase === 'red' ? '修复前' : phase === 'unsupported' ? '模型不支持参考' : '修复后'}`
const fixtureImage = path.join(projectRoot, 'assets', 'hero.png')
fs.copyFileSync(path.join(repoRoot, 'docs/design/covers/anchors/anchor-1.png'), fixtureImage)
const referenceUrl = `file://${fixtureImage}`
plan.anchors[0].referenceUrl = referenceUrl
for (const shot of plan.shots) {
  shot.modelVendor = 'apimart'
  for (const bindings of Object.values(shot.referenceBindings ?? {})) for (const binding of bindings) binding.url = referenceUrl
}
if (phase === 'unsupported') {
  const file = path.join(settingsDir, 'model-catalog.json')
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'))
  catalog.models = [{ ...catalog.models[0], modelKey: 'imagen-4', labelZh: 'Imagen 4', kind: 'image',
    meta: { archetypeId: 'imagen-4', adapter: { state: 'verified', activeRevision: 'anchor-real', publicationModes: ['text_to_image'], modes: [{ taskKind: 'text_to_image', state: 'verified' }] } } }]
  fs.writeFileSync(file, JSON.stringify(catalog))
  plan.shots = [{ ...plan.shots[0], shotKind: 'image', durationSec: 0, modelKey: 'imagen-4', modeId: 't2i', params: {} }]
}
// Both screenshots render the exact red/green loopback receipts in the real shell.
// The isolated project is a deterministic UI fixture, not a real-model claim.
const nodes = []
const project = {
  id: projectId, name: '角色参考走查', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocuments: [{ id: 'doc-1', version: 1, title: '走查', updatedAt: 10, contentJson: { type: 'doc', content: [] } }], activeDocumentId: 'doc-1', timeline: null,
    generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [] },
    storyboardDesignsByDocumentId: { 'doc-1': [{ id: designId, documentId: 'doc-1', title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }] },
  },
}
for (const file of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) fs.writeFileSync(file, JSON.stringify(project, null, 2))
const instance = await launchNomiApp({ name: 'storyboard-anchor-policy', tempRoot, settingsDir, projectsDir })
const { app, win } = instance
try {
  await win.evaluate(() => { for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen') })
  const card = win.locator('[data-project-card]', { hasText: '角色参考走查' })
  await expectVisible(card, '项目卡')
  await card.dblclick()
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '创作页')
  await clickOrFail(win.locator(`[data-storyboard-id="${designId}"]`), '方案')
  await expectVisible(win.locator('[data-storyboard-editor="true"]'), '分镜表')
  await win.getByRole('button', { name: '收起面板', exact: true }).click()
  await win.evaluate(() => { for (const el of document.querySelectorAll('*')) if (el.scrollLeft) el.scrollLeft = 0 })
  await win.getByRole('button', { name: '全部展开', exact: true }).click()
  if (phase !== 'green') await expectVisible(win.locator('[data-anchor-consumption-warning="hero"]'), '旧行为锚未消费')
  else await expectCount(win.locator('[data-anchor-consumption-warning="hero"]'), 0, '修复后锚被消费')
  await screenshotSettled(win, { path: path.join(outDir, `${phase}-overview.png`) })
  const row = win.locator('[data-storyboard-editor="true"] [data-storyboard-row="1"]')
  await row.scrollIntoViewIfNeeded()
  if (phase !== 'green') await expectVisible(row.locator('[data-storyboard-anchor-ignored]'), '旧行为参考未使用')
  else await expectCount(row.locator('[data-storyboard-anchor-ignored]'), 0, '参考已绑定')
  if (phase === 'unsupported') await expectVisible(row.getByText('该模型不吃参考', { exact: true }), '不支持参考原地标记')
  await screenshotSettled(win, { path: path.join(outDir, `${phase}-row.png`) })
  console.log(JSON.stringify({ status: 'passed', phase, screenshots: outDir, paidCalls: 0 }))
} finally { await app.close() }
