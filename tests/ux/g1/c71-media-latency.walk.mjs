// Isolated media-stage replay, not a replacement for the original C0 walk.
// Only the supplier is simulated; admission, spend approval, polling and persistence are real.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { stationTimeout } from '../_station-budget.mjs'
import { launchNomiApp } from '../_launchApp.mjs'
import { expect, screenshotSettled } from '../_assert.mjs'
import { readProject, DOCUMENT } from '../agent-runtime-walk-support.mjs'
import { createC0Fixture, MODEL, shots } from './c0-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const output = path.resolve(root, process.argv[2] || 'tests/ux/shots/c71-speed/media')
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(output, 'profile-'))
const settingsDir = path.join(profile, 'settings')
const serviceMs = [20000, 21100, 19200, 14600, 14700, 15900, 33100, 20800]
const fixture = await createC0Fixture(root, settingsDir, path.join(profile, 'media'), {
  videoDelayMs: Object.fromEntries(serviceMs.map((ms, i) => [i + 1, ms])),
})
const calls = []
fixture.calls.push = function (...indices) {
  calls.push(...indices.map(index => ({ index, started: performance.now() })))
  return Array.prototype.push.apply(this, indices)
}
const report = { mode: 'isolated-media-replay', paidCalls: 0, serviceMs, sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() }
let launched
const launch = () => launchNomiApp({ name: 'c71-media', tempRoot: profile, settingsDir, settleMs: 0,
  initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
  env: { NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '', NOMI_DISABLE_AUTO_UPDATE: '1', NOMI_E2E_PRODUCTION_FIXTURE: '0' },
})
try {
  launched = await launch()
  let { win } = launched
  await win.getByRole('button', { name: /^新建空白项目/ }).click()
  await expect.poll(async () => (await win.evaluate(() => window.nomiDesktop.projects.listAsync())).length).toBe(1)
  const [project] = await win.evaluate(() => window.nomiDesktop.projects.listAsync())
  await win.locator(DOCUMENT).fill('C71 isolated media latency replay')
  await expect.poll(async () => JSON.stringify((await readProject(win, project.id)).payload)).toContain('C71 isolated media latency replay')
  await launched.close()
  launched = null
  launched = await launch()
  ;({ win } = launched)
  const persisted = await readProject(win, project.id)
  persisted.payload.generationCanvas = { nodes: shots.map((shot, i) => ({
    id: `c71-${i + 1}`, kind: 'video', title: `镜头 ${i + 1}`, shotIndex: i + 1,
    position: { x: (i % 4) * 340, y: Math.floor(i / 4) * 380 }, size: { width: 300, height: 300 },
    prompt: shot.prompt, references: [], history: [], status: 'idle',
    meta: { modelKey: MODEL, vendorKey: 'c0-video-loopback', duration: 8, size: '16:9' },
  })), edges: [], groups: [], selectedNodeIds: [] }
  await win.evaluate(({ id, next }) => window.nomiDesktop.projects.saveAsync(id, next), { id: project.id, next: persisted })
  await win.reload({ waitUntil: 'domcontentloaded' })
  await win.locator(`[data-project-id="${project.id}"]`).click()
  await win.getByRole('button', { name: '生成', exact: true }).click()
  await expect(win.locator('.generation-canvas-v2__stage')).toBeVisible()
  await win.getByLabel('适应视图').first().click()
  report.preference = await win.evaluate(() => localStorage.getItem('nomi.canvas.batch-concurrency'))
  report.concurrencyText = await win.getByLabel('并发', { exact: true }).first().innerText()
  await screenshotSettled(win, { path: path.join(output, 'before-submit.png') })
  await win.locator('[data-storyboard-run-all="true"]').first().click()
  const dialog = win.locator('div.fixed.inset-0').filter({ hasText: '开始生成' }).last()
  await expect(dialog).toBeVisible()
  const began = performance.now()
  await dialog.getByRole('button', { name: '生成', exact: true }).click()
  for (let i = 0; i < 8; i += 1) {
    await win.getByRole('button', { name: '确认生成', exact: true }).click({ timeout: stationTimeout({ operations: shots.length }) })
    if (i === 5) await screenshotSettled(win, { path: path.join(output, 'submitted.png') })
  }
  await expect.poll(async () => {
    const p = (await readProject(win, project.id)).payload
    return p.generationCanvas.nodes.filter(n => n.status === 'success').length
  }, { timeout: stationTimeout({ operations: shots.length }), intervals: [100] }).toBe(8)
  report.seconds = (performance.now() - began) / 1000
  report.calls = calls.map(c => ({ index: c.index, startSeconds: (c.started - began) / 1000 }))
  expect([...fixture.calls].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  const nodes = (await readProject(win, project.id)).payload.generationCanvas.nodes
  expect(nodes.every(n => n.result?.url && !n.result.url.startsWith('data:'))).toBe(true)
  await screenshotSettled(win, { path: path.join(output, 'completed.png') })
  report.result = 'passed'
} catch (error) {
  report.result = 'failed'
  report.error = String(error)
  if (launched) await launched.win.screenshot({ path: path.join(output, 'failure.png') })
  process.exitCode = 1
} finally {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  if (launched) await launched.close()
  await fixture.close()
  console.log(JSON.stringify(report))
}
