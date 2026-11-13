// Real isolated App: retain the approved controls at minimum size, then exclude two shots before any POST.
import fs from 'node:fs'
import path from 'node:path'
import { createRuntimeWalk, readProject } from './agent-runtime-walk-support.mjs'
import { FIXTURE_APIMART_MODEL, FIXTURE_APIMART_VENDOR } from './agent-runtime-fixture.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { collapseAgentPanel } from './_shell.mjs'
import { expect, screenshotSettled } from './_assert.mjs'
import { uiText, uiTextWith } from './full-walk/invariants.mjs'

const walk = await createRuntimeWalk('storyboard-confirm-selection', { generationProvider: 'apimart', trustFixtureOrigin: true })
const designId = 'storyboard-selection-contract'
let failure
try {
  const { win } = await walk.start({ first: true })
  await win.evaluate(() => localStorage.setItem('__nomiE2E', '1'))
  await win.reload()
  const { projectId } = await walk.newProject()
  const documentId = (await readProject(win, projectId)).payload.workbenchDocuments[0].id
  const shots = [1, 2, 3, 4].map(index => ({ index, shotId: `selection-shot-${index}`, shotKind: 'image',
    durationSec: 3, anchorIds: [], prompt: `A bookshop window, shot ${index}`,
    modelKey: FIXTURE_APIMART_MODEL, modelVendor: FIXTURE_APIMART_VENDOR }))
  await expect.poll(() => win.evaluate(() => typeof window.__nomiCapabilityApply)).toBe('function')
  const saved = await win.evaluate(({ projectId, documentId, designId, shots }) =>
    window.__nomiCapabilityApply('storyboard.upsert-design', { projectId, documentId, designId,
      initiator: 'agent', plan: { title: 'Bookshop', anchors: [], shots } }), { projectId, documentId, designId, shots })
  expect(saved).toMatchObject({ status: 'saved', designId })
  await expect.poll(async () => Object.values((await readProject(win, projectId)).payload.storyboardDesignsByDocumentId)
    .flat().find(design => design.id === designId)?.plan.shots.length).toBe(4)
  await walk.resizeWindow(1100, 720)
  const folder = path.resolve('tests/ux/shots/storyboard-only-what-works')
  fs.mkdirSync(folder, { recursive: true })
  for (const locale of ['zh-CN', 'en']) for (const scheme of ['light', 'dark']) {
    await win.evaluate(({ locale, scheme }) => {
      localStorage.setItem('nomi:locale:v1', locale)
      localStorage.setItem('nomi-color-scheme', scheme)
    }, { locale, scheme })
    await win.reload()
    await openStoryboardEditor(win, designId, 'Open original storyboard after settings reload')
    await collapseAgentPanel(win, 'Minimum-window storyboard')
    await expect(win.locator('html')).toHaveAttribute('data-mantine-color-scheme', scheme)
    const editor = win.locator('[data-storyboard-editor]:visible')
    for (const index of [1, 2, 3]) await editor.getByRole('checkbox', {
      name: uiTextWith(locale, 'storyboardEditor.selection.rowAria', { index }), exact: true,
    }).check()
    await editor.locator('[data-storyboard-scroll]').evaluate(element => { element.scrollTop = 0 })
    const film = editor.locator('[data-storyboard-aspect-default]')
    const toolbar = editor.locator('[data-storyboard-selection-toolbar]')
    await expect(film).toBeVisible()
    await expect(toolbar).toBeVisible()
    for (const control of [film, toolbar]) {
      const box = await control.boundingBox()
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(1100)
      expect(box.y + box.height).toBeLessThanOrEqual(720)
    }
    const screenshot = path.join(folder, `${locale}-${scheme}-app-minimum.png`)
    await screenshotSettled(win, { path: screenshot })
    walk.report.screenshots.push(screenshot)
  }
  const editor = win.locator('[data-storyboard-editor]:visible')
  await editor.locator('[data-storyboard-batch]').click()
  const dialog = win.locator('[data-spend-confirm-dialog]')
  await expect(dialog).toBeVisible()
  const checkboxes = dialog.locator('[data-v4-block="plan-rows"] input[type="checkbox"]')
  await expect(checkboxes).toHaveCount(4)
  expect(walk.fixture.images).toHaveLength(0)
  await checkboxes.nth(0).uncheck()
  await checkboxes.nth(1).uncheck()
  await dialog.locator('[data-spend-confirm-action="confirm"]').click()
  await expect.poll(() => walk.fixture.images.length, { message: 'Four candidates minus two exclusions must send exactly two POSTs' }).toBe(2)
  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes
    .filter(node => node.meta?.storyboardDesignId === designId && node.result?.url).length).toBe(2)
  const nodes = (await readProject(win, projectId)).payload.generationCanvas.nodes
    .filter(node => node.meta?.storyboardDesignId === designId && node.result?.url)
  expect(nodes.map(node => node.meta.shotId).sort()).toEqual(['selection-shot-3', 'selection-shot-4'])
  expect(walk.fixture.images).toHaveLength(2)
  walk.report.selection = { candidates: 4, excluded: 2, posts: 2, generatedShotIds: nodes.map(node => node.meta.shotId).sort() }
  const firstRow = editor.locator('[data-storyboard-row="1"]')
  const model = firstRow.getByRole('button', { name: uiText('en', 'generationCommon.parameters.model'), exact: true })
  const imageSummary = await firstRow.locator('[data-parameter-summary]').innerText()
  await model.click()
  await win.getByRole('option', { name: /Seedance 2\.0/ }).first().click()
  await expect(firstRow.locator('[data-storyboard-composer-params="video"]')).toBeVisible()
  expect(await firstRow.locator('[data-parameter-summary]').innerText()).not.toBe(imageSummary)
  await firstRow.getByRole('button', { name: uiTextWith('en', 'storyboardEditor.frame.generateAria', { index: 1 }), exact: true }).click()
  await expect.poll(() => walk.fixture.videos.length, { message: 'An image row explicitly switched to a video model must issue one video POST' }).toBe(1)
  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes
    .find(node => node.meta?.storyboardDesignId === designId && node.meta?.shotId === 'selection-shot-1')?.result?.type).toBe('video')
  expect(walk.fixture.images).toHaveLength(2)
  await model.click()
  await win.getByRole('option').first().click()
  await expect.poll(async () => Object.values((await readProject(win, projectId)).payload.storyboardDesignsByDocumentId)
    .flat().find(design => design.id === designId)?.plan.shots[0].shotKind).toBe('video')
  walk.report.crossKind = { imagePosts: 2, videoPosts: 1, defaultPreservesKind: true }
} catch (error) { failure = error; process.exitCode = 1 }
finally { await walk.finish(failure, { unscriptedFixture: true }) }
