// Production Electron journey: original entrances, real photographed image, real gestures and persisted output.
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, screenshotSettled, proveProbe, expectAbsent, expectOverlayReachable, waitForVisualQuiescence } from './_assert.mjs'
import { buildInlineWhiteboardProject } from './_whiteboardFixture.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { collapseAgentPanel, canvasSetZoomPercent, canvasResetView, canvasZoomPercent } from './_shell.mjs'
import { checkBoardManifest } from '../../scripts/check-board-parity.mjs'
import { hashBoardSource } from '../../scripts/board-source-hash.mjs'

const boardDir = path.resolve('docs/design/boards/2026-10-12')
const boardManifest = JSON.parse(fs.readFileSync(path.join(boardDir, 'InlineWhiteboard.board.json'), 'utf8'))
const boardCandidates = JSON.parse(fs.readFileSync(path.join(boardDir, 'InlineWhiteboard.candidates.json'), 'utf8'))
expect(hashBoardSource(boardDir, 'InlineWhiteboard')).toBe(boardCandidates.sourceSha256)
expect(checkBoardManifest({ board: 'InlineWhiteboard', manifest: boardManifest, candidates: boardCandidates.candidates, assertionCorpus: fs.readFileSync(new URL(import.meta.url), 'utf8') })).toEqual([])

const locale = process.argv.includes('--en') ? 'en' : 'zh-CN'
const dark = process.argv.includes('--dark')
const performanceRun = process.argv.includes('--performance')
const repoMedia = process.argv.includes('--repo-media')
const argValue = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined }
const repetitions = Number(argValue('--runs') ?? 1)
const label = argValue('--label')
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20) throw new Error('--runs must be an integer from 1 to 20')
if (label && !/^[a-z0-9-]+$/.test(label)) throw new Error('--label must use lowercase letters, numbers and hyphens')
const outputRoot = path.resolve('tests/ux/shots/whiteboard-refactor')
const samples = []
for (let iteration = 0; iteration < repetitions; iteration++) {
  const output = label ? path.join(outputRoot, label, `run-${iteration + 1}`) : path.join(outputRoot, `${locale}-${dark ? 'dark' : 'light'}${performanceRun ? '-perf' : ''}`)
  samples.push(await runJourney(output))
}
if (label) fs.writeFileSync(path.join(outputRoot, label, 'report.json'), JSON.stringify({ samples }, null, 2))

