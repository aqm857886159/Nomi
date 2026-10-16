// Real Electron regression: dense portrait boards must preserve prompt clipping
// and expose the generation controls when the user selects a card near an edge.
// Uses repository-owned real AI footage; never changes a user profile/project.
import fs from 'node:fs'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { buildCoreSmokeProject } from './core-smoke/fixture.mjs'
import { launchNomiApp, closeNomiApp, repoRoot } from './_launchApp.mjs'
import { expect, expectHittable, screenshotSettled, proveProbe, expectAbsent } from './_assert.mjs'
import { findNodeHitPoint, findCanvasBlankPoint } from './_canvasHit.mjs'
import { canvasFitViewButton, switchWorkspace } from './_shell.mjs'

const require = createRequire(import.meta.url)
const locale = process.argv[2] === 'en' ? 'en' : 'zh-CN'
const label = process.argv[3] || 'run'
const evidenceDir = path.join(repoRoot, 'outputs', 'dense-canvas-generation-controls', label, locale)
fs.mkdirSync(evidenceDir, { recursive: true })
const tempRoot = makeTempDir('nomi-dense-canvas-controls-')
const projectsDir = path.join(tempRoot, 'projects')
fs.mkdirSync(projectsDir, { recursive: true })
const prompt = '镜头特写：一只猫看向窗边。保持暖色侧光和镜头构图，细节保持自然。'.repeat(120)
const nodeSelector = id => `.react-flow__node[data-id="${id}"]`
const seed = ({ imageResult, imageMeta }) => {
  const nodes = Array.from({ length: 60 }, (_, index) => {
    const result = imageResult(`r-${index}`, index % 6 + 1)
    return { id: `dense-${index}`, kind: 'image', categoryId: 'shots', title: `分镜 ${index + 1}`, prompt,
      position: { x: 80 + index % 10 * 300, y: 80 + Math.floor(index / 10) * 440 },
      size: { width: 180, height: 320 }, references: [], runs: [], status: 'success', result,
      history: index === 0 ? [result, { ...result, id: 'old-1', createdAt: 2, versionNo: 2 }, { ...result, id: 'old-2', createdAt: 3, versionNo: 3 }] : [],
      meta: imageMeta(),
    }
  })
  const edges = nodes.flatMap((node, index) => Array.from({ length: 5 }, (_, offset) => ({
    id: `edge-${index}-${offset}`, source: nodes[(index + offset + 1) % nodes.length].id,
    target: node.id, mode: 'reference', order: offset,
  })))
  return { nodes, edges, groups: [] }
}
const project = buildCoreSmokeProject({ fixture: 'empty', projectsDir, name: 'dense-canvas-controls', seed })
// A genuine portrait source, rather than a landscape image with invented metadata.
const portrait = path.join(project.projectRoot, 'assets', 'imported', 'portrait.png')
execFileSync(require('@ffmpeg-installer/ffmpeg').path, ['-hide_banner', '-loglevel', 'error', '-y',
  '-ss', '0.5', '-i', path.join(repoRoot, 'tests/ux/fixtures/real-shot-640x360.mp4'),
  '-vf', 'crop=202:360:219:0,scale=360:640', '-frames:v', '1', portrait], { stdio: 'pipe' })
