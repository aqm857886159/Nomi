// Editable drafts through real UI → autosave → disk → app restart. No model/key/provider is used.
// Run under the gates lock; local handoffs set NOMI_SAVE_DRAFT_OUT to their own artifact directory.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { leaveProjectIfOpen } from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'

const out = process.env.NOMI_SAVE_DRAFT_OUT ?? path.join(repoRoot, 'tests/ux/shots/project-save-draft-contract', String(Date.now()))
assert.ok(out && path.isAbsolute(out), 'NOMI_SAVE_DRAFT_OUT must be an absolute isolated artifact directory')
fs.mkdirSync(out, { recursive: true })
function launchConditions() {
  if (process.platform !== 'darwin') return
  const front = execFileSync('lsappinfo', ['front'], { encoding: 'utf8' }).trim()
  const info = execFileSync('lsappinfo', ['info', front], { encoding: 'utf8' })
  assert.ok(!/Claude/i.test(info), 'frontmost app is Claude; do not launch')
  assert.ok(os.loadavg()[1] < 10, `five-minute load ${os.loadavg()[1]} must be below 10`)
}
const ID = 'draft-save-walk', DOC = 'draft-doc', DESIGN = 'draft-design'
const observations = []
for (const locale of ['zh-CN', 'en']) {
  const root = path.join(out, locale)
  fs.mkdirSync(root, { recursive: true })
  const busyMarker = path.join(root, 'busy-arm')
  const hook = path.join(root, 'busy-fixture.cjs')
  fs.writeFileSync(hook, `const fs = require('node:fs'); const original = fs.renameSync; const marker = ${JSON.stringify(busyMarker)};
fs.renameSync = function(from, to) {
  if (String(to).endsWith('/.nomi/project.json') && fs.existsSync(marker)) {
    const left = Number(fs.readFileSync(marker, 'utf8'));
    if (left > 0) { fs.writeFileSync(marker, String(left - 1)); throw Object.assign(new Error('isolated busy fixture'), { code: 'EBUSY', errno: -16, syscall: 'rename' }); }
  }
  return original.apply(this, arguments);
};\n`)
  const options = { name: `project-save-draft-${locale}`, userDataDir: path.join(root, 'user-data'), settingsDir: path.join(root, 'settings'), projectsDir: path.join(root, 'projects'), mainRequire: [path.join(repoRoot, 'scripts/walkthrough-network-guard.cjs'), hook],
    initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' },
    env: { NOMI_TEST_NETWORK_GUARD: '1', NOMI_WALK_NET_LOG: path.join(root, 'network.jsonl') },
  }
  const text = key => uiText(locale, key)
  let current
  let manifest
  const read = () => JSON.parse(fs.readFileSync(manifest, 'utf8'))
  const savedPlan = () => read().payload.storyboardDesignsByDocumentId[DOC][0].plan
  let launchNumber = 0
  const start = async () => { launchConditions(); current = await launchNomiApp({ ...options, tempRoot: path.join(root, `launcher-${++launchNumber}`) }); return current.win }
  const open = async () => {
    const win = current.win
    await leaveProjectIfOpen(win)
    await win.getByText('Draft save contract', { exact: true }).first().click()
    await openStoryboardEditor(win, DESIGN, 'editable draft persistence')
    await expect(win.locator('[data-storyboard-editor="true"]')).toBeVisible()
    return win
  }
  const snapshot = async name => { await current.win.screenshot({ path: path.join(root, `${name}.png`) }) }
  try {
    let win = await start()
    const record = await win.evaluate(({ ID, DOC, DESIGN }) => window.nomiDesktop.projects.create({
      id: ID, name: 'Draft save contract', version: 1, createdAt: 1, updatedAt: 1,
      payload: { workbenchDocuments: [{ id: DOC, version: 1, title: 'Draft', updatedAt: 1, contentJson: { type: 'doc', content: [] } }], activeDocumentId: DOC,
        timeline: null, generationCanvas: { nodes: [], edges: [], groups: [], selectedNodeIds: [] },
        storyboardDesignsByDocumentId: { [DOC]: [{ id: DESIGN, documentId: DOC, title: 'Draft', plan: { title: 'Draft', anchors: [], aspectRatio: '16:9', shots: [{ index: 1, durationSec: 5, shotKind: 'video', prompt: 'Draft shot', anchorIds: [] }] }, committed: false, status: 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1 }] },
      },
    }), { ID, DOC, DESIGN })
    const diskRoot = await win.evaluate(id => window.nomiDesktop.projects.read(id).lastKnownRootPath, record.id)
    manifest = path.join(diskRoot, '.nomi', 'project.json')
    assert.ok(path.resolve(manifest).startsWith(path.resolve(root) + path.sep), 'all writes stay inside the isolated profile')
    await win.reload()
    await open()
    await snapshot('00-existing-editor')
    await win.getByRole('button', { name: text('storyboardEditor.addAnchor'), exact: true }).click()
    await expect.poll(() => savedPlan().anchors.length, { timeout: stationTimeout() }).toBe(1)
    await win.locator('[data-storyboard-anchors-toggle]').click()
    const name = win.getByRole('textbox', { name: text('storyboardEditor.anchor.nameAria'), exact: true })
    await expect(name).toHaveValue('')
    await expect(name).toHaveClass(/border-workbench-danger/)
    observations.push({ locale, phase: 'unnamed-autosave', alertCount: await win.getByRole('alert').count() })
    await snapshot('01-unnamed-autosaved')
    await name.fill('Named draft')
    await expect.poll(() => savedPlan().anchors[0].name).toBe('Named draft')
    await name.fill('')
    await expect.poll(() => savedPlan().anchors[0].name).toBe('')
    const aspect = win.locator('[data-storyboard-aspect-default]')
    await aspect.getByRole('button').click()
    await win.getByRole('option', { name: '16:9', exact: true }).click()
    await aspect.getByRole('button').click()
    await win.getByRole('option', { name: text('storyboardEditor.bulk.aspectDefault'), exact: true }).click()
    await expect.poll(() => savedPlan().aspectRatio).toBe('')
    await snapshot('02-default-aspect-saved')
    // The existing batch admission stays blocked and keeps the exact empty-name row red.
    const batch = win.locator('[data-storyboard-batch]')
    observations.push({ locale, batchDisabled: await batch.isDisabled(), singleAnchorPolicy: 'unchanged; outside this repair' })
    if (!(await batch.isDisabled())) await batch.click()
    await expect(name).toHaveClass(/border-workbench-danger/)
    await win.locator('[data-storyboard-anchor-row]').first().locator('[data-storyboard-generate-state]').first().click()
    await expect(win.locator('[data-anchor-face="failed"], [data-storyboard-action-feedback]').first()).toBeVisible({ timeout: stationTimeout() })
    await expect(name).toHaveClass(/border-workbench-danger/)
    await expect(win.locator('[data-storyboard-editor] footer')).toContainText(text('storyboardEditor.issue.anchorNoName'))
    observations.push({ locale, emptyNameGenerationClick: true, nameHintVisible: true, generationAdmission: 'unverified: no configured model; unchanged policy' })
    await snapshot('03-generation-name-required')
    // Graceful full application close and reopening the same isolated profile.
    await current.close(); current = null
    win = await start(); await open()
    await win.locator('[data-storyboard-anchors-toggle]').click()
    await expect(win.getByRole('textbox', { name: text('storyboardEditor.anchor.nameAria'), exact: true })).toHaveValue('')
    await expect(win.locator('[data-storyboard-aspect-default]')).toHaveAttribute('data-storyboard-aspect-default', 'model-default')
    await snapshot('04-graceful-reopen')
    // Save another real edit, then force only this run's own process after the required two-second wait.
    await win.getByRole('textbox', { name: text('storyboardEditor.anchor.descriptionAria'), exact: true }).fill('Draft survives restart')
    await expect.poll(() => savedPlan().anchors[0].description).toBe('Draft survives restart')
    const pause = win.waitForEvent('close')
    // Fixed two seconds is the contract's durability probe, not a UI readiness wait.
    await new Promise(resolve => setTimeout(resolve, 2000))
    current.app.process().kill('SIGKILL')
    await pause
    await current.close(); current = null
    win = await start(); await open()
    await win.locator('[data-storyboard-anchors-toggle]').click()
    await expect(win.getByRole('textbox', { name: text('storyboardEditor.anchor.descriptionAria'), exact: true })).toHaveValue('Draft survives restart')
    await snapshot('05-forced-restart')
    fs.writeFileSync(busyMarker, '6')
    await win.getByRole('textbox', { name: text('storyboardEditor.anchor.descriptionAria'), exact: true }).fill('Busy save remains in window')
    await expect(win.getByRole('alert')).toHaveText(text('studio.projectSaveInUse'), { timeout: stationTimeout() })
    await snapshot('06-ebusy-reason')
    const alertProof = await proveProbe(win.getByRole('alert'), 'typed EBUSY save failure is visible')
    if (fs.existsSync(busyMarker)) fs.unlinkSync(busyMarker)
    await current.close(); current = null
    win = await start(); await open()
    await expectAbsent(win.getByRole('alert'), { provenBy: alertProof, message: 'draft saves and reopens without a save warning' })
    await snapshot('07-no-save-warning')
    observations.push({ locale, savedUnnamed: true, defaultAspect: true, gracefulReopen: true, forcedReopen: true, busyMessage: text('studio.projectSaveInUse') })
  } finally {
    if (fs.existsSync(busyMarker)) fs.unlinkSync(busyMarker)
    if (current) await current.close()
    fs.writeFileSync(path.join(out, 'observations.json'), JSON.stringify(observations, null, 2))
  }
}
console.log('PASS project-save-draft-contract zh-CN/en: editable draft saves, restarts and EBUSY wording')