async function runJourney(output) {
fs.mkdirSync(output, { recursive: true })
// A project saved while the annotation tool existed (removed 2026-10-17): its stored feedback must be ignored without error and left in the file.
const legacyAnnotations = [{ id: 'note-legacy', resultId: 'original', x: 120, y: 80, text: 'Brighten this region' }]
const { projectsDir, projectId, record, recordPath, imagePath, nodes, readNode, source } = buildInlineWhiteboardProject({
  repoMedia, legacyAnnotations,
  extraNodes: ({ sources, size }) => performanceRun ? Array.from({ length: 30 }, (_, index) => ({ id: `background-${index}`, kind: 'image', categoryId: 'shots', title: 'Photograph', prompt: '', position: { x: 10000 + index % 6 * 650, y: 10000 + Math.floor(index / 6) * 420 }, size: { width: 340, height: 191.25 }, status: 'success', result: sources[0].result, history: [sources[0].result], meta: { imageWidth: size.width, imageHeight: size.height, previewHeight: 191.25, userResized: true } })) : [],
})
const t = key => uiText(locale, key)
const run = await launchNomiApp({ name: `inline-whiteboard-${locale}`, projectsDir, settleMs: 0, initialLocalStorage: {
  'nomi:locale:v1': locale, 'nomi-color-scheme': dark ? 'dark' : 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen',
} })
const page = run.win
const errors = []
page.on('pageerror', error => errors.push(error.message))
const evidence = { locale, dark, sampledWorkload: { nodes: nodes.length, offscreenNodes: performanceRun ? 30 : 0, activeEditors: 1, uniqueSourceImages: 1, sourceWidth: source.width, sourceHeight: source.height, sourceMode: source.mode }, workload: `${nodes.length} nodes (${performanceRun ? 30 : 0} offscreen), one active editor; ${source.mode} photograph`, checks: [], performance: null }
const check = (name, value) => { expect(value, name).toBeTruthy(); evidence.checks.push(name); console.log(`✓ ${name}`) }
const action = name => page.locator(`[data-toolbar-action="whiteboard-${name}"]`)
const editor = page.locator('[data-nomi-inline-whiteboard="true"]')
const node = page.locator('[data-node-id="image"]')
async function snap(name) { await screenshotSettled(page, { path: path.join(output, `${name}.png`) }) }
// Measure only once the element is on screen and the screen has stopped moving. A bare boundingBox() right after opening
// a project or a fit read null or a box from mid-layout (2026-10-27: the en run's first measurement came back null).
async function settledBox(locator, name) {
  await expect(locator, `${name} is visible before it is measured`).toBeVisible()
  await waitForVisualQuiescence(page)
  const box = await locator.boundingBox()
  expect(box, `${name} has a box once the screen is still`).not.toBeNull()
  return box
}
async function stroke() {
  await action('brush').click()
  const layer = editor.getByLabel(t('generationCommon.whiteboard.drawingLayerAria'), { exact: true })
  const box = await settledBox(layer, 'drawing layer')
  await page.mouse.move(box.x + box.width * .25, box.y + box.height * .45)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * .65, box.y + box.height * .5, { steps: 16 })
  await page.mouse.up()
  await expect.poll(() => readNode('image').meta.whiteboardState?.strokes.length ?? 0).toBeGreaterThan(0)
}
// The creator's first gesture after opening: no tool is picked first (the 2026-10-22 escape — the walk used to pick the brush for them).
async function firstGestureStroke(nodeId) {
  const layer = editor.getByLabel(t('generationCommon.whiteboard.drawingLayerAria'), { exact: true })
  const box = await settledBox(layer, 'drawing layer')
  await page.mouse.move(box.x + box.width * .3, box.y + box.height * .4)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .55, { steps: 16 })
  await page.mouse.up()
  await expect.poll(() => readNode(nodeId).meta?.whiteboardState?.strokes?.length ?? 0, { message: 'dragging right after opening draws a stroke without picking a tool first' }).toBeGreaterThan(0)
}
async function openImage() {
  await node.click()
  await page.getByRole('button', { name: t('generationCommon.imageToolbar.whiteboard'), exact: true }).click()
  await expect(editor).toBeVisible()
  await expect(editor.locator('canvas').first()).toBeVisible()
}
try {
  await page.locator('[data-project-card]', { hasText: record.name }).dblclick()
  await collapseAgentPanel(page)
  if (performanceRun) {
    await canvasResetView(page)
    await expect.poll(() => canvasZoomPercent(page)).toBe(100)
    await canvasSetZoomPercent(page, 85)
  }
  const titleBox = await settledBox(page.getByText('Photograph', { exact: true }), 'image node title')
  const positionBeforeTitleDrag = readNode('image').position
  await page.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(titleBox.x + titleBox.width / 2 + 210, titleBox.y + titleBox.height / 2, { steps: 16 })
  await page.mouse.up()
  await expect.poll(() => readNode('image').position.x - positionBeforeTitleDrag.x, { message: 'dragging the title moves the node' }).toBeGreaterThan(100)
  const firstOpenStarted = performance.now()
  await openImage()
  await expect.poll(() => readNode('image').meta.whiteboardState?.canvasAssets.length ?? 0).toBe(1)
  evidence.openToPersistedInitialImageMs = performance.now() - firstOpenStarted
  const offsetsBeforeFirstGesture = JSON.stringify(readNode('image').meta.whiteboardState.sceneTransforms?.offsets ?? {})
  await firstGestureStroke('image')
  check('image entry: the first drag after opening draws and leaves the photo where it was', JSON.stringify(readNode('image').meta.whiteboardState.sceneTransforms?.offsets ?? {}) === offsetsBeforeFirstGesture)
  await action('undo').click()
  await expect.poll(() => readNode('image').meta.whiteboardState.strokes.length).toBe(0)
  check('inline editor replaces the image preview; only one Leafer instance', await page.locator('.leafer-app-view').count() === 1)
  const editorProbe = await proveProbe(editor, 'inline editor is actually mounted')
  const toolbar = editor.getByRole('toolbar')
  const centered = await toolbar.evaluate(el => { const node = el.closest('[data-nomi-inline-whiteboard]'); const a = el.getBoundingClientRect(), b = node.getBoundingClientRect(); return Math.abs(a.x + a.width / 2 - b.x - b.width / 2) < 2 })
  check('toolbar is centered against the whole frame', centered)
  check('complete direct editing toolbar remains available', await Promise.all(['select','brush','eraser','text','undo','redo','importImage','materials','layers','ratio','done'].map(name => action(name).count())).then(counts => counts.every(count => count === 1)))
  await action('materials').click()
  const panelProbe = await proveProbe(page.locator('[data-whiteboard-panel]'), 'materials panel actually opens')
  await expect(page.locator('[data-whiteboard-panel="materials"]')).toBeVisible()
  const popCenter = await page.locator('[data-whiteboard-panel="materials"]').evaluate(el => { const a = el.getBoundingClientRect(), b = document.querySelector('[data-nomi-inline-whiteboard] [role=toolbar]').getBoundingClientRect(); return Math.abs(a.x + a.width / 2 - b.x - b.width / 2) < 2 })
  check('expanded materials panel stays centered', popCenter)
  await page.keyboard.press('Escape')
  await expect(editor).toBeVisible()
  await expectAbsent(page.locator('[data-whiteboard-panel]'), { provenBy: panelProbe })
  await action('brush').click()
  await action('colors').click()
  const colorsPanel = page.locator('[data-whiteboard-panel="colors"]')
  check('all six original color presets are retained', await colorsPanel.getByRole('button').count() === 6)
  await colorsPanel.getByRole('button', { name: t('generationCommon.whiteboard.colorAria').replace('{{color}}','#ef4444'), exact: true }).click()
  await page.keyboard.press('Escape')
  const widthSlider = toolbar.getByRole('slider', { name: t('generationCommon.whiteboard.brushSize'), exact: true })
  await widthSlider.press('End')
  await expect(widthSlider).toHaveValue('96')
  await widthSlider.press('Home')
  await expect(widthSlider).toHaveValue('4')
  check('brush size keeps the full original range in the tool row', true)
  await stroke()
  check('chosen color and brush width reach the real stroke', readNode('image').meta.whiteboardState.strokes[0].color === '#ef4444' && readNode('image').meta.whiteboardState.strokes[0].size === 4)
  await page.keyboard.press('Delete')
  check('brush Delete cannot delete the outer node', Boolean(readNode('image')))
  check('brush commits a real persisted path', readNode('image').meta.whiteboardState.strokes.length > 0)
  await action('undo').click()
  await expect.poll(() => readNode('image').meta.whiteboardState.strokes.length).toBe(0)
  await action('redo').click()
  await expect.poll(() => readNode('image').meta.whiteboardState.strokes.length).toBe(1)
  check('undo and redo preserve the document', true)
  await action('eraser').click()
  const eraseFrame = await settledBox(editor, 'editor frame')
  await page.mouse.move(eraseFrame.x+eraseFrame.width*.45,eraseFrame.y+eraseFrame.height*.35)
  await page.mouse.down()
  await page.mouse.move(eraseFrame.x+eraseFrame.width*.45,eraseFrame.y+eraseFrame.height*.65,{steps:12})
  await page.mouse.up()
  await expect.poll(() => readNode('image').meta.whiteboardState.strokes.filter(item => item.tool==='eraser').length).toBe(1)
  await action('undo').click()
  await expect.poll(() => readNode('image').meta.whiteboardState.strokes.filter(item => item.tool==='eraser').length).toBe(0)
  check('eraser path persists and undo removes it (pixel erasure not asserted)',true)
  await action('text').click()
  let frame = await settledBox(editor, 'editor frame')
  await page.mouse.click(frame.x + frame.width * .3, frame.y + frame.height * .72)
  const textInput = toolbar.getByRole('textbox', { name: t('generationCommon.whiteboard.text'), exact: true })
  await textInput.fill('Revised title')
  await textInput.press('ArrowLeft')
  await expect.poll(() => readNode('image').meta.whiteboardState.texts?.[0]?.text).toBe('Revised title')
  check('text editing keeps native input keyboard behavior', true)
  const fontInput = toolbar.getByLabel(t('generationCommon.whiteboard.fontSize'), { exact: true })
  await fontInput.focus()
  await fontInput.press('ControlOrMeta+A')
  await fontInput.pressSequentially('36')
  await expect.poll(() => readNode('image').meta.whiteboardState.texts?.[0]?.fontSize).toBe(36)
  check('text size accepts ordinary sequential keyboard input', true)
  // A text object's bounds follow its content (review F2): long content used to keep the placeholder-sized box, so its visible tail could not be hit.
  const scene = () => readNode('image').meta.whiteboardState
  const textBefore = scene().texts[0]
  const longText = '这是一段用来检查点击范围的很长的中文文字'
  await textInput.fill(longText)
  await expect.poll(() => scene().texts[0].text).toBe(longText)
  const grown = scene().texts[0]
  check('text bounds are re-derived from the edited content', grown.width > textBefore.width * 1.5 && grown.height >= textBefore.height)
  check('edited text stays inside the exported board range', grown.x + grown.width <= scene().canvasDimensions.width && grown.y + grown.height <= scene().canvasDimensions.height)
  const stageBox = await settledBox(editor.getByLabel(t('generationCommon.whiteboard.drawingLayerAria'), { exact: true }), 'drawing layer')
  const toClient = (x, y) => ({ x: stageBox.x + x / scene().canvasDimensions.width * stageBox.width, y: stageBox.y + y / scene().canvasDimensions.height * stageBox.height })
  const textOffset = () => scene().sceneTransforms?.offsets?.[`text:${grown.id}`] ?? { x: 0, y: 0 }
  await action('select').click()
  const elsewhere = toClient(scene().canvasDimensions.width * .12, scene().canvasDimensions.height * .15)
  await page.mouse.click(elsewhere.x, elsewhere.y)
  await expect(textInput).toBeHidden()
  const tail = toClient(grown.x + textOffset().x + grown.width - 8, grown.y + textOffset().y + grown.height / 2)
  await page.mouse.click(tail.x, tail.y)
  await expect(textInput).toBeVisible()
  check('the visible tail of long text is hittable', (await textInput.inputValue()) === longText)
  await page.mouse.move(tail.x, tail.y)
  await page.mouse.down()
  await page.mouse.move(tail.x + 50, tail.y + 20, { steps: 12 })
  await page.mouse.up()
  await expect.poll(() => textOffset().x).toBeGreaterThan(20)
  check('dragging the tail moves the whole text, not the image below', scene().texts[0].x === grown.x)
  await textInput.fill('Short')
  await expect.poll(() => scene().texts[0].width).toBeLessThan(grown.width / 2)
  await action('undo').click()
  await expect.poll(() => scene().texts[0].text).toBe(longText)
  check('undo restores the long text with its derived bounds', scene().texts[0].width === grown.width)
  await action('redo').click()
  await expect.poll(() => scene().texts[0].text).toBe('Short')
  await textInput.fill(longText)
  await expect.poll(() => scene().texts[0].width).toBe(grown.width)
  check('editing back to the long content derives the same bounds', true)
  await action('select').click()
  frame = await settledBox(editor, 'editor frame')
  const positionBefore = readNode('image').position
  await page.mouse.move(frame.x + frame.width * .45, frame.y + frame.height * .3)
  await page.mouse.down()
  await page.mouse.move(frame.x + frame.width * .45 + 35, frame.y + frame.height * .3 + 18, { steps: 30 })
  await page.mouse.up()
  await expect.poll(() => Object.values(readNode('image').meta.whiteboardState.sceneTransforms?.offsets ?? {}).some(offset => Math.abs(offset.x) > 1)).toBe(true)
  check('image moves independently from the node frame', JSON.stringify(readNode('image').position) === JSON.stringify(positionBefore))
  if (performanceRun) {
    await page.evaluate(() => { window.__whiteboardPerf = { frames: [], longTasks: [], active: true }; let previous = performance.now(); const loop = now => { if (!window.__whiteboardPerf.active) return; window.__whiteboardPerf.frames.push(now - previous); previous = now; requestAnimationFrame(loop) }; requestAnimationFrame(loop); window.__whiteboardLongTasks = new PerformanceObserver(list => window.__whiteboardPerf.longTasks.push(...list.getEntries().map(item => item.duration))); window.__whiteboardLongTasks.observe({ entryTypes: ['longtask'] }) })
    for (let count = 0; count < 6; count++) {
      await page.mouse.move(frame.x + frame.width * .45 + 35, frame.y + frame.height * .3 + 18)
      await page.mouse.down()
      await page.mouse.move(frame.x + frame.width * .45 + (count % 2 ? 35 : 60), frame.y + frame.height * .3 + 30, { steps: 60 })
      await page.mouse.up()
    }
    evidence.performance = await page.evaluate(() => { const value = window.__whiteboardPerf; value.active = false; window.__whiteboardLongTasks.disconnect(); const sorted = value.frames.slice(2).sort((a,b) => a-b); return { frames: sorted.length, frameP50Ms: sorted[Math.floor(sorted.length*.5)], frameP95Ms: sorted[Math.floor(sorted.length*.95)], maxFrameMs: sorted.at(-1), longTasks: value.longTasks } })
    check('drag sampling collects actual animation frames', evidence.performance.frames >= 30 && Number.isFinite(evidence.performance.frameP95Ms))
    check('drag frame gap p95 remains within 33ms budget', evidence.performance.frameP95Ms <= 33)
    check('drag sampling has no long tasks above 50ms', evidence.performance.longTasks.length === 0)
    check('inactive nodes do not create extra editor instances', await page.locator('.leafer-app-view').count() === 1)
  }
  const sceneBeforeResize = readNode('image').meta.whiteboardState
  await action('ratio').click()
  const sizePanel = page.locator('[data-whiteboard-panel="ratio"]')
  const heightInput = sizePanel.getByLabel(t('generationCommon.whiteboard.height'), { exact: true })
  await heightInput.focus()
  await heightInput.press('ControlOrMeta+A')
  await heightInput.pressSequentially('900')
  await expect(heightInput).toHaveValue('900')
  check('canvas dimensions accept ordinary sequential keyboard input', true)
  await expect.poll(() => readNode('image').meta.whiteboardState.canvasDimensions.height).toBe(900)
  const resizedFrame = await settledBox(editor, 'resized editor frame')
  check('custom frame height changes independently of source image aspect', Math.abs(resizedFrame.height / resizedFrame.width - 900 / 1280) < .01)
  check('resizing the board range does not scale image or text objects', JSON.stringify(readNode('image').meta.whiteboardState.canvasAssets) === JSON.stringify(sceneBeforeResize.canvasAssets) && JSON.stringify(readNode('image').meta.whiteboardState.texts) === JSON.stringify(sceneBeforeResize.texts))
  await expect.poll(() => sizePanel.evaluate(el => { const a=el.getBoundingClientRect(), b=document.querySelector('[data-nomi-inline-whiteboard] [role=toolbar]').getBoundingClientRect(); return a.bottom <= b.top - 6 || a.top >= b.bottom + 6 })).toBe(true)
  check('resizing with the size panel open never overlaps its toolbar', true)
  await expectOverlayReachable(sizePanel, 'size controls remain clickable after frame resize')
  const assertMovingPanel = async label => {
    await expect.poll(() => sizePanel.evaluate(el => { const a=el.getBoundingClientRect(), b=document.querySelector('[data-nomi-inline-whiteboard] [role=toolbar]').getBoundingClientRect(); return (a.bottom <= b.top - 6 || a.top >= b.bottom + 6) && Math.abs(a.x+a.width/2-b.x-b.width/2)<2 })).toBe(true)
    await expectOverlayReachable(sizePanel, label)
    check(`${label}: clears bottom docks`, await sizePanel.evaluate(el => { const a=el.getBoundingClientRect(); return [...document.querySelectorAll('[data-canvas-bottom-dock]')].every(dock => { const b=dock.getBoundingClientRect(); return !b.width || !b.height || a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom }) }))
    check(label, true)
  }
  for (const [axis,value] of [['width',1536],['height',640],['width',1280],['height',1100],['height',900]]) {
    await sizePanel.getByLabel(t(axis === 'width' ? 'generationCommon.whiteboard.width' : 'generationCommon.whiteboard.height'), { exact: true }).fill(String(value))
    await expect.poll(() => readNode('image').meta.whiteboardState.canvasDimensions[axis]).toBe(value)
    await assertMovingPanel(`live ${axis}=${value}: centered, disjoint and reachable`)
  }
  for (const delta of [120,-120]) {
    const before = await page.locator('[data-canvas-zoom-percent]').innerText()
    await page.mouse.move(120,200)
    await page.mouse.wheel(0,delta)
    await expect.poll(() => page.locator('[data-canvas-zoom-percent]').innerText()).not.toBe(before)
    await assertMovingPanel(`live wheel ${delta}: centered, disjoint and reachable`)
  }
  await snap('size-panel-after-resize')
  await page.keyboard.press('Escape')
  await expect(editor).toBeVisible()
  await expectAbsent(page.locator('[data-whiteboard-panel]'), { provenBy: panelProbe })
  check('Escape from size input closes only the size panel', true)
  await snap('editing')
  const beforeSave = readNode('image').meta.whiteboardState
  await action('done').click()
  // Done on a drawn board exports and saves; until the picture lands the button itself says it is saving (no silent seconds).
  await expect(action('done'), 'Done shows that it is saving').toHaveAttribute('aria-busy', 'true')
  check('Done gives visible saving feedback while the picture is exported', true)
  await page.screenshot({ path: path.join(output, 'done-saving.png') }) // taken mid-save on purpose: a settled shot would only show the end state
  await expectAbsent(editor, { provenBy: editorProbe })
  await expect.poll(() => readNode('image').history?.length ?? 0).toBe(2)
  check('Done creates exactly one saved raster version', true)
  // Read the saved file from disk and decode it as a data URL: the app's custom scheme would taint a canvas.
  const savedFile = path.join(projectsDir, projectId, readNode('image').result.url.split(`/${projectId}/`)[1])
  const exportedTail = await page.evaluate(async ({ url, rect }) => {
    const image = new Image(); image.src = url; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
    const data = context.getImageData(Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)).data
    let count = 0
    for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - 239) < 7 && Math.abs(data[i + 1] - 68) < 7 && Math.abs(data[i + 2] - 68) < 7) count++
    return { count, width: image.naturalWidth, height: image.naturalHeight }
  }, { url: `data:image/png;base64,${fs.readFileSync(savedFile).toString('base64')}`, rect: { x: grown.x + textOffset().x + grown.width - 60, y: grown.y + textOffset().y, width: 60, height: grown.height } })
  check('the exported image contains the long text up to its last characters', exportedTail.count > 20 && exportedTail.width === scene().canvasDimensions.width)
  check('saved result retains custom board dimensions', readNode('image').meta.imageWidth === 1280 && readNode('image').meta.imageHeight === 900)
  await openImage()
  await expect.poll(() => JSON.stringify(readNode('image').meta.whiteboardState.texts)).toBe(JSON.stringify(beforeSave.texts))
  check('reopen restores text and transforms', JSON.stringify(readNode('image').meta.whiteboardState.sceneTransforms) === JSON.stringify(beforeSave.sceneTransforms))
  check('legacy annotation data is ignored and kept in the saved file', JSON.stringify(readNode('image').meta.whiteboardAnnotations) === JSON.stringify(legacyAnnotations) && await editor.getByLabel('Brighten this region').count() === 0)
  await action('done').click()
  await expectAbsent(editor, { provenBy: editorProbe })
  await expect.poll(() => readNode('image').history.length).toBe(2)
  check('unchanged reopen and Done does not duplicate result history', true)
  await canvasSetZoomPercent(page, 35)
  await node.locator('[data-version-badge]').click()
  await expect(page.locator('[data-version-grid="image"] [data-version-card]').first()).toBeVisible()
  check('existing version cards remain available', true)
  await snap('saved-history')
  await openImage()
  await stroke()
  const originalCard = page.locator('[data-version-grid="image"] [data-version-identity="original"]')
  await originalCard.hover()
  await originalCard.locator('[data-toolbar-action="set-primary"]').click()
  await expectAbsent(editor, { provenBy: editorProbe })
  await expect.poll(() => readNode('image').result.id).toBe('original')
  await expect.poll(() => readNode('image').history.length).toBe(3)
  check('switching a historical main image finishes the current board through the same save transaction', true)
  await page.keyboard.press('Escape')
  await canvasSetZoomPercent(page, 85)
  // An empty card opens only once it is selected: the first click selects it, the next one opens the editor.
  const launcher = page.locator('[data-node-id="board"] [data-testid="whiteboard-empty-action"]')
  await launcher.click()
  if (!await editor.isVisible()) await launcher.click()
  await expect(editor).toBeVisible()
  await firstGestureStroke('board')
  check('standalone entry: the first drag after opening draws a stroke', true)
  await editor.locator('input[type=file]').setInputFiles(imagePath)
  await expect.poll(() => readNode('board').meta?.whiteboardState?.canvasAssets.length ?? 0).toBe(1)
  check('standalone entry reuses the same editor and real import', true)
  check('standalone Done and capture remain inside the visible desktop stage', await editor.getByRole('toolbar').evaluate(el => { const a=el.getBoundingClientRect(), b=el.closest('.generation-canvas-v2__stage').getBoundingClientRect(); return a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom }))
  await action('capture').click()
  await expect.poll(() => readNode('board').history?.length ?? 0).toBe(1)
  await expect.poll(() => JSON.parse(fs.readFileSync(recordPath, 'utf8')).payload.generationCanvas.edges.length).toBe(1)
  check('standalone screenshot creates derived image with source edge', true)
  await snap('standalone')
  await action('done').click()
  await expectAbsent(editor, { provenBy: editorProbe })
  // What the creator sees after Done: the board node shows what was drawn, not the empty launcher (2026-10-22 escape).
  const boardNode = page.locator('[data-node-id="board"]')
  await expect(boardNode.locator('img').first(), 'after Done the board node shows its drawn content').toBeVisible()
  await expect(launcher, 'after Done a board with content no longer shows the empty launcher').toBeHidden()
  check('standalone Done leaves the drawn content visible on the board node', true)
  check('Done right after a screenshot adds no duplicate board version', readNode('board').history.length === 1)
  await snap('standalone-after-done')
  // Reopen from the picture: the same select-then-click as the empty launcher; an unchanged Done adds nothing.
  const boardPreview = boardNode.locator('[data-testid="whiteboard-open-preview"]')
  await boardPreview.click()
  if (!await editor.isVisible()) await boardPreview.click()
  await expect(editor).toBeVisible()
  check('the board reopens from its picture with the drawing intact', (readNode('board').meta.whiteboardState.strokes.length > 0) && readNode('board').meta.whiteboardState.canvasAssets.length === 1)
  await action('done').click()
  await expectAbsent(editor, { provenBy: editorProbe })
  check('an unchanged reopen and Done keeps one board version', readNode('board').history.length === 1)
  check('no renderer exceptions', errors.length === 0)
} catch (error) {
  evidence.error = String(error)
  await page.screenshot({ path: path.join(output, 'FAIL.png') })
  console.error((await page.locator('body').innerText()).slice(-2500))
  throw error
} finally {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ...evidence, rendererErrors: errors, generationInvokedByWalk: false }, null, 2))
  await run.close()
}

return { ...evidence, rendererErrors: errors }
}
