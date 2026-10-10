import { makeTempDir } from '../../scripts/_test-temp.mjs'
// IR-02: real built Electron, original editor/store/IPC, real keyboard and cold reopen.
// Isolated synthetic plan setup uses original repositories; no generation or supplier requests.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { require as tsxRequire } from 'tsx/cjs/api'
import { expect } from '@playwright/test'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { findNodeHitPoint } from './_canvasHit.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { waitForVisualQuiescence, proveProbe, expectAbsent } from './_assert.mjs'
import { createAgentRuntimeFixture, FIXTURE_VENDOR, FIXTURE_IMAGE_MODEL } from './agent-runtime-fixture.mjs'
const { createWorkspaceProject } = tsxRequire('../../electron/workspace/workspaceRepository.ts', import.meta.url)
const { createProductionRunRepository } = tsxRequire('../../electron/productionRun/productionRunRepository.ts', import.meta.url)
const tempRoot = makeTempDir('nomi-ir02-electron-')
const settingsDir = path.join(tempRoot, 'settings'), projectsDir = path.join(tempRoot, 'projects')
const projectId = 'ir02-storyboard', projectRoot = path.join(projectsDir, projectId)
const outputDir = process.env.NOMI_IR02_EVIDENCE_DIR || path.join(tempRoot, 'evidence')
fs.mkdirSync(outputDir, { recursive: true })
fs.mkdirSync(settingsDir, { recursive: true })
const fixture = await createAgentRuntimeFixture({ rootDir: repoRoot, settingsDir })
// 一个家之后只剩一种宿主：方案住项目记录，编辑器只有一个。这条走查因此只驱动那一种。
const documentId = 'ir02-document', legacyId = 'ir02-legacy'
const shot = (host, index) => ({ shotId: `${host}-${index}`, index, shotKind: 'image', prompt: `${host} prompt ${index}`, durationSec: 3,
  anchorIds: [], modelKey: FIXTURE_IMAGE_MODEL, modelVendor: FIXTURE_VENDOR, modeId: 't2i', params: { size: '1024x1024' } })
