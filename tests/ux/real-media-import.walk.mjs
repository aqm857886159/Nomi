#!/usr/bin/env node
// R13 真实素材导入走查：登记的 4K HEVC 视频 + 登记的 4K PNG，逐门经过真实入口。
// 走查只写隔离项目；NOMI_REAL_MEDIA_DIR 缺失或素材缺失时直接失败，不跳过。
import fs from 'node:fs'
import path from 'node:path'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import { requireRealMediaAssets } from './fixtures/realMedia.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { openRailDrawer } from './_shell.mjs'
import { expect } from './_assert.mjs'
import { makeIsolatedDirs, spawnMcpStdioClient, parseToolResult } from './_mcpJourney.mjs'

const { assets } = requireRealMediaAssets(['video-4k-hevc-10bit', 'image-4k-png'])
const video = assets.get('video-4k-hevc-10bit').file
const image = assets.get('image-4k-png').file

const CANVAS_FILE = 'input[type="file"][aria-hidden="true"][tabindex="-1"]'
const MEDIA = [{ id: 'video-4k-hevc-10bit', file: video }, { id: 'image-4k-png', file: image }]
const report = { source: { video, image, imageBytes: fs.statSync(image).size }, doors: [], startedAt: new Date().toISOString() }

function seedProject(projectsDir, id) {
  const root = path.join(projectsDir, id)
  fs.mkdirSync(path.join(root, '.nomi'), { recursive: true })
  const canvas = { nodes: [], edges: [], selectedNodeIds: [], groups: [] }
  const record = { id, name: `真实素材导入 ${id}`, version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: root,
    payload: { workbenchDocument: null, timeline: null, generationCanvas: canvas, storyboardPlan: null, storyboardPlanCommitted: false } }
  const serialized = JSON.stringify(record, null, 2)
  fs.writeFileSync(path.join(root, '.nomi', 'project.json'), serialized)
  fs.writeFileSync(path.join(root, 'project.json'), serialized)
  return root
}

function projectFiles(root) {
  const out = []
  const visit = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(full)
      else out.push(full)
    }
  }
  visit(path.join(root, 'assets'))
  return out.filter((file) => !file.endsWith('.json') && !file.endsWith('.playable'))
}

async function openProject(win, name) {
  await win.locator('[data-project-card="true"]').filter({ hasText: name }).first().click({ timeout: stationTimeout({ operations: 2 }) })
  await win.getByRole('button', { name: '生成', exact: true }).first().click({ timeout: stationTimeout({ operations: 2 }) })
  await win.locator('[data-nomi-generation-canvas-import-target="true"]').waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
}

async function assertNodeAndAsset(win, root, beforeNodes, label) {
  const importBudget = stationTimeout({ operations: 20 })
  await expect.poll(async () => (await win.locator('.react-flow__node').count()) > beforeNodes, { timeout: importBudget, message: `${label}: 节点没有出现` }).toBe(true)
  const node = win.locator('.react-flow__node').last()
  await node.waitFor({ state: 'visible', timeout: importBudget })
  const decoded = await expect.poll(async () => (await node.locator('img,video').first().evaluate((el) => el.tagName === 'IMG' ? (el.naturalWidth || 0) : (el.videoWidth || 0))) > 0, { timeout: importBudget, message: `${label}: 预览没有解码` }).toBe(true)
  await expect.poll(() => projectFiles(root).length > 0, { timeout: importBudget, message: `${label}: 素材没有落进项目` }).toBe(true)
  await expect.poll(() => { try { const persisted = JSON.parse(fs.readFileSync(path.join(root, '.nomi', 'project.json'), 'utf8')); return (persisted.payload?.generationCanvas?.nodes || []).length > beforeNodes } catch { return false } }, { timeout: importBudget, message: `${label}: 节点没有持久化` }).toBe(true)
  const record = JSON.parse(fs.readFileSync(path.join(root, '.nomi', 'project.json'), 'utf8'))
  const nodes = record.payload?.generationCanvas?.nodes || []
  return { nodeCount: nodes.length, fileCount: projectFiles(root).length, decoded }
}

