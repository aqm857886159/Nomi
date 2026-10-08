import { makeTempDir } from '../../scripts/_test-temp.mjs'
// Real Electron restoration journey, with a photographed frame from the registered user media.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { launchNomiApp } from './_launchApp.mjs'
import { expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { requireRealMediaAssets } from './fixtures/realMedia.mjs'
const before = process.argv.includes('--before')
const related = process.argv.includes('--related')
const lod = process.argv.includes('--lod')
const root = makeTempDir('nomi-image-aspect-')
const projectsDir = path.join(root, 'projects')
const projectId = 'image-aspect'
const projectRoot = path.join(projectsDir, projectId)
const assetsDir = path.join(projectRoot, 'assets/generated')
const output = path.resolve('tests/ux/shots/canvas-image-aspect')
fs.mkdirSync(assetsDir, { recursive: true })
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(output, { recursive: true })
const media = requireRealMediaAssets(['video-4k-hevc-10bit'])
execFileSync(ffmpeg.path, ['-y', '-ss', '00:00:05', '-i', media.assets.get('video-4k-hevc-10bit').file, '-frames:v', '1', path.join(assetsDir, 'landscape.png')], { stdio: 'pipe' })
execFileSync(ffmpeg.path, ['-y', '-i', path.join(assetsDir, 'landscape.png'), '-vf', 'transpose=1', path.join(assetsDir, 'portrait.png')], { stdio: 'pipe' })
let nodes = ['landscape', 'portrait'].map((name, index) => ({
  id: name, kind: 'image', categoryId: 'shots', title: name,
  position: { x: 160 + index * 470, y: 180 }, size: { width: 340, height: 340 }, status: 'success',
  result: { id: name + '-result', type: 'image', url: `nomi-local://asset/${projectId}/assets/generated/${name}.png`, createdAt: 1 },
  runs: [{ id: name + '-run', status: 'success', resultId: name + '-result', startedAt: 1, updatedAt: 2 }],
  meta: { previewHeight: 340, userResized: index === 1 },
}))
if (related) {
  execFileSync(ffmpeg.path, ['-y', '-ss', '00:00:05', '-i', media.assets.get('video-4k-hevc-10bit').file, '-t', '2', '-an', '-vf', 'scale=960:540', '-c:v', 'libx264', path.join(assetsDir, 'video.mp4')], { stdio: 'pipe' })
  nodes = [
    { ...nodes[0], id: 'character', kind: 'character', categoryId: 'shots', title: '角色比例', position: { x: 120, y: 140 }, meta: { tagline: '动态信息区保留完整图像', previewHeight: 340 } },
    { ...nodes[0], id: 'prop', categoryId: 'shots', renderKind: 'prop-card', title: '道具比例', position: { x: 430, y: 140 }, meta: { ownedBy: '主角', previewHeight: 340 } },
    { ...nodes[0], id: 'scene', kind: 'scene', categoryId: 'shots', title: '场景比例', position: { x: 120, y: 420 }, meta: { previewHeight: 340 } },
    { ...nodes[0], id: 'video', kind: 'video', title: '视频比例', position: { x: 530, y: 420 }, result: { ...nodes[0].result, type: 'video', url: `nomi-local://asset/${projectId}/assets/generated/video.mp4` }, meta: { previewHeight: 340 } },
  ]
}
if (lod) nodes.push(...Array.from({ length: 81 }, (_, index) => ({ id: `offscreen-${index}`, kind: 'asset', position: { x: 10000 + index * 400, y: 10000 }, size: { width: 300, height: 200 } })))
const payload = { workbenchDocument: null, timeline: null, generationCanvas: { nodes, edges: [], groups: [], selectedNodeIds: [], canvasZoom: lod ? 0.4 : 1, canvasPan: { x: 0, y: 0 } }, storyboardPlan: null, storyboardPlanCommitted: false }
const project = { id: projectId, name: '图片比例回归', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot, ...payload, payload }
for (const name of ['project.json', '.nomi/project.json']) fs.writeFileSync(path.join(projectRoot, name), JSON.stringify(project))
const run = await launchNomiApp({ name: 'canvas-image-aspect', projectsDir, settleMs: 0, initialLocalStorage: {
  'nomi:locale:v1': 'zh-CN', 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen',
} })
const page = run.win
page.setDefaultTimeout(stationTimeout({ operations: 2 }))
const results = []
async function measure(id) {
  const node = page.locator(`[data-node-id="${id}"]`)
  await expect(node.locator('img[src*="assets/generated"], video').first()).toBeVisible()
  await expect.poll(() => node.locator('img[src*="assets/generated"], video').first().evaluate(img => (img.naturalWidth || img.videoWidth || 0) > 0)).toBe(true)
  await expect(node.locator('img[src*="assets/generated"], video').first()).toHaveCSS('opacity', '1')
  return node.evaluate(el => {
    const img = el.querySelector('img[src*="assets/generated"], video')
    const r = el.getBoundingClientRect()
    const i = img.getBoundingClientRect()
    const intrinsicWidth = img.naturalWidth || img.videoWidth
    const intrinsicHeight = img.naturalHeight || img.videoHeight
    return { width: r.width, height: r.height, imageWidth: intrinsicWidth, imageHeight: intrinsicHeight,
      fit: getComputedStyle(img).objectFit, mode: el.dataset.renderMode || 'full',
      gap: Math.abs(i.height - i.width * intrinsicHeight / intrinsicWidth) }
  })
}
async function assertRatio(id) {
  await expect.poll(async () => (await measure(id)).gap).toBeLessThan(2)
  results.push({ id, ...await measure(id) })
}
try {
  const win = await run.app.browserWindow(page)
  await win.evaluate(w => w.setBounds({ x: 0, y: 0, width: 1680, height: 1050 }))
  await page.locator('[data-project-card]', { hasText: '图片比例回归' }).first().dblclick()
  await page.getByRole('button', { name: '生成', exact: true }).first().click()
  const collapse = page.getByRole('button', { name: '收起面板', exact: true })
  if ((related || lod) && await collapse.isVisible()) await collapse.click()
  if (lod) {
    const zoom = page.getByRole('slider', { name: '缩放比例', exact: true })
    await zoom.focus()
    await zoom.press('Home')
    for (let step = 0; step < 20; step++) await zoom.press('ArrowRight')
    await expect.poll(async () => Number(await zoom.inputValue())).toBeLessThan(55)
  }
  for (const id of (related ? ['character', 'prop', 'scene', 'video'] : ['landscape', 'portrait'])) {
    if (!before && lod) {
      await expect(page.locator(`[data-node-id="${id}"]`)).toHaveAttribute('data-render-mode', 'lightweight')
      await assertRatio(id)
      await page.screenshot({ path: path.join(output, `after-${id}-lod.png`) })
    }
    await page.locator(`[data-node-id="${id}"]`).click()
    if (before) results.push({ id, ...await measure(id) })
    else await assertRatio(id)
    await page.screenshot({ path: path.join(output, `${before ? 'before' : 'after'}-${id}-zh.png`) })
    if (lod) await page.mouse.click(1100, 180)
  }
  if (!before && !related && !lod) {
    const node = page.locator('.react-flow__node').filter({ has: page.locator('[data-node-id="portrait"]') })
    const handle = node.locator('.react-flow__resize-control.bottom.line').first()
    await expect(handle).toBeVisible()
    const initialSize = await measure('portrait')
    const box = await handle.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 65, { steps: 12 })
    await page.mouse.up()
    await assertRatio('portrait')
    expect((await measure('portrait')).height).toBeLessThan(initialSize.height - 20)
    await page.screenshot({ path: path.join(output, 'after-resize-zh.png') })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.locator('[data-settings-tab-id="general"]').click()
    await page.locator('[data-settings-locale="en"]').click()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-settings-dialog]')).toBeHidden()
    await assertRatio('landscape')
    await page.screenshot({ path: path.join(output, 'after-en.png') })
    await page.reload()
    const card = page.locator('[data-project-card]', { hasText: '图片比例回归' }).first()
    if (await card.isVisible()) await card.dblclick()
    await page.getByRole('button', { name: 'Generate', exact: true }).first().click()
    await page.locator('[data-node-id="portrait"]').click()
    await assertRatio('portrait')
    await page.screenshot({ path: path.join(output, 'after-reopen-en.png') })
  }
  fs.writeFileSync(path.join(output, `${before ? 'before' : 'after'}${related ? '-related' : lod ? '-lod' : ''}.json`), JSON.stringify({ results, paidCalls: 0, source: 'registered photographed frame, restored generated-result fixture; no provider call' }, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(output, 'FAIL.png') })
  console.error((await page.locator('body').innerText()).slice(-3000))
  throw error
} finally { await run.close() }
