// Built Electron, isolated project/profile. Runtime fixture matrix plus original toolbar/editor/upload journeys.
import fs from 'node:fs'
import path from 'node:path'
import { require as tsxRequire } from 'tsx/cjs/api'
import { expect } from '@playwright/test'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { addCanvasNode, canvasResetView } from './_shell.mjs'
import { screenshotSettled, waitForVisualQuiescence, proveProbe, expectAbsent } from './_assert.mjs'
import { findCanvasBlankPoint, waitForCanvasViewportSettled } from './_canvasHit.mjs'
import { stationTimeout } from './_station-budget.mjs'

const { createWorkspaceProject } = tsxRequire('../../electron/workspace/workspaceRepository.ts', import.meta.url)
const { GENERATION_NODE_PLUGINS } = tsxRequire('../../src/workbench/generationCanvas/nodes/registry.ts', import.meta.url)
const { nodeGroupSchema } = tsxRequire('../../src/workbench/generationCanvas/model/generationCanvasSchema.ts', import.meta.url)
const { ICON_TIERS } = tsxRequire('../../src/design/iconTiers.ts', import.meta.url)
// 类型图标的档位（拍板板 IconsF1 D3 / D4）：节点窄条（音频条）角标档 13 / 1.8，其余大 / 中空态空态档 24 / 1.5。
const STRIP_KINDS = new Set(['audio'])
const markTier = (kind) => (STRIP_KINDS.has(kind) ? ICON_TIERS.corner : ICON_TIERS.empty)
/** 量**渲染尺寸**（getBoundingClientRect 折回 CSS 像素 + 描边那条 path 的 computed stroke-width），不读 svg 属性。 */
const renderedMark = (holder) => holder.locator('svg').first().evaluate((svg) => {
  const disc = svg.parentElement
  const scale = disc.offsetWidth > 0 ? disc.getBoundingClientRect().width / disc.offsetWidth : 1
  const rect = svg.getBoundingClientRect()
  const stroked = svg.querySelector('path:not([stroke="none"])') ?? svg
  const round = (value) => Math.round(value * 10) / 10
  return { width: round(rect.width / scale), height: round(rect.height / scale), stroke: round(Number.parseFloat(getComputedStyle(stroked).strokeWidth)) }
})
const expectMark = async (holder, kind) => {
  const tier = markTier(kind)
  expect(await renderedMark(holder), `${kind} type mark renders at the F1 tier`).toEqual({ width: tier.size, height: tier.size, stroke: tier.stroke })
}
const arg = (flag, fallback) => { const i = process.argv.indexOf(flag); return i < 0 ? fallback : process.argv[i + 1] }
const locale = arg('--locale', 'zh-CN'), scheme = arg('--scheme', 'light')
const visualOnly = process.argv.includes('--visual-only')
const tag = `${locale === 'en' ? 'en' : 'zh'}-${scheme}`
const output = path.join(repoRoot, 'docs/evidence/2026-10-11-node-guidance')
const tempRoot = makeTempDir('nomi-contextual-guidance-')
const settingsDir = path.join(tempRoot, 'settings'), projectsDir = path.join(tempRoot, 'projects')
const projectId = 'contextual-guidance', projectRoot = path.join(projectsDir, projectId)
fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(settingsDir, { recursive: true })
const kinds = ['image', 'video', 'text', 'character', 'scene', 'audio', 'whiteboard', 'panorama', 'model3d', 'keyframe', 'shot', 'output', 'clip', 'director']
const fixture = (kind, id, position = { x: 220, y: 160 }, extra = {}) => ({
  id, kind, position, title: `${kind} · ${locale === 'en' ? 'Rainy street' : '雨夜街口'}`,
  categoryId: 'shots', prompt: '', status: 'idle', meta: {},
  size: { ...GENERATION_NODE_PLUGINS.find(p => p.kind === kind).defaultSize }, ...extra,
})
const overview = Array.from({ length: 6 }, (_, i) => fixture('image', `overview-${i}`, { x: 100 + (i % 3) * 370, y: 100 + Math.floor(i / 3) * 255 }, { size: { width: 320, height: 180 } }))
const group = nodeGroupSchema.parse({ id: 'guidance-group', categoryId: 'shots', name: locale === 'en' ? 'Rainy street · six shots' : '雨夜街口 · 六个镜头', nodeIds: overview.map(n => n.id), collapsed: false, createdAt: 1, updatedAt: 1 })
createWorkspaceProject({ rootPath: projectRoot, record: { id: projectId, name: 'Contextual node guidance', payload: {
  generationCanvas: { nodes: overview, edges: [], groups: [group], selectedNodeIds: [], canvasZoom: 1, canvasPan: { x: 0, y: 0 } },
  timeline: null, workbenchDocument: null,
} } }, { settingsRoot: settingsDir, defaultProjectsRoot: projectsDir })
const run = await launchNomiApp({ name: 'contextual-node-guidance', tempRoot, settingsDir, projectsDir,
  userDataDir: path.join(tempRoot, 'user-data'), settleMs: 0,
  viewportSize: { width: 1680, height: 1050 },
  initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi-color-scheme': scheme, '__nomiE2E': '1', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
})
const report = { locale, scheme, mode: visualOnly ? 'visual-matrix' : 'full-journey', boundary: 'built macOS Electron; isolated fixture matrix; full mode additionally uses original toolbar/text/upload/whiteboard journeys; no generation requested', checks: [], screenshots: [], limitations: ['Windows, installed package and paid generation unverified'] }
let win = run.win
const node = id => win.locator(`article[data-node-id="${id}"]`)
const empty = id => node(id).locator('[data-node-empty-state]')
const check = (id, detail) => { report.checks.push({ id, pass: true, detail }); console.log(`✓ ${id}: ${detail}`) }
const shot = async name => {
  const file = path.join(output, `${name}-${tag}.png`)
  await screenshotSettled(win, { path: file }); report.screenshots.push(path.relative(repoRoot, file))
}
async function blank() {
  const point = await findCanvasBlankPoint(win)
  expect(point).not.toBeNull()
  await win.mouse.click(point.x, point.y)
  await expect.poll(() => win.evaluate(() => window.__nomiCanvasStore.getState().selectedNodeIds.length)).toBe(0)
}
async function put(nodes, groups = []) {
  // State-matrix setup only. The original-entry journeys below use product UI.
  await win.evaluate(({ nodes, groups }) => window.__nomiCanvasStore.setState({ nodes, groups, edges: [], selectedNodeIds: [] }), { nodes, groups })
  await expect.poll(() => win.evaluate(() => window.__nomiCanvasStore.getState().nodes.length)).toBe(nodes.length)
  // Large canvases intentionally virtualize offscreen nodes.
  if (nodes.length <= 15) await expect(win.locator('article[data-node-id]')).toHaveCount(nodes.length)
  await canvasResetView(win); await waitForCanvasViewportSettled(win)
}
async function centerClick(id) {
  const box = await node(id).boundingBox()
  expect(box).not.toBeNull()
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}
try {
  await win.locator('[data-project-card]', { hasText: 'Contextual node guidance' }).click()
  await expect.poll(() => run.app.windows().some(w => w.url().includes(`projectId=${projectId}`))).toBe(true)
  win = run.app.windows().find(w => w.url().includes(`projectId=${projectId}`))
  await win.locator('.generation-canvas-v2__stage').waitFor()
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore))
  await canvasResetView(win); await waitForCanvasViewportSettled(win)
  await expect(win.locator('.generation-canvas-v2__group-box[data-group-id="guidance-group"]')).toBeVisible()
  await expect(win.locator('[data-empty-tier="icon"]')).toHaveCount(6)
  const fullNodeProbe = await proveProbe(win.locator('article[data-node-id]:not([data-render-mode="lightweight"])'), 'full renderer nodes are mounted')
  await shot('01-group-browsing')
  check('guidance.group.icon-only', 'six empty nodes have type marks and external names; zero instructional rows')
  await centerClick('overview-1')
  await expect(node('overview-1').locator('[data-node-try="image"]')).toBeVisible()
  const guideProbe = await proveProbe(node('overview-1').locator('[data-node-try="image"]'), 'selected image has actionable guidance')
  await expect(node('overview-1').locator('[data-node-composer-prompt]')).toBeVisible()
  await expect(win.locator('[data-empty-tier="icon"]')).toHaveCount(5)
  await shot('02-single-selected')
  check('guidance.single.next-step', 'only the current node expands its original guidance and composer')
  await blank()
  await expectAbsent(win.locator('[data-node-try]'), { provenBy: guideProbe })
  const frame = await win.locator('.generation-canvas-v2__group-box[data-group-id="guidance-group"]').boundingBox()
  await win.mouse.click(frame.x + 8, frame.y + frame.height / 2)
  await expect.poll(() => win.evaluate(() => window.__nomiCanvasStore.getState().selectedNodeIds.length)).toBe(6)
  await expect(win.locator('[data-empty-tier="icon"]')).toHaveCount(6)
  check('guidance.group.selection', 'selecting the entire real group keeps all six members icon-only')
  await blank()
  // Exact runtime-renderer matrix, including legacy prop body and multi-selection.
  for (const kind of [...kinds, 'prop']) {
    const current = kind === 'prop' ? fixture('image', kind, undefined, { renderKind: 'prop-card' }) : fixture(kind, kind)
    const peer = fixture('image', 'peer', { x: 1050, y: 180 }, { size: { width: 240, height: 160 } })
    await put([current, peer])
    await expect(empty(kind)).toHaveAttribute('data-empty-tier', 'icon')
    expect((await empty(kind).innerText()).trim()).toBe('')
    const emptyProbe = await proveProbe(empty(kind), `${kind} empty body is mounted`)
    await win.evaluate(id => window.__nomiCanvasStore.getState().selectNode(id), kind)
    if (kind === 'clip') await expectAbsent(empty(kind), { provenBy: emptyProbe })
    else await expect(empty(kind)).not.toHaveAttribute('data-empty-tier', 'icon')
    await win.evaluate(id => window.__nomiCanvasStore.getState().selectNodes([id, 'peer']), kind)
    await expect(empty(kind)).toHaveAttribute('data-empty-tier', 'icon')
    const box = await empty(kind).locator('svg').boundingBox()
    expect(box?.width, `${kind} type mark has visible geometry`).toBeGreaterThan(0)
    await expectMark(empty(kind), kind)
    if (kind === 'text') await expect(node('text').locator('header[aria-label]'), 'empty unselected text card keeps its drag handle header').toBeVisible()
    if (['image', 'video', 'character', 'scene', 'prop', 'keyframe', 'shot', 'output', 'model3d'].includes(kind)) {
      const holder = await empty(kind).boundingBox(), disc = await empty(kind).locator('span[aria-hidden="true"]').boundingBox()
      expect(disc.y - holder.y, `${kind} icon disc sits >= 44px below the card body top (10-10 board B)`).toBeGreaterThanOrEqual(43.5)
    }
    if (['clip', 'director', 'text', 'panorama', 'whiteboard'].includes(kind)) await shot(`matrix-${kind}`)
    check(kind === 'image' ? 'guidance.kind.image' : `guidance.kind.${kind}`, 'browsing and multi-selection icon-only; single-selection guidance; nonzero icon geometry')
  }
  // Exercise the far view (zoom below the detail line) through original zoom controls.
  // Kinds that own their far view stay full (registry ownsZoomTiers: the clip card's timeline); the rest use the generic far card.
  if (visualOnly) {
    const farOwners = GENERATION_NODE_PLUGINS.filter((plugin) => plugin.ownsZoomTiers).map((plugin) => plugin.kind)
    const farCardKinds = kinds.filter((kind) => !farOwners.includes(kind))
    const dense = Array.from({ length: 81 }, (_, i) => fixture(kinds[i % kinds.length], `dense-${i}`, { x: 120 + (i % 7) * 370, y: 120 + Math.floor(i / 7) * 280 }))
    await put(dense)
    for (let i = 0; i < 3; i += 1) {
      await win.getByRole('button', { name: locale === 'en' ? 'Zoom out' : '缩小', exact: true }).click()
      await waitForCanvasViewportSettled(win)
    }
    await expect.poll(() => win.locator('article[data-render-mode="lightweight"]').count()).toBeGreaterThanOrEqual(farCardKinds.length)
    await expectAbsent(win.locator(`article[data-node-id]:not([data-render-mode="lightweight"])${farOwners.map((kind) => `:not([data-kind="${kind}"])`).join('')}`), { provenBy: fullNodeProbe })
    for (let i = 0; i < kinds.length; i += 1) {
      if (farOwners.includes(kinds[i])) continue
      await expect(empty(`dense-${i}`)).toHaveAttribute('data-empty-tier', 'icon')
      await expectMark(empty(`dense-${i}`), kinds[i])
      const bounds = await empty(`dense-${i}`).boundingBox()
      const badge = await empty(`dense-${i}`).locator('span[aria-hidden="true"]').boundingBox()
      expect(badge.y, `${kinds[i]} LOD mark fits the body top`).toBeGreaterThanOrEqual(bounds.y - 0.5)
      expect(badge.y + badge.height, `${kinds[i]} LOD mark fits the body bottom`).toBeLessThanOrEqual(bounds.y + bounds.height + 0.5)
    }
    await shot('03-dense-zoomed-out')
    check('guidance.lod.type-marks', `81-node canvas at 51% via original zoom controls retains canonical type marks across the ${farCardKinds.length} kinds on the generic far card`)
    await put([fixture('audio', 'audio-idle')])
    await proveProbe(node('audio-idle').locator('[data-node-inline-title]'), 'idle audio has its external name')
    for (const status of ['queued', 'running', 'error']) {
      const current = fixture('audio', `audio-${status}`, undefined, { status, error: status === 'error' ? 'model not enabled' : undefined })
      await put([current])
      await expect(node(current.id)).toHaveAttribute('data-status', status)
      // 10-12 协调拍板：空卡在任何生成状态都显示框外标签行（标题不随状态消失）。
      await expect(node(current.id).locator('[data-node-inline-title]')).toHaveText(current.title)
      await expect(node(current.id).locator('[data-node-inline-status] [data-generation-status]')).toBeVisible()
      check(`guidance.operational.audio.${status}`, 'original operational status remains visible and the empty card keeps its external name')
    }
    const legacyEmpty = fixture('whiteboard', 'legacy-empty')
    delete legacyEmpty.status
    await put([legacyEmpty])
    await expect(node(legacyEmpty.id)).toHaveAttribute('data-status', 'idle')
    await expect(node(legacyEmpty.id).locator('[data-node-inline-title]')).toHaveText(legacyEmpty.title)
    await expect(empty(legacyEmpty.id)).toHaveAttribute('data-empty-tier', 'icon')
    check('guidance.legacy.status-omitted', 'legacy node with omitted status uses normalized idle state and retains its external name')
  }
  if (!visualOnly) {
  // Original entry: toolbar creation automatically expands the new image node.
  await put([])
  await addCanvasNode(win, 'image')
  const newImage = await win.evaluate(() => window.__nomiCanvasStore.getState().nodes.at(-1).id)
  await expect(node(newImage).locator('[data-node-try="image"]')).toBeVisible()
  await expect(node(newImage).locator('[data-node-composer-prompt]')).toBeVisible()
  await blank()
  await expect(empty(newImage)).toHaveAttribute('data-empty-tier', 'icon')
  check('guidance.created.auto-expand', 'original toolbar creates a selected node with next steps; deselect restores type mark')
  // Original entry: text editing remains directly available and survives deselection.
  await addCanvasNode(win, 'text')
  const textId = await win.evaluate(() => window.__nomiCanvasStore.getState().nodes.at(-1).id)
  await blank()
  const textIconProbe = await proveProbe(node(textId).locator('[data-empty-tier="icon"]'), 'empty text shows the browsing mark before editing')
  const editor = node(textId).locator('.ProseMirror')
  await editor.click(); await win.keyboard.type('Rain falls across the empty street.')
  await blank()
  await expect(editor).toContainText('Rain falls across the empty street.')
  await expectAbsent(node(textId).locator('[data-empty-tier="icon"]'), { provenBy: textIconProbe })
  check('guidance.text.content', 'original toolbar and editor accept authored text; deselection preserves the content')
  // First pointer gesture selects, second gesture activates. Real local media is imported.
  for (const kind of ['character', 'scene', 'prop', 'audio', 'panorama']) {
    const current = kind === 'prop' ? fixture('image', kind, undefined, { renderKind: 'prop-card' }) : fixture(kind, kind)
    await put([current])
    const uploadEmptyProbe = await proveProbe(empty(kind), `${kind} is empty before local import`)
    let chooserCount = 0
    const observeChooser = () => { chooserCount += 1 }
    win.on('filechooser', observeChooser)
    await centerClick(kind)
    await expect(node(kind)).toHaveAttribute('data-selected', 'true')
    await waitForVisualQuiescence(win)
    expect(chooserCount, `${kind}: first gesture must only select`).toBe(0)
    const chooserEvent = win.waitForEvent('filechooser')
    await centerClick(kind)
    const chooser = await chooserEvent
    expect(chooserCount).toBe(1)
    await chooser.setFiles(path.join(repoRoot, kind === 'audio' ? 'tests/ux/fixtures/real-narration.mp3' : 'src/devlab/designLab/videoNodeNext/fixtures/frame-first.jpg'))
    await expect.poll(() => win.evaluate(id => Boolean(window.__nomiCanvasStore.getState().nodes.find(n => n.id === id)?.result?.url), kind), { timeout: stationTimeout({ operations: 2 }) }).toBe(true)
    await blank()
    await expectAbsent(empty(kind), { provenBy: uploadEmptyProbe })
    win.off('filechooser', observeChooser)
    check(`guidance.upload.${kind}`, 'first click selects; second opens native chooser; genuine local media remains after deselection')
  }
  await put([fixture('whiteboard', 'whiteboard')])
  await centerClick('whiteboard')
  await expect(node('whiteboard')).toHaveAttribute('data-selected', 'true')
  const whiteboardSurfaceProbe = await proveProbe(node('whiteboard').locator('[data-testid="whiteboard-empty-action"]'), 'whiteboard action is present on the canvas before opening its dialog')
  await expectAbsent(win.locator('[role="dialog"][aria-modal="true"]'), { provenBy: whiteboardSurfaceProbe })
  await node('whiteboard').locator('[data-testid="whiteboard-empty-action"]').click()
  await expect(win.locator('[role="dialog"][aria-modal="true"]')).toBeVisible()
  check('guidance.whiteboard.activation', 'first click selects; explicit second action opens the existing whiteboard editor')
  }
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'; report.error = String(error.stack || error)
  fs.mkdirSync(path.join(repoRoot, '.tmp/walk-fail'), { recursive: true })
  await win.screenshot({ path: path.join(repoRoot, `.tmp/walk-fail/node-guidance-${tag}.png`) }).catch(() => {})
  throw error
} finally {
  fs.writeFileSync(path.join(output, `walk-${tag}.json`), JSON.stringify(report, null, 2) + '\n')
  await run.app.close()
}