const portraitUrl = `nomi-local://asset/${encodeURIComponent(project.projectId)}/assets/imported/portrait.png`
for (const node of project.record.payload.generationCanvas.nodes) {
  node.result = { ...node.result, url: portraitUrl, thumbnailUrl: portraitUrl }
  node.history = node.history.map(result => ({ ...result, url: portraitUrl, thumbnailUrl: portraitUrl }))
  node.meta = { imageWidth: 360, imageHeight: 640, imageAspectRatio: 9 / 16 }
}
fs.writeFileSync(path.join(project.projectRoot, '.nomi', 'project.json'), JSON.stringify(project.record))
const report = { locale, fixture: { nodes: 60, edges: 300, promptCharacters: prompt.length, source: 'repository real-shot-640x360.mp4, portrait crop 360x640' }, checks: [], errors: [] }
let app
let win
const check = (ok, label, details = {}) => {
  report.checks.push({ label, ok, ...details })
  if (!ok) throw new Error(`${label}: ${JSON.stringify(details)}`)
}
try {
  const launched = await launchNomiApp({ name: `dense-canvas-controls-${locale}`, tempRoot, projectsDir,
    viewportSize: { width: 1280, height: 933 }, settleMs: 1000,
    ...(process.argv[4] ? { executablePath: process.argv[4] } : {}),
    initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen',
      'nomi:canvas-gesture-hint:v1': 'seen', 'nomi.canvasGesture.scheme': 'modifier-zoom' },
  })
  app = launched.app
  report.runtime = await app.evaluate(() => ({ appVersion: process.env.npm_package_version || null, electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, arch: process.arch }))
  win = launched.win
  await win.locator('[data-project-card]', { hasText: project.projectName }).first().click()
  await expect.poll(() => app.windows().some(page => /projectId=/.test(page.url()))).toBe(true)
  win = app.windows().find(page => /projectId=/.test(page.url()))
  win.on('pageerror', error => report.errors.push(String(error)))
  await switchWorkspace(win, 'generation')
  await win.locator('.generation-canvas-v2__stage').waitFor()
  const viewport = () => win.locator('.react-flow__viewport').evaluate(el => getComputedStyle(el).transform)
  const select = async id => {
    const selector = nodeSelector(id)
    await expect.poll(async () => (await findNodeHitPoint(win, { nodeSelector: selector })) !== null).toBe(true)
    const point = await findNodeHitPoint(win, { nodeSelector: selector })
    await win.mouse.click(point.x, point.y)
    await win.locator(`${selector} [data-composer-host="canvas"]`).waitFor({ state: 'visible' })
    await win.waitForTimeout(300)
    return win.locator(`${selector} [data-composer-host="canvas"]`)
  }
  const snapshot = async name => {
    const bw = await app.browserWindow(win)
    await bw.evaluate(window => { window.show(); window.focus() })
    await win.bringToFront()
    // Native macOS occlusion can leave a screenshot containing only damaged tiles.
    // A one-pixel resize requests a complete frame; it is evidence capture only.
    await bw.evaluate(window => { const [width, height] = window.getContentSize(); window.setContentSize(width + 1, height); window.setContentSize(width, height) })
    await screenshotSettled(win, { path: path.join(evidenceDir, `${name}.png`) })
  }
  const controls = async (composer, name) => {
    const footer = composer.locator('[data-node-composer-footer]')
    await expectHittable(footer.locator('button').first(), `${name}: model control`)
    await expectHittable(footer.locator('[data-bar-segment="generate"]'), `${name}: generate control`)
    const geometry = await composer.evaluate(el => {
      const stage = el.closest('.generation-canvas-v2__stage').getBoundingClientRect()
      const card = el.getBoundingClientRect()
      const prompt = el.querySelector('[data-node-composer-prompt]')
      const rect = prompt.getBoundingClientRect()
      const style = getComputedStyle(prompt)
      return { stage: stage.toJSON(), card: card.toJSON(), prompt: rect.toJSON(), overflowY: style.overflowY,
        clientHeight: prompt.clientHeight, scrollHeight: prompt.scrollHeight }
    })
    check(geometry.card.left >= geometry.stage.left && geometry.card.right <= geometry.stage.right && geometry.card.bottom <= geometry.stage.bottom - 70,
      `${name}: composer fully inside usable stage`, { geometry })
    check(geometry.overflowY === 'auto' && geometry.scrollHeight > geometry.clientHeight && geometry.prompt.bottom <= geometry.card.bottom,
      `${name}: long prompt internally scrolls`, { geometry })
    return geometry
  }
  await canvasFitViewButton(win).click()
  await win.waitForTimeout(600)
  let composer = await select('dense-0')
  await controls(composer, 'left-edge')
  await snapshot('01-left-edge-controls')
  const stable = await viewport()
  await select('dense-0')
  check(await viewport() === stable, 'repeat selection does not drift viewport')
  await composer.locator('[data-node-composer-prompt]').evaluate(el => { el.scrollTop = el.scrollHeight })
  check(await composer.locator('[data-node-composer-prompt]').evaluate(el => el.scrollTop > 0), 'long prompt reaches its end')
  // Opening versions deliberately replaces the composer; closing restores reachable controls.
  const badge = win.locator(`${nodeSelector('dense-0')} [data-version-badge]`)
  await expectHittable(badge, 'version badge')
  const composerProof = await proveProbe(composer, 'selected node composer before version grid')
  await badge.click()
  await expect(win.locator('[data-version-grid="dense-0"]')).toBeVisible()
  await expectAbsent(composer, { provenBy: composerProof, message: 'version grid hides composer' })
  check(true, 'version grid hides composer')
  await badge.click()
  composer = win.locator(`${nodeSelector('dense-0')} [data-composer-host="canvas"]`)
  await composer.waitFor({ state: 'visible' })
  await win.waitForTimeout(300)
  await controls(composer, 'version-grid-restored')
  // Panning is an explicit user gesture. It must not be undone by reveal.
  const blank = await findCanvasBlankPoint(win, { inset: 80 })
  check(Boolean(blank), 'real blank pane for pan')
  await win.mouse.move(blank.x, blank.y)
  await win.mouse.down()
  await win.mouse.move(blank.x + 70, blank.y + 35, { steps: 12 })
  await win.mouse.up()
  await win.waitForTimeout(200)
  const afterPan = await viewport()
  await win.waitForTimeout(400)
  check(await viewport() === afterPan, 'pan settles without viewport snap-back')
  check(await win.locator('.generation-canvas-v2__stage').getAttribute('data-dragging') === null, 'pan releases dragging flag')
  await canvasFitViewButton(win).click()
  await win.waitForTimeout(600)
  composer = await select('dense-50')
  await controls(composer, 'bottom-edge')
  await snapshot('02-bottom-edge-controls')
  const dragPoint = await findNodeHitPoint(win, { nodeSelector: nodeSelector('dense-51') })
  check(Boolean(dragPoint), 'adjacent unselected card has a real drag handle')
  const beforeNodeDrag = await viewport()
  await win.mouse.move(dragPoint.x, dragPoint.y)
  await win.mouse.down()
  await win.mouse.move(dragPoint.x + 65, dragPoint.y, { steps: 12 })
  await win.mouse.up()
  await win.waitForTimeout(500)
  check(await viewport() === beforeNodeDrag, 'selecting by drag does not acquire viewport reveal')
  check(await win.locator('.generation-canvas-v2__stage').getAttribute('data-dragging') === null, 'node drag releases dragging flag')
  check(report.errors.length === 0, 'no renderer errors', { errors: report.errors })
  report.pass = true
} catch (error) {
  report.pass = false
  report.failure = String(error.stack || error)
  if (win) await win.screenshot({ path: path.join(evidenceDir, 'failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  fs.writeFileSync(path.join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ pass: report.pass, evidenceDir, failure: report.failure, checks: report.checks.length }))
  if (app) await closeNomiApp(app)
}
