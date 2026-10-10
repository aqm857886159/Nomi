// 真实 Electron 屏外走查：分组框头不许盖住别组节点的生成框（2026-10-10，用户反馈）。
//
// 场景：分组 A 在上，A 里的节点 A0 选中，露出它的生成框（提示词框）；正下方放分组 B，B 的框头
// 与 A0 的生成框矩形相交。合同：相交区 elementFromPoint 取到的必须是生成框，不是 B 的框头。
// 层级数字来自 generationCanvas/reactFlow/canvasLayerOrder.ts（唯一 owner）。
//
// 用法：node tests/ux/group-layer-order.walk.mjs   产出：tests/ux/shots/group-layer-order/*.png
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import { createCanvasPerformanceFixture } from './fixtures/canvas-performance-fixture.mjs'
import { expect, waitForVisualQuiescence } from './_assert.mjs'
import { uiText } from './full-walk/invariants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shots = path.join(root, 'tests/ux/shots/group-layer-order')
fs.mkdirSync(shots, { recursive: true })

const temp = makeTempDir('nomi-group-layer-order-')
const fixture = createCanvasPerformanceFixture({ projectsDir: path.join(temp, 'projects'), scale: 'S', projectName: '分组层级走查' })
const images = fixture.record.payload.generationCanvas.nodes.filter((node) => node.kind === 'image').slice(0, 6)
const posA = [{ x: 130, y: 120 }, { x: 520, y: 120 }, { x: 910, y: 120 }]
const posB = [{ x: 130, y: 430 }, { x: 520, y: 430 }, { x: 910, y: 430 }]
images.forEach((node, index) => {
  node.position = index < 3 ? posA[index] : posB[index - 3]
  node.size = { width: 240, height: 180 }
  node.meta = { ...node.meta, previewHeight: 180, userResized: true }
  node.resultStackOpen = false
})
const ids = images.map((node) => node.id)
fixture.record.payload.generationCanvas = {
  nodes: images,
  edges: [],
  groups: [
    { id: 'gA', name: 'A组', categoryId: 'shots', nodeIds: ids.slice(0, 3), createdAt: 1, updatedAt: 1 },
    { id: 'gB', name: 'B组', categoryId: 'shots', nodeIds: ids.slice(3, 6), createdAt: 1, updatedAt: 1 },
  ],
  selectedNodeIds: [],
}
fs.writeFileSync(path.join(fixture.projectRoot, '.nomi/project.json'), JSON.stringify(fixture.record))

const launched = await launchNomiApp({ name: 'group-layer-order', projectsDir: fixture.projectsDir, syntheticCredentialStorage: true, settleMs: 0 })
const app = launched.app
let win = launched.win
try {
  await app.context().addInitScript(() => {
    localStorage.setItem('__nomiE2E', '1')
    localStorage.setItem('nomi:splash:v1', 'seen')
    localStorage.setItem('nomi:journey-tour:v1', 'seen')
  })
  await win.reload()
  await win.locator('[data-project-card]', { hasText: fixture.record.name }).click()
  for (let i = 0; i < 100 && !app.windows().some((page) => /projectId=/.test(page.url())); i++) await new Promise((r) => setTimeout(r, 300))
  win = app.windows().find((page) => /projectId=/.test(page.url()))
  expect(win, '项目窗口打开').toBeTruthy()
  await win.locator('.generation-canvas-v2__stage').waitFor()
  await waitForVisualQuiescence(win)
  await win.getByRole('button', { name: uiText('zh-CN', 'generationCommon.navigation.resetView'), exact: true }).first().click()
  await waitForVisualQuiescence(win)
  await expect(win.locator('.generation-canvas-v2__group-box[data-group-id="gB"]'), '分组 B 已渲染').toBeVisible()

  // 选中 A0：点它的左上角（卡面内，避开把手），露出生成框
  await win.locator(`.react-flow__node[data-id="${ids[0]}"]`).click({ position: { x: 60, y: 60 } })
  await waitForVisualQuiescence(win)

  const probe = await win.evaluate(() => {
    const rect = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }
    }
    const nodeA0 = document.querySelector('.react-flow__node.selected')
    const composer = nodeA0?.querySelector('.generation-canvas-v2-node__composer')
    const gB = document.querySelector('.generation-canvas-v2__group-box[data-group-id="gB"]')
    const headerB = gB?.querySelector('.generation-canvas-v2__group-box-label')
    const cr = rect(composer)
    const hr = rect(headerB)
    const nodesLayer = document.querySelector('.react-flow__nodes')
    const out = {
      selectedNodeId: nodeA0?.getAttribute('data-id') ?? null,
      selectedNodeZ: nodeA0 ? getComputedStyle(nodeA0).zIndex : null,
      nodesLayerZ: nodesLayer ? getComputedStyle(nodesLayer).zIndex : null,
      headerZ: headerB ? getComputedStyle(headerB).zIndex : null,
      composer: cr,
      headerB: hr,
      intersect: null,
      topAtIntersect: null,
    }
    if (cr && hr) {
      const ix = Math.max(cr.x, hr.x)
      const iy = Math.max(cr.y, hr.y)
      const ex = Math.min(cr.r, hr.r)
      const ey = Math.min(cr.b, hr.b)
      if (ex > ix && ey > iy) {
        const cx = (ix + ex) / 2
        const cy = (iy + ey) / 2
        const top = document.elementFromPoint(cx, cy)
        out.intersect = { x: ix, y: iy, w: ex - ix, h: ey - iy, cx, cy }
        out.topAtIntersect = {
          inComposer: Boolean(top?.closest('.generation-canvas-v2-node__composer')),
          inGroupHeader: Boolean(top?.closest('.generation-canvas-v2__group-box-label')),
        }
      }
    }
    return out
  })
  console.log('[group-layer-order] probe', JSON.stringify(probe))

  expect(probe.selectedNodeId, 'A0 被选中（露出生成框）').toBe(ids[0])
  expect(probe.composer, '生成框可见').not.toBeNull()
  expect(probe.headerB, '分组 B 框头可见').not.toBeNull()
  expect(probe.intersect, '生成框与分组 B 框头矩形相交（走查场景成立）').not.toBeNull()
  expect(probe.topAtIntersect?.inComposer, '相交区最上层是生成框').toBe(true)
  expect(probe.topAtIntersect?.inGroupHeader, '相交区最上层不是分组框头').toBe(false)
  expect(Number(probe.nodesLayerZ), '节点层 z 来自层级表').toBe(2)
  expect(Number(probe.headerZ), '分组框头 z 来自层级表').toBe(1)

  await win.screenshot({ path: path.join(shots, 'z-order-composer-over-group-header.png') })
  console.log('[group-layer-order] PASS')
} finally {
  await app.close()
}
