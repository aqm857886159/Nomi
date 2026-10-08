import { makeTempDir } from '../../scripts/_test-temp.mjs'
// Real Electron + persisted legacy project + registered photographed media; no provider calls.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { launchNomiApp } from './_launchApp.mjs'
import { expect } from './_assert.mjs'
import { requireRealMediaAssets } from './fixtures/realMedia.mjs'
import { spawnMcpStdioClient, parseToolResult } from './_mcpJourney.mjs'

const root = makeTempDir('nomi-shot-identity-')
const projectsDir = path.join(root, 'projects')
const projectId = 'shot-identity'
const projectRoot = path.join(projectsDir, projectId)
const assetsDir = path.join(projectRoot, 'assets/generated')
const output = path.resolve('tests/ux/shots/canvas-shot-identity')
for (const directory of [assetsDir, path.join(projectRoot, '.nomi'), output]) fs.mkdirSync(directory, { recursive: true })
const media = requireRealMediaAssets(['video-4k-hevc-10bit']).assets.get('video-4k-hevc-10bit')
execFileSync(ffmpeg.path, ['-y', '-ss', '00:00:05', '-i', media.file, '-frames:v', '1', '-vf', 'scale=960:540', path.join(assetsDir, 'frame.png')], { stdio: 'pipe' })
execFileSync(ffmpeg.path, ['-y', '-ss', '00:00:05', '-i', media.file, '-t', '2', '-an', '-vf', 'scale=960:540', '-c:v', 'libx264', path.join(assetsDir, 'video.mp4')], { stdio: 'pipe' })
const node = (id, kind, x, y, meta = {}) => ({ id, kind, title: id, categoryId: 'shots', shotIndex: 1,
  position: { x, y }, size: { width: 280, height: 220 }, status: 'success', meta,
  result: { id: `${id}-result`, type: kind, url: `nomi-local://asset/${projectId}/assets/generated/${kind === 'video' ? 'video.mp4' : 'frame.png'}`, createdAt: 1 },
  runs: [{ id: `${id}-run`, status: 'success', resultId: `${id}-result`, startedAt: 1, updatedAt: 2 }],
})
const nodes = [node('original-frame', 'image', 110, 100, { storyboardKeyframe: true }), node('original-video', 'video', 470, 100), node('independent-legacy-conflict', 'image', 110, 450)]
const edges = [{ id: 'frame-to-video', source: 'original-frame', target: 'original-video', mode: 'first_frame' }]
const payload = { workbenchDocument: null, timeline: null, generationCanvas: { nodes, edges, groups: [], selectedNodeIds: [], canvasZoom: 1, canvasPan: { x: 0, y: 0 } }, storyboardPlan: null, storyboardPlanCommitted: false }
const project = { id: projectId, name: '镜头身份真实回归', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot, immutableProjectUuid: '63fe335c-40fc-40a4-8449-276b81c27311', projectGeneration: 1, payload }
for (const file of ['project.json', '.nomi/project.json']) fs.writeFileSync(path.join(projectRoot, file), JSON.stringify(project))
const run = await launchNomiApp({ name: 'canvas-shot-identity', projectsDir, settleMs: 0, initialLocalStorage: {
  'nomi:locale:v1': 'zh-CN', 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen',
} })
const page = run.win
const labels = () => page.locator('[data-node-id]').evaluateAll(elements => elements.map(el => ({ id: el.getAttribute('data-node-id'), label: el.querySelector('[data-shot-number]')?.textContent ?? '' })))
let mcp
const results = { paidCalls: 0, providerCalls: 0, limitation: 'Persisted legacy graph and real photographed media; no paid generation or LLM turn. MCP reads are real tools.', tasks: [] }
async function openProject() {
  const card = page.locator('[data-project-card]', { hasText: project.name }).first()
  if (await card.isVisible()) await card.dblclick()
  await page.getByRole('button', { name: /^(生成|Generate)$/ }).first().click()
  await expect(page.locator('[data-node-id="original-frame"]')).toBeVisible()
}
async function assertLabel(id, label) {
  await expect(page.locator(`[data-node-id="${id}"] [data-shot-number]`)).toHaveText(label)
}
try {
  await openProject()
  const collapse = page.getByRole('button', { name: '收起面板', exact: true })
  if (await collapse.isVisible()) await collapse.click()
  await assertLabel('original-frame', '镜头 1 · 首帧图')
  await assertLabel('original-video', '镜头 1 · 视频')
  await assertLabel('independent-legacy-conflict', '镜头 2')
  for (const id of ['original-frame', 'original-video']) await expect.poll(() => page.locator(`[data-node-id="${id}"] img, [data-node-id="${id}"] video`).first().evaluate(el => (el.naturalWidth || el.videoWidth || 0) > 0)).toBe(true)
  results.tasks.push({ task: 'legacy restore repairs conflict, preserves paired identity', labels: await labels() })
  await page.screenshot({ path: path.join(output, '01-paired-restored-zh.png') })
  await page.locator('[data-node-id="original-frame"]').click()
  await page.locator('[data-node-id="original-video"]').click({ modifiers: ['Shift'] })
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.keyboard.press(`${mod}+c`)
  await page.keyboard.press(`${mod}+v`)
  await expect(page.locator('[data-node-id]')).toHaveCount(5)
  const copied = (await labels()).filter(item => !nodes.some(node => node.id === item.id))
  expect(copied.map(item => item.label).sort()).toEqual(['镜头 3 · 视频', '镜头 3 · 首帧图'].sort())
  results.tasks.push({ task: 'real keyboard copy/paste creates a new paired shot', labels: copied })
  // Move the selected copies into free canvas space so every badge is actually visible.
  const copiedFrame = copied.find(item => item.label.includes('首帧图'))
  const copyBox = await page.locator(`[data-node-id="${copiedFrame.id}"]`).boundingBox()
  await page.mouse.move(copyBox.x + copyBox.width / 2, copyBox.y + copyBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(copyBox.x + copyBox.width / 2, copyBox.y + copyBox.height / 2 + 225, { steps: 12 })
  await page.mouse.up()
  await page.mouse.click(1200, 180)
  const selectionToolbar = page.locator('.generation-canvas-v2__selection-toolbar')
  if (await selectionToolbar.isVisible()) await selectionToolbar.locator('button').last().click()
  await expect(selectionToolbar).toBeHidden()
  expect((await labels()).filter(item => copied.some(copy => copy.id === item.id))).toEqual(copied)
  results.tasks.push({ task: 'moving copied pair preserves numbers', success: true })
  await page.screenshot({ path: path.join(output, '02-copied-new-shot-zh.png') })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.locator('[data-settings-tab-id="general"]').click()
  await page.locator('[data-settings-locale="en"]').click()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-settings-dialog]')).toBeHidden()
  await assertLabel('original-frame', 'Shot 1 · First frame')
  await assertLabel('original-video', 'Shot 1 · Video')
  results.tasks.push({ task: 'English labels', labels: await labels() })
  await page.screenshot({ path: path.join(output, '03-paired-en.png') })
  mcp = spawnMcpStdioClient({ settingsDir: run.settingsDir, userDataDir: run.userDataDir, projectsDir, capabilityDir: run.capabilityDir,
    clientInfo: { name: 'shot-identity-walk', version: '1' }, capabilities: {}, captureStderr: true, tracePath: path.join(output, 'mcp-trace.jsonl') })
  await mcp.initialize()
  const session = parseToolResult(await mcp.callTool('nomi_session_open', { bootstrap: { mode: 'current_project' } }))
  const leaseHandle = session.json?.leaseHandle || session.outcome?.leaseHandle
  expect(typeof leaseHandle).toBe('string')
  const read = parseToolResult(await mcp.callTool('nomi_read', { target: 'canvas', projectId, leaseHandle }))
  expect(read.isError).toBe(false)
  const graph = read.json ?? read.outcome
  const readFrame = graph.nodes.find(item => item.id === copiedFrame.id)
  const readVideo = graph.nodes.find(item => copied.some(copy => copy.id === item.id) && item.shotRole === 'video')
  expect(readFrame.shotIndex).toBe(3)
  expect(readVideo.shotIndex).toBe(3)
  expect(readFrame.shotRole).toBe('first_frame')
  expect(readFrame.shotOwnerNodeIds).toEqual([readVideo.id])
  expect(readVideo.id).not.toBe('original-video')
  fs.writeFileSync(path.join(output, 'canvas-read.json'), JSON.stringify(graph, null, 2))
  results.tasks.push({ task: 'real MCP session + canvas read', success: !read.isError })
  await expect.poll(() => {
    const saved = JSON.parse(fs.readFileSync(path.join(projectRoot, '.nomi/project.json')))
    return saved.payload?.generationCanvas?.nodes?.length
  }).toBe(5)
  const beforeReload = await labels()
  await page.reload()
  await openProject()
  await expect(page.locator('[data-node-id]')).toHaveCount(5)
  await expect.poll(labels).toEqual(beforeReload)
  await page.screenshot({ path: path.join(output, '04-reopen-stable-en.png') })
  results.tasks.push({ task: 'saved project reopens with stable identities', labels: await labels() })
  fs.writeFileSync(path.join(output, 'journey.json'), JSON.stringify({ ...results, passed: true }, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(output, 'FAIL.png') })
  console.error((await page.locator('body').innerText()).slice(-3500))
  throw error
} finally {
  if (mcp) {
    await mcp.terminate()
    // Keep tool names/arguments/results as evidence without retaining a live session handle.
    const trace = path.join(output, 'mcp-trace.jsonl')
    if (fs.existsSync(trace)) {
      let text = fs.readFileSync(trace, 'utf8')
      const handles = [...text.matchAll(/"leaseHandle":"([^"]+)"/g)].map(match => match[1])
      for (const handle of handles) text = text.replaceAll(handle, '[redacted]')
      fs.writeFileSync(trace, text)
    }
  }
  await run.close()
}
