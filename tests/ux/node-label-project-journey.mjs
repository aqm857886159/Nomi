import { makeTempDir } from '../../scripts/_test-temp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, screenshotSettled, proveProbe, expectAbsent } from './_assert.mjs'
import { scanFeel } from './_feel.mjs'
import { stationTimeout } from './_station-budget.mjs'

/** Persisted project -> project library -> real React Flow canvas -> rename/drag/preview. */
export async function runNodeLabelProjectJourney(origin, out, { largeCanvas = false } = {}) {
  const tempRoot = makeTempDir('nomi-label-project-')
  const projectsDir = path.join(tempRoot, 'projects')
  const projectId = 'node-label-project'
  const projectRoot = path.join(projectsDir, projectId)
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  const nodes = ['empty', 'image', 'video'].map((kind, index) => ({
    id: `label-${kind}`, kind: kind === 'video' ? 'video' : 'image', categoryId: 'shots', shotIndex: index + 1,
    title: ['雨夜街口', '雨中背影', '穿过路口'][index], position: { x: 160 + index * 420, y: 240 },
    exactPosition: true, size: { width: 340, height: 240 }, status: kind === 'empty' ? 'idle' : 'success',
    result: kind === 'empty' ? undefined : { id: `result-${kind}`, type: kind, url: `${origin}/fixtures/${kind === 'video' ? 'node-label-video.mp4' : 'process-feedback-frame.svg'}`, createdAt: 1 },
  }))
  if (largeCanvas) {
    const sample = nodes[1]
    for (let index = nodes.length; index < 81; index += 1) nodes.push({ ...sample, id: `large-${index}`, shotIndex: index + 1, position: { x: 160 + (index % 9) * 420, y: 240 + Math.floor(index / 9) * 320 } })
  }
  const canvas = { nodes, edges: [], groups: [], selectedNodeIds: [], canvasZoom: 1, canvasPan: { x: 0, y: 0 } }
  const project = { id: projectId, name: '镜头标签验收', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
    lastKnownRootPath: projectRoot, generationCanvas: canvas,
    payload: { workbenchDocument: null, timeline: null, generationCanvas: canvas, storyboardPlan: null, storyboardPlanCommitted: false } }
  for (const file of ['project.json', '.nomi/project.json']) fs.writeFileSync(path.join(projectRoot, file), JSON.stringify(project))
  const { app, win } = await launchNomiApp({ name: 'node-label-project', tempRoot, projectsDir,
    initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
    env: { VITE_DEV_SERVER_URL: origin } })
  try {
    await win.setViewportSize({ width: 1600, height: 1000 })
    const card = win.locator('[data-project-card]', { hasText: '镜头标签验收' })
    await expect(card).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
    await card.dblclick()
    await win.getByRole('button', { name: '生成', exact: true }).click()
    const image = win.locator('article[data-node-id="label-image"]')
    await expect(image).toBeVisible()
    await expect(image.locator('img').first()).toBeVisible()
    if (!largeCanvas) {
    await win.getByRole('button', { name: '适应视图', exact: true }).click()
    await expect.poll(async () => {
      const video = await win.locator('article[data-node-id="label-video"]').boundingBox()
      const canvas = await win.locator('.generation-canvas-v2__stage').boundingBox()
      return video.x + video.width <= canvas.x + canvas.width
    }).toBe(true)
    }
    if (largeCanvas) {
      await screenshotSettled(win, { path: path.join(out, 'large-canvas-before-zoom.png') })
      const zoom = win.locator('.generation-canvas-v2__zoom-bar input[type=range]')
      await zoom.focus()
      await zoom.press('Home')
      await expect.poll(async () => Number(await zoom.inputValue())).toBeLessThanOrEqual(55)
      const actualZoom = Number(await zoom.inputValue()) / 100
      const lightweight = win.locator('article[data-node-id="label-image"][data-render-mode="lightweight"]')
      await expect(lightweight).toBeVisible()
      const feel = await scanFeel(lightweight.locator('[data-node-label-row]'))
      expect(feel.findings.filter((finding) => finding.rule === 'font-size'), 'Lightweight metadata must meet readable font floor').toEqual([])
      const area = await lightweight.evaluate((node) => {
        const media = node.querySelector('img').getBoundingClientRect()
        return [...node.querySelectorAll('div,span')].filter((e) => e.children.length === 0 && e.textContent.trim() && getComputedStyle(e).visibility !== 'hidden').reduce((sum, e) => {
          const b = e.getBoundingClientRect()
          return sum + Math.max(0, Math.min(b.right, media.right) - Math.max(b.left, media.left)) * Math.max(0, Math.min(b.bottom, media.bottom) - Math.max(b.top, media.top))
        }, 0)
      })
      await win.screenshot({ path: path.join(out, 'large-canvas-low-zoom.png') })
      fs.writeFileSync(path.join(out, 'large-canvas.json'), JSON.stringify({ nodes: 81, requestedZoom: 0.2, actualZoom, persistentTextOverlap: area }, null, 2))
      expect(area, '大画布远景的常驻文字不得遮挡媒体').toBe(0)
      return
    }
    for (const id of ['empty', 'image', 'video']) {
      const node = win.locator(`article[data-node-id="label-${id}"]`)
      await expect(node.locator('[data-shot-number]')).toBeVisible()
      const bounds = await node.evaluate((n) => ({ node: n.getBoundingClientRect().top, label: n.querySelector('[data-node-label-row]').getBoundingClientRect().bottom }))
      expect(bounds.label).toBeLessThan(bounds.node)
    }
    await win.screenshot({ path: path.join(out, 'project-three-shots.png') })
    await image.locator('.generation-canvas-v2-node__preview').click()
    await expect(image.locator('[data-node-floating-toolbar]')).toBeVisible()
    await image.locator('[data-node-inline-title]').click()
    const title = image.locator('[data-node-inline-title] input')
    await title.fill('雨中背影 · 改名')
    await title.press('Enter')
    await expect(image.locator('[data-node-inline-title]')).toHaveText('雨中背影 · 改名')
    const before = await image.boundingBox()
    await win.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
    await win.mouse.down()
    await win.mouse.move(before.x + before.width / 2 + 50, before.y + before.height / 2 + 30, { steps: 10 })
    await win.mouse.up()
    await expect.poll(async () => (await image.boundingBox()).x).toBeGreaterThan(before.x + 20)
    const gap = await image.evaluate((n) => n.getBoundingClientRect().top - n.querySelector('[data-node-label-row]').getBoundingClientRect().bottom)
    expect(gap).toBeGreaterThan(0)
    await win.screenshot({ path: path.join(out, 'project-renamed-dragged.png') })
    await image.locator('.generation-canvas-v2-node__preview').dblclick()
    const previewProof = await proveProbe(win.getByRole('dialog'), '真实项目双击打开图片预览')
    await win.screenshot({ path: path.join(out, 'project-expanded.png') })
    await win.keyboard.press('Escape')
    await expectAbsent(win.getByRole('dialog'), { provenBy: previewProof, message: '真实项目 Escape 关闭预览' })
  } finally { await app.close() }
}