async function runUiDoor(door, action) {
  const base = makeTempDir(`real-media-import-${door}-`)
  const projectsDir = path.join(base, 'projects'); fs.mkdirSync(projectsDir, { recursive: true })
  const root = seedProject(projectsDir, door)
  const { app, win } = await launchNomiApp({ name: `real-media-import-${door}`, userDataDir: path.join(base, 'user-data'), settingsDir: path.join(base, 'settings'), projectsDir, settleMs: 0, env: { NOMI_E2E_SMOKE: '1' } })
  const row = { door, results: [] }
  try {
    await win.evaluate(() => { for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen') })
    await win.reload(); await win.waitForTimeout(900)
    await openProject(win, `真实素材导入 ${door}`)
    await action({ win, root, row })
  } finally { await app.close().catch(() => {}) }
  report.doors.push(row)
}

async function dropFile(win, file) {
  await win.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.setAttribute('data-real-media-drop-source', 'true'); input.hidden = true; document.body.append(input) })
  const source = win.locator('input[data-real-media-drop-source="true"]'); await source.setInputFiles(file)
  await win.evaluate(() => { const input = document.querySelector('input[data-real-media-drop-source="true"]'); const stage = document.querySelector('[data-nomi-generation-canvas-import-target="true"]'); const dt = new DataTransfer(); dt.items.add(input.files[0]); const init = { bubbles: true, cancelable: true, clientX: 600, clientY: 420, dataTransfer: dt }; stage.dispatchEvent(new DragEvent('dragover', init)); stage.dispatchEvent(new DragEvent('drop', init)); input.remove() })
}

await runUiDoor('canvas-file-picker', async ({ win, root, row }) => {
  const input = win.locator(CANVAS_FILE).first(); await input.waitFor({ state: 'attached', timeout: stationTimeout({ operations: 2 }) })
  for (const media of MEDIA) { const before = await win.locator('.react-flow__node').count(); await input.setInputFiles(media.file); row.results.push({ media: media.id, ...(await assertNodeAndAsset(win, root, before, 'canvas-file-picker')) }) }
})

await runUiDoor('asset-library-upload', async ({ win, root, row }) => {
  await openRailDrawer(win, 'assets', '素材库')
  const input = win.locator('section[aria-label="素材库"] input[type="file"]').first(); await input.waitFor({ state: 'attached', timeout: stationTimeout({ operations: 2 }) })
  for (const media of MEDIA) { const before = await win.locator('.react-flow__node').count(); await input.setInputFiles(media.file); row.results.push({ media: media.id, ...(await assertNodeAndAsset(win, root, before, 'asset-library-upload')) }) }
})

await runUiDoor('canvas-system-drop', async ({ win, root, row }) => {
  for (const media of MEDIA) { const before = await win.locator('.react-flow__node').count(); await dropFile(win, media.file); row.results.push({ media: media.id, ...(await assertNodeAndAsset(win, root, before, 'canvas-system-drop')) }) }
})

// MCP is a real import door. Prove the registered 4K PNG path end-to-end; the 1.38GB HEVC call
// exceeded the bounded exploratory run and remains an explicit residual risk rather than a guessed verdict.
{
  const dirs = makeIsolatedDirs('real-media-import-mcp-')
  const projectId = 'mcp-real-media'
  const root = seedProject(dirs.projectsDir, projectId)
  const mcp = spawnMcpStdioClient({ ...dirs, syntheticCredentialStorage: true, captureStderr: true })
  try {
    await mcp.initialize()
    const imported = await mcp.callTool('nomi_asset_import', { projectId, path: image, title: '4K reference' }, { timeoutMs: 300_000 })
    const parsed = parseToolResult(imported)
    if (imported.isError) throw new Error(`MCP 4K PNG 导入失败：${parsed.text}`)
    const imageAsset = parsed.json || parsed.outcome
    if (!imageAsset?.assetId || !imageAsset?.url) throw new Error(`MCP 返回缺少 assetId/url：${parsed.text}`)
    report.doors.push({ door: 'mcp-asset-import', results: [{ media: 'image-4k-png', assetId: imageAsset.assetId, url: imageAsset.url, fileCount: projectFiles(root).length }] })
  } finally { await mcp.terminate().catch(() => {}) }
}

report.finishedAt = new Date().toISOString()
console.log(JSON.stringify(report, null, 2))