const plans = { legacy: { title: 'IR02 legacy', anchors: [], shots: [1, 2, 3].map(index => shot('legacy', index)) } }
const imagePath = 'assets/generated/existing.jpg'
const imageUrl = `nomi-local://asset/${projectId}/${imagePath}`
const nodes = ['legacy-1', 'unrelated'].map((id, index) => ({ id: `node-${id}`, kind: 'image', title: id, categoryId: 'shots',
  position: { x: 100 + index * 300, y: 180 }, size: { width: 240, height: 240 }, prompt: id === 'unrelated' ? 'Unrelated preserved result' : `${id.split('-')[0]} prompt 1`,
  status: id === 'unrelated' ? 'success' : 'idle',
  ...(id === 'unrelated' ? { result: { id: 'preserved-result', type: 'image', url: imageUrl, createdAt: 1 }, history: [{ id: 'preserved-result', type: 'image', url: imageUrl, createdAt: 1 }] } : {}),
  meta: { modelVendor: FIXTURE_VENDOR, modelKey: FIXTURE_IMAGE_MODEL, modeId: 't2i',
    ...(id === 'unrelated' ? {} : { storyboardDesignId: legacyId, shotId: id }) },
}))
createWorkspaceProject({ rootPath: projectRoot, record: { id: projectId, name: 'IR02 original storyboard Undo', payload: {
  workbenchDocuments: [{ id: documentId, version: 1, title: 'IR02 document', updatedAt: 1, contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep original document' }] }] } }],
  activeDocumentId: documentId, activeStoryboardId: legacyId, timeline: null,
  storyboardDesignsByDocumentId: { [documentId]: [{ id: legacyId, documentId, title: plans.legacy.title, plan: plans.legacy, committed: false, status: 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1 }] },
  generationCanvas: { nodes, edges: [], groups: [], selectedNodeIds: [], canvasZoom: 0.8, canvasPan: { x: 0, y: 0 } },
} } }, { settingsRoot: settingsDir, defaultProjectsRoot: projectsDir })
fs.mkdirSync(path.join(projectRoot, 'assets/generated'), { recursive: true })
fs.copyFileSync(path.join(repoRoot, 'resources/onboarding-demo/shot-3.jpg'), path.join(projectRoot, imagePath))
const options = { name: 'ir02-storyboard-undo', tempRoot, settingsDir, projectsDir, userDataDir: path.join(tempRoot, 'user-data'),
  initialLocalStorage: { 'nomi:locale:v1': 'zh-CN', '__nomiE2E': '1', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' } }
const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
const report = { status: 'running', platform: process.platform, boundary: 'actual built Electron; synthetic isolated repository setup; real local JPEG; no suppliers',
  tempRoot, outputDir, head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), dirty: Boolean(git('status', '--porcelain')),
  buildStamp: JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist/build-stamp.json'), 'utf8')), launches: [], checks: [], screenshots: [], limitations: ['Windows unverified'] }
const disk = () => JSON.parse(fs.readFileSync(path.join(projectRoot, '.nomi/project.json'), 'utf8')).payload
const readPlan = () => disk().storyboardDesignsByDocumentId[documentId].find(design => design.id === legacyId).plan
let gui, win
const editor = () => win.locator('[data-storyboard-editor="true"]')
const graph = () => win.evaluate(() => { const state = window.__nomiCanvasStore.getState(); return { nodes: state.nodes, edges: state.edges, groups: state.groups } })
const position = async () => (await graph()).nodes.find(node => node.id === 'node-unrelated').position
const sameAuthority = () => {
  assert.equal(fixture.requests.length, 0); assert.equal(fixture.images.length, 0); fixture.assertClean()
}
async function start() {
  gui = await launchNomiApp(options); win = gui.win
  win.setDefaultTimeout(stationTimeout({ operations: 1 }))
  const runtime = await gui.app.evaluate(({ app }) => ({ platform: process.platform, electron: process.versions.electron, pid: process.pid, packaged: app.isPackaged, appPath: app.getAppPath() }))
  assert(win.url().startsWith('file:'), 'Must launch the built application')
  assert.deepEqual(report.buildStamp, JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist-electron/build-stamp.json'), 'utf8')))
  report.launches.push(runtime)
  if (!win.url().includes(`projectId=${projectId}`)) await win.locator('[data-project-card]', { hasText: 'IR02 original storyboard Undo' }).click()
}
async function openEditor() {
  await win.getByRole('button', { name: /^(创作|Create)$/ }).click()
  await expect(win.locator('[data-shell-rail-item="docs"]')).toBeVisible()
  const expand = win.locator('[data-shell-rail-item="docs"][aria-pressed="false"]')
  if (await expand.isVisible()) await expand.click()
  await win.locator(`button[data-storyboard-id="${legacyId}"]`).click()
  await expect(editor()).toBeVisible()
}
async function snap(name) { const file = path.join(outputDir, `${name}.png`); await win.screenshot({ path: file }); report.screenshots.push(file) }
async function checkEditor() {
  const host = 'legacy'
  await openEditor()
  await expect(editor().locator('[data-storyboard-row]')).toHaveCount(3)
  const editorProof = await proveProbe(win.locator('[data-storyboard-editor="true"]:visible'), 'Original storyboard visible before the workspace switch')
  const original = structuredClone(readPlan())
  const row = editor().locator('[data-storyboard-row="1"]')
  await row.getByRole('button', { name: '镜头操作', exact: true }).last().click()
  await win.locator('[data-storyboard-row-menu="1"]').getByRole('button', { name: '删除', exact: true }).click()
  await expect(editor().locator('[data-storyboard-row]')).toHaveCount(2)
  // The delete menu has disappeared: direct keyboard Undo must work without test-created focus.
  await win.keyboard.press('Meta+z')
  await expect(editor().locator('[data-storyboard-row]')).toHaveCount(3)
  await expect.poll(() => readPlan()).toEqual(original)
  report.checks.push({ host, scenario: 'immediate Undo after deletion, no additional focus or click' })
  await row.getByRole('button', { name: '镜头操作', exact: true }).last().click()
  await win.locator('[data-storyboard-row-menu="1"]').getByRole('button', { name: '删除', exact: true }).click()
  await expect(editor().locator('[data-storyboard-row]')).toHaveCount(2)
  await expect.poll(() => readPlan().shots.length).toBe(2)
  const deletedPlan = structuredClone(readPlan())
  await win.getByRole('button', { name: /^(生成|Generate)$/ }).click()
  await expect(win.locator('.react-flow')).toBeVisible()
  // Prove the original storyboard stayed mounted but hidden, the actual bug's host lifetime.
  await expect(editor()).toHaveCount(1)
  await expectAbsent(win.locator('[data-storyboard-editor="true"]:visible'), { provenBy: editorProof, message: 'Workspace switch hides the still-mounted original editor' })
  await win.getByRole('button', { name: /^(适应视图|Fit view)$/ }).click()
  await waitForVisualQuiescence(win)
  const point = await findNodeHitPoint(win, { nodeSelector: '.generation-canvas-v2-node[data-node-id="node-unrelated"]' })
  assert(point, 'Existing unrelated node has a real click surface')
  await win.mouse.click(point.x, point.y)
  const keyboardNode = win.locator('.react-flow__node[data-id="node-unrelated"]')
  await keyboardNode.focus()
  const before = await position()
  const preservedResult = (await graph()).nodes.find(node => node.id === 'node-unrelated').result
  await win.keyboard.press('ArrowRight')
  await expect.poll(async () => (await position()).x).toBeGreaterThan(before.x)
  const moved = await position()
  await win.keyboard.press('Meta+z')
  await expect.poll(position).toEqual(before)
  assert.deepEqual(readPlan(), deletedPlan, 'Canvas Undo must not restore hidden storyboard deletion')
  await keyboardNode.focus(); await win.keyboard.press('Meta+Shift+z')
  await expect.poll(position).toEqual(moved)
  assert.deepEqual(readPlan(), deletedPlan, 'Canvas Redo must not restore hidden storyboard deletion')
  report.checks.push({ host, scenario: 'hidden editor / real canvas move Undo Redo', before, moved })
  await snap(`zh-${host}-canvas-redo`)
  await openEditor()
  await expect(editor().locator('[data-storyboard-row]')).toHaveCount(2)
  const expandSidebar = win.locator('[data-shell-rail-item="docs"][aria-pressed="false"]')
  if (await expandSidebar.isVisible()) await expandSidebar.click()
  const sidebarPlan = win.locator(`button[data-storyboard-id="${legacyId}"]`)
  await expect(sidebarPlan).toBeVisible()
  await sidebarPlan.focus(); await win.keyboard.press('Meta+z')
  assert.deepEqual(readPlan(), deletedPlan, 'Sidebar shortcut cannot consume editor deletion Undo')
  await win.locator('[data-shell-rail-item="docs"][aria-pressed="true"]').click()
  const title = editor().locator('header input')
  await title.fill(`Transient ${host}`); await title.press('Meta+z')
  await expect(editor().locator('[data-storyboard-row]')).toHaveCount(2)
  await title.fill(`Keep later ${host} title`)
  const prompt = editor().locator('[data-storyboard-row="1"] [data-storyboard-prompt-block] [contenteditable="true"]')
  await prompt.fill(`Keep later ${host} prompt`)
  await expect.poll(() => readPlan().shots[0].prompt).toBe(`Keep later ${host} prompt`)
  await editor().locator('[data-storyboard-row="1"]').focus()
  await win.keyboard.press('Meta+Shift+z')
  await expect(editor().locator('[data-storyboard-row]')).toHaveCount(2)
  await win.keyboard.press('Meta+z')
  await expect(editor().locator('[data-storyboard-row]')).toHaveCount(3)
  const expected = { ...original, title: `Keep later ${host} title`, shots: original.shots.map((shot, index) => index === 1 ? { ...shot, prompt: `Keep later ${host} prompt`, promptSegments: [] } : shot) }
  await expect.poll(() => readPlan()).toEqual(expected)
  assert.deepEqual(await position(), moved, 'Restoring storyboard deletion preserves later unrelated canvas movement')
  assert.deepEqual((await graph()).nodes.find(node => node.id === 'node-unrelated').result, preservedResult)
  assert((await graph()).nodes.some(node => node.id === `node-${host}-1`), 'Original bound node identity survives or is restored')
  await expect.poll(() => disk().generationCanvas.nodes.some(node => node.id === `node-${host}-1`)).toBe(true)
  sameAuthority()
  await snap(`zh-${host}-restored-later-edits`)
  report.checks.push({ host, scenario: 'sidebar/input/Redo ownership; local Undo preserves later title/prompt/canvas result', expected,
    nodeIds: (await graph()).nodes.map(node => node.id) })
  return expected
}
try {
  await start()
  const expected = { legacy: await checkEditor() }
  const savedGraph = await graph()
  await expect.poll(() => disk().generationCanvas.nodes.find(node => node.id === 'node-unrelated').position).toEqual(await position())
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  await gui.app.close(); gui = null
  await start()
  for (const host of ['legacy']) {
    await openEditor()
    await expect(editor().locator('[data-storyboard-row]')).toHaveCount(3)
    await expect(editor().locator('header input')).toHaveValue(expected[host].title)
    await expect(editor().locator('[data-storyboard-row="2"] [contenteditable="true"]').first()).toHaveText(`Keep later ${host} prompt`)
    assert.deepEqual(readPlan(), expected[host])
    const restored = await graph()
    assert.deepEqual(restored.nodes.map(node => node.id).sort(), savedGraph.nodes.map(node => node.id).sort())
    assert.deepEqual(restored.nodes.find(node => node.id === 'node-unrelated').result, savedGraph.nodes.find(node => node.id === 'node-unrelated').result)
    assert.deepEqual(restored.nodes.find(node => node.id === 'node-unrelated').position, savedGraph.nodes.find(node => node.id === 'node-unrelated').position)
    await snap(`en-${host}-cold-restored`)
    report.checks.push({ host, scenario: 'new Electron process / English / exact plan and node identities restored' })
  }
  sameAuthority()
  await gui.app.close(); gui = null
  sameAuthority()
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.error = String(error?.stack || error)
  if (gui) { report.mainLogTail = gui.mainLogTail(); await snap('failure').catch(() => {}) }
  throw error
} finally {
  await gui?.app.close().catch(() => {})
  report.requests = { text: fixture.requests.length, image: fixture.images.length, unexpected: fixture.unexpected.length }
  report.realMediaSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(projectRoot, imagePath))).digest('hex')
  fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2))
  await fixture.close()
  console.log(JSON.stringify({ status: report.status, tempRoot, outputDir, checks: report.checks.length }))
}
