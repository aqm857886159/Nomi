import { expect } from './_assert.mjs'
import { installCompletionProbe, parseNomiJourneySelection } from './nomi-next-workflow-probe.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp, closeNomiApp } from './_launchApp.mjs'
import { backToLibrary, newProjectEntry } from './_shell.mjs'
import { ensureCreationResourceTree, openStoryboardEditor } from './_creationResourceTree.mjs'
import { createNomiUserWorkflowFixture } from './fixtures/nomi-user-workflow-fixture.mjs'
import { measureProjectOpen, assertFixtureUnchanged, projectCardSelector, redact } from './nomi-user-workflow-performance.e2e.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const onlyStoryboard = parseNomiJourneySelection(process.argv.slice(2))
const temp = makeTempDir('nomi-next-journeys-'), projectsDir = path.join(temp, 'projects'), settingsDir = path.join(temp, 'settings')
const out = path.join(root, 'docs/evidence/2026-10-10-nomi-user-performance/journeys', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`)
fs.mkdirSync(out, { recursive: true })
const logPath = path.join(temp, 'network.jsonl')
const a = createNomiUserWorkflowFixture({ projectsDir, scale: 'small', projectId: 'project-workflow-a' })
const b = createNomiUserWorkflowFixture({ projectsDir, scale: 'typical', projectId: 'project-workflow-b' })
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), buildReceipt: JSON.parse(fs.readFileSync(path.join(root, 'dist/build-stamp.json'), 'utf8')),
  source: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) },
  sourceHashes: Object.fromEntries(['tests/ux/nomi-next-workflow-journeys.e2e.mjs', 'tests/ux/nomi-next-workflow-probe.mjs', 'tests/ux/fixtures/nomi-user-workflow-fixture.mjs'].map((file) => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])),
  selectedActions: onlyStoryboard ? 'Two storyboard switches only; real project opening is prerequisite setup, not a measured action' : 'Full ten-action functional batch',
  scope: 'One isolated Linux/Xvfb functional batch; atomic completion diagnostics, not full P/D/B/C/A/R, fixed1+5 or acceptance. No planned combination counted as execution.', fixtures: [a.summary, b.summary], actions: [], performanceAcceptance: 'unverified' }
let instance, failure

async function action(id, triggerSelector, conditions, input) {
  const entry = { id, implemented: true, executed: false, functionalPassed: false, performanceAcceptance: 'unverified', completionConditions: conditions }
  report.actions.push(entry)
  const expected = await instance.win.evaluate(installCompletionProbe, { id: randomUUID(), triggerSelector, conditions })
  try {
    await input()
    await instance.win.evaluate(({ expected }) => new Promise((resolve, reject) => {
      let raf
      const timer = setTimeout(() => { cancelAnimationFrame(raf); reject(new Error('UI completion diagnostic timeout')) }, 15000)
      const poll = () => {
        const state = window.__nomiCompletion
        if (!state || state.id !== expected.id || state.documentId !== expected.documentId) { clearTimeout(timer); reject(new Error('completion probe replaced')); return }
        if (Number.isFinite(state.completedAt)) { clearTimeout(timer); resolve(); return }
        raf = requestAnimationFrame(poll)
      }
      poll()
    }), { expected })
    entry.raw = await instance.win.evaluate(() => window.__nomiCompletion.stop())
    assert.ok(Number.isFinite(entry.raw.inputAt) && entry.raw.completedAt >= entry.raw.inputAt)
    entry.inputToCompletionDiagnosticMs = entry.raw.completedAt - entry.raw.inputAt
    entry.executed = true; entry.functionalPassed = true
    entry.screenshot = path.join(out, `${id}-${randomUUID()}.png`)
    await instance.win.screenshot({ path: entry.screenshot })
    return entry
  } catch (error) {
    entry.reason = error.message; entry.raw = await instance.win.evaluate(() => window.__nomiCompletion?.stop()).catch(() => null)
    entry.conditionSnapshot = await instance.win.evaluate((conditions) => conditions.map(({ selector, attribute }) => {
      const el = document.querySelector(selector)
      return { selector, count: document.querySelectorAll(selector).length, text: el?.textContent?.slice(0, 500), attribute: attribute ? el?.getAttribute(attribute) : null, visible: el?.checkVisibility({ opacityProperty: true, visibilityProperty: true }), box: el?.getBoundingClientRect().toJSON() }
    }), conditions).catch(() => null)
    entry.screenshot = path.join(out, `failed-${id}-${randomUUID()}.png`); await instance.win.screenshot({ path: entry.screenshot }).catch(() => {})
    throw error
  }
}
async function atomicOpen(id, fixture, triggerSelector) {
  const entry = { id, implemented: true, executed: false, functionalPassed: false, performanceAcceptance: 'unverified' }; report.actions.push(entry)
  try { entry.sample = await measureProjectOpen(instance, fixture, { triggerSelector }); entry.executed = true; entry.functionalPassed = true; entry.sample.screenshot = path.join(out, `${id}-${randomUUID()}.png`); await instance.win.screenshot({ path: entry.sample.screenshot }) }
  catch (error) { entry.reason = error.message; entry.invalidProbe = error.probeState; throw error }
}
try {
  instance = await launchNomiApp({ name: 'nomi-next-workflow-journeys', tempRoot: temp, settingsDir, projectsDir, settleMs: 0,
    mainRequire: [path.join(root, 'scripts/walkthrough-network-guard.cjs')], env: { NOMI_WALK_NET_LOG: logPath, NOMI_WALK_ALLOW_ORIGINS: '', NOMI_WALK_URL_REDIRECTS: '[]' } })
  const { win } = instance
  await win.locator(projectCardSelector(a.record)).waitFor({ state: 'visible' })
  if (onlyStoryboard) {
    await win.locator(projectCardSelector(a.record)).click()
    await expect(win.locator('.generation-canvas-v2__stage[data-ready="true"]')).toBeVisible()
    await expect(win.locator('[data-shell-project-menu]')).toContainText(a.record.name)
    report.prerequisiteProjectOpened = a.record.id
  } else {
  await atomicOpen('project.open-small', a)
  await win.locator('[data-shell-project-menu]').click()
  await atomicOpen('project.switch-to-typical', b, `[data-menu-item="project:${b.record.id}"]`)
  await win.locator('[data-shell-project-menu]').click()
  await atomicOpen('project.switch-back-small', a, `[data-menu-item="project:${a.record.id}"]`)
  }
  await win.locator('[data-shell-topbar] [data-mode="creation"]').click()
  await ensureCreationResourceTree(win, 'workflow batch documents')
  const docs = a.record.payload.workbenchDocuments, plans = a.record.payload.storyboardDesignsByDocumentId[docs[0].id]
  await expect(win.locator('[data-document-row]')).toHaveCount(docs.length)
  for (const doc of onlyStoryboard ? [] : [docs[1], docs[0]]) {
    const selector = `[data-document-row="${doc.id}"] [data-document-id]`
    await action(`document.switch-${doc.id}`, selector, [{ selector: `${selector}[data-active="true"]` }, { selector: '.tiptap[contenteditable="true"]', text: doc.contentJson.content[0].content[0].text }], () => win.locator(selector).click())
    await expect(win.locator('.tiptap[contenteditable="true"]')).toContainText(doc.contentJson.content[0].content[0].text)
  }
  for (const plan of plans) {
    await ensureCreationResourceTree(win, 'workflow batch competing plans')
    const targetPrompt = plan.plan.shots[0].prompt
    const foreignPrompts = plans.filter((other) => other.id !== plan.id).flatMap((other) => other.plan.shots.map((shot) => shot.prompt))
    const entry = await action(`storyboard.switch-${plan.id}`, `[data-storyboard-id="${plan.id}"]`, [
      { selector: '[data-storyboard-id][data-active="true"]', attribute: 'data-storyboard-id', value: plan.id },
      { selector: '.workbench-storyboard', text: targetPrompt, textNot: foreignPrompts },
    ], () => openStoryboardEditor(win, plan.id, 'workflow competing design'))
    const selected = win.locator('[data-storyboard-id][data-active="true"]')
    await expect(selected).toHaveCount(1)
    await expect(selected).toHaveAttribute('data-storyboard-id', plan.id)
    await expect(win.locator('.workbench-storyboard')).toContainText(targetPrompt)
    for (const stale of foreignPrompts) await expect(win.locator('.workbench-storyboard')).not.toContainText(stale)
    entry.selectionReceipt = { selectedDesignId: await selected.getAttribute('data-storyboard-id'), targetShotId: plan.plan.shots[0].shotId, targetPrompt, excludedForeignPrompts: foreignPrompts }
  }
  if (!onlyStoryboard) {
  await win.locator('[data-shell-topbar] [data-mode="generation"]').click()
  if (await win.locator('[data-shell-rail-item="docs"][aria-pressed="true"]').isVisible()) await win.locator('[data-shell-rail-item="docs"]').click()
  const group = a.record.payload.generationCanvas.groups[0]
  const groupBox = win.locator(`[data-group-id="${group.id}"]`).first()
  const point = await groupBox.evaluate((box) => {
    const rect = box.getBoundingClientRect()
    for (let y = Math.max(0, rect.top) + 12; y < Math.min(innerHeight, rect.bottom) - 12; y += 10) for (let x = Math.max(0, rect.left) + 12; x < Math.min(innerWidth, rect.right) - 12; x += 10) {
      const target = document.elementFromPoint(x, y)
      if (target?.closest('[data-group-id]') === box && !target.closest('[data-node-id]')) return { x: x - rect.left, y: y - rect.top }
    }
    return null
  })
  assert.ok(point, 'Visible mixed-media group has a real blank selection target')
  await action('group.select-mixed-media', `[data-group-id="${group.id}"]`, [{ selector: '[data-group-toolbar="true"]' }, { selector: `[data-group-id="${group.id}"][data-frame-selected="true"]` }], () => groupBox.click({ position: point }))
  await win.locator('[data-toolbar-action-menu="group-arrange"]').click()
  const movedNode = group.nodeIds[1]
  const movedSelector = `.react-flow__node[data-id="${movedNode}"]`
  const previousStyle = await win.locator(movedSelector).getAttribute('style')
  await action('group.arrange-grid', '[data-menu-item="group-arrange-grid"]', [{ selector: movedSelector, attribute: 'style', valueNot: previousStyle }], () => win.locator('[data-menu-item="group-arrange-grid"]').click())
  await backToLibrary(win)
  await action('project.create', null, [{ selector: '.tiptap[contenteditable="true"]' }], () => newProjectEntry(win).click())
  const projectId = await win.evaluate(() => new URLSearchParams(location.hash.split('?')[1] || '').get('projectId'))
  assert.ok(projectId && ![a.record.id, b.record.id].includes(projectId))
  const created = (await win.evaluate(() => window.nomiDesktop.projects.listAsync())).find((project) => project.id === projectId)
  assert.ok(created?.rootPath && !path.relative(projectsDir, created.rootPath).startsWith('..'))
  report.createdProject = { id: projectId, rootPath: created.rootPath }
  await backToLibrary(win)
  await closeNomiApp(instance.app); instance = null
  assertFixtureUnchanged(a); assertFixtureUnchanged(b)
  const arranged = JSON.parse(fs.readFileSync(path.join(a.projectRoot, '.nomi/project.json'), 'utf8')).payload.generationCanvas.nodes
  const before = a.record.payload.generationCanvas.nodes
  assert.ok(group.nodeIds.some((id) => JSON.stringify(arranged.find((node) => node.id === id)?.position) !== JSON.stringify(before.find((node) => node.id === id)?.position)), 'Grid arrangement must persist a real member position change')
  for (const node of before.filter((node) => !group.nodeIds.includes(node.id))) assert.deepEqual(arranged.find((entry) => entry.id === node.id)?.position, node.position)
  report.groupLayoutPersisted = { changedMemberPositions: true, outsideGroupPositionsUnchanged: true }
  const createdRecord = JSON.parse(fs.readFileSync(path.join(created.rootPath, '.nomi/project.json'), 'utf8'))
  assert.equal(createdRecord.id, projectId); assert.ok(createdRecord.payload.workbenchDocuments.length >= 1)
  report.persistedDomainContentUnchanged = true
  report.createdPersistedDocumentCount = createdRecord.payload.workbenchDocuments.length
  } else {
    await backToLibrary(win)
    await closeNomiApp(instance.app); instance = null
    assertFixtureUnchanged(a); assertFixtureUnchanged(b)
    report.persistedDomainContentUnchanged = true
  }
  const savedPlans = JSON.parse(fs.readFileSync(path.join(a.projectRoot, '.nomi/project.json'), 'utf8')).payload.storyboardDesignsByDocumentId[docs[0].id]
  assert.deepEqual(savedPlans.map(({ id, plan }) => ({ id, shots: plan.shots })), plans.map(({ id, plan }) => ({ id, shots: plan.shots })), 'Both competing designs and every shot identity/content must persist unchanged')
  report.storyboardContentPersisted = savedPlans.map(({ id, plan }) => ({ designId: id, firstShotId: plan.shots[0].shotId, firstPrompt: plan.shots[0].prompt, allShotsUnchanged: true }))
  const entries = fs.readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line)), loaded = entries.find((entry) => entry.kind === 'guard-loaded')
  assert.ok(['fetch', 'http', 'https', 'socket', 'chromium'].every((layer) => loaded?.layers?.includes(layer)))
  assert.ok(!entries.some((entry) => entry.kind === 'guard-error' || entry.kind === 'blocked'))
  report.guard = { layers: loaded.layers, blockedAttempts: 0 }
} catch (error) { failure = error; report.failure = error.message; process.exitCode = 1 }
finally {
  if (instance) await closeNomiApp(instance.app)
  const output = path.join(out, 'receipt.json'); fs.writeFileSync(output, JSON.stringify(redact(report), null, 2), { flag: 'wx' }); console.log(JSON.stringify({ output, actions: report.actions.map(({ id, executed, functionalPassed, reason }) => ({ id, executed, functionalPassed, reason })), failure: failure?.message }))
}
