// Original sidebar -> original editor -> project IPC/disk -> a new Electron process.
// Only vendor services are loopback; no plan/store write is injected after launch.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { require as tsxRequire } from 'tsx/cjs/api'
import { expect } from '@playwright/test'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { createAgentRuntimeFixture } from './agent-runtime-fixture.mjs'
import { expectAbsent, proveProbe } from './_assert.mjs'

const { createWorkspaceProject } = tsxRequire('../../electron/workspace/workspaceRepository.ts', import.meta.url)
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-blank-storyboard-'))
const settingsDir = path.join(tempRoot, 'settings'), projectsDir = path.join(tempRoot, 'projects')
const outputDir = process.env.NOMI_BLANK_PLAN_EVIDENCE_DIR || path.join(tempRoot, 'evidence')
fs.mkdirSync(outputDir, { recursive: true })
fs.mkdirSync(settingsDir, { recursive: true })
const fixture = await createAgentRuntimeFixture({ rootDir: repoRoot, settingsDir })
const projectId = 'blank-storyboard', projectRoot = path.join(projectsDir, projectId)
const documents = ['document-a', 'document-b'].map(id => ({ id, version: 1, title: id, updatedAt: 1,
  contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Keep original ${id}` }] }] } }))
createWorkspaceProject({ rootPath: projectRoot, record: { id: projectId, name: 'Blank storyboard acceptance', payload: {
  workbenchDocuments: documents, activeDocumentId: documents[0].id, timeline: null,
  storyboardDesignsByDocumentId: {},
  generationCanvas: { nodes: [], edges: [], groups: [], selectedNodeIds: [], canvasZoom: 1, canvasPan: { x: 0, y: 0 } },
} } }, { settingsRoot: settingsDir, defaultProjectsRoot: projectsDir })
const options = { name: 'blank-storyboard', tempRoot, settingsDir, projectsDir, userDataDir: path.join(tempRoot, 'user-data'),
  initialLocalStorage: { 'nomi:locale:v1': 'zh-CN', '__nomiE2E': '1', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' } }
const report = { status: 'running', boundary: 'built Electron, original sidebar/editor/IPC/disk; isolated loopback vendor; no paid calls',
  buildStamp: JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist/build-stamp.json'), 'utf8')), tempRoot, checks: [], screenshots: [], launches: [], limitations: ['Windows and installed package unverified'] }
const disk = () => JSON.parse(fs.readFileSync(path.join(projectRoot, '.nomi/project.json'), 'utf8')).payload
const savedPlans = () => Object.values(disk().storyboardDesignsByDocumentId ?? {}).flat()
let gui, win
/** 「底栏那条红」的探针基线：上一轮真的看见过它，下一轮的「没看见」才算数。 */
let issuesProof = null
const editor = () => win.locator('[data-storyboard-editor="true"]:visible')
async function start() {
  gui = await launchNomiApp(options); win = gui.win
  win.setDefaultTimeout(stationTimeout({ operations: 1 }))
  assert(win.url().startsWith('file:'), 'Use built renderer, not a component harness')
  report.launches.push(await gui.app.evaluate(() => ({ pid: process.pid, electron: process.versions.electron, chromium: process.versions.chrome, platform: process.platform })))
  if (!win.url().includes(`projectId=${projectId}`)) await win.locator('[data-project-card]', { hasText: 'Blank storyboard acceptance' }).click()
  await win.getByRole('button', { name: /^(创作|Create)$/ }).click()
}
async function expandSidebar() {
  await expect(win.locator('[data-creation-resource-tree-toggle]:visible')).toBeVisible()
  const expand = win.locator('[data-creation-resource-tree-toggle="expand"]:visible')
  if (await expand.isVisible()) await expand.click()
}
async function screenshot(name) {
  const file = path.join(outputDir, `${name}.png`)
  await win.screenshot({ path: file }); report.screenshots.push(file)
}
function assertNoExecution() {
  assert.equal(fixture.requests.length, 0, 'Manual creation/edit/reopen must not request an LLM')
  assert.equal(fixture.images.length, 0, 'Manual creation/edit/reopen must not generate media')
  fixture.assertClean()
  const graph = disk().generationCanvas
  // 2026-10-08 用户：「我们经常莫名其妙生成分镜表，这个可以删掉吧」——写方案不再往画布放任何节点（含分镜表）。
  assert.equal(graph.nodes.length, 0, 'Authoring a plan adds no canvas node: no table view, no image/video/execution node')
  assert.deepEqual(graph.edges, [])
  assert.deepEqual(disk().workbenchDocuments, documents, 'Source documents must stay unchanged')
}
try {
  await start()
  const expected = []
  for (const document of documents) {
    for (let index = 1; index <= 2; index++) {
      await expandSidebar()
      // Keep the other document active when creating B: target comes from the clicked button.
      const count = expected.length
      await win.locator(`[data-add-storyboard="${document.id}"]`).click()
      await expect.poll(() => savedPlans().length, { message: 'Original New Storyboard button must append a local blank plan' }).toBe(count + 1)
      await expect(editor()).toBeVisible()
      await expect(editor().locator('header input')).toHaveValue('')
      await expect(editor().locator('[data-storyboard-row]')).toHaveCount(2)
      const prompt = editor().locator('[data-storyboard-row="1"] [data-storyboard-prompt-block] [contenteditable="true"]').first()
      await expect(prompt).toHaveText('')
      const blank = savedPlans().find(plan => !expected.some(previous => previous.id === plan.id))
      assert.equal(blank.documentId, document.id)
      // 2026-09-21：一个字都还没写的空白起手式**不报错**。那两条「提示词为空」说的是真的，
      // 但此刻它们不是「你做错了」，是「你还没开始」——在用户动手之前先给一片红，是把起点说成了失败。
      // 基线由**上一轮**给：写了第 1 镜、第 2 镜还空着时那条红真的浮出来过（proveProbe），
      // 所以这里的「没看到红」不是恒真的空话。第一份方案没有基线可用，跳过这一条。
      if (issuesProof) {
        await expectAbsent(editor().locator('[data-storyboard-issues]'),
          { provenBy: issuesProof, message: '一个字都没写的空白方案不许先给一片红' })
      }
      // 侧栏那一行必须有自己的名字：两次空白新建不许长成同一行（`uniqueDesignTitle`）。
      assert.ok(blank.title.trim(), 'A blank plan still needs a row label of its own')
      for (const previous of expected.filter(plan => plan.documentId === document.id)) {
        assert.notEqual(previous.title.trim(), blank.title.trim(), 'Two rows in one document must not share a label')
      }
      assertNoExecution()
      await screenshot(`zh-${document.id}-${index}-blank`)
      const title = `${document.id} plan ${index}`, text = `Keep ${document.id} prompt ${index}`
      await editor().locator('header input').fill(title)
      await prompt.fill(text)
      // 阳性对照：写了第 1 镜、第 2 镜还空着 → 那条红必须回来，而且数得对。
      // 它同时是上面那条「不该有红」的基线——同一个选择器、同一屏。
      issuesProof = await proveProbe(editor().locator('[data-storyboard-issues]'), '写了一镜、另一镜还空着时，底栏那条红真的浮出来')
      await expect(editor().locator('[data-storyboard-issues]')).toHaveAttribute('data-storyboard-issues', '1')
      await expect.poll(() => savedPlans().find(plan => plan.id === blank.id)?.plan.shots[0].prompt).toBe(text)
      const saved = savedPlans().find(plan => plan.id === blank.id)
      assert.equal(saved.plan.title, title)
      expected.push(structuredClone(saved))
      for (const previous of expected) assert.deepEqual(savedPlans().find(plan => plan.id === previous.id), previous)
      assertNoExecution()
      report.checks.push({ scenario: 'manual new / original editor / saved to original document / zero requests', documentId: document.id, designId: blank.id, title })
    }
  }
  await screenshot('zh-four-plans-saved')
  const savedGraph = structuredClone(disk().generationCanvas)
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  await gui.app.close(); gui = null
  await start()
  for (const previous of expected) {
    await expandSidebar()
    await win.locator(`button[data-storyboard-id="${previous.id}"]`).click()
    await expect(editor().locator('header input')).toHaveValue(previous.plan.title)
    await expect(editor().locator('[data-storyboard-row="1"] [data-storyboard-prompt-block] [contenteditable="true"]').first()).toHaveText(previous.plan.shots[0].prompt)
    assert.deepEqual(savedPlans().find(plan => plan.id === previous.id), previous)
    report.checks.push({ scenario: 'cold process / exact identity and content restored through original sidebar', designId: previous.id })
  }
  await screenshot('en-four-plans-reopened')
  assertNoExecution()
  // Existing projectV51ToV60Migration infers renderKind from categoryId on load.
  // Compare every other field and the exact inferred value, not only node counts.
  assert.deepEqual(disk().generationCanvas.nodes, savedGraph.nodes.map(node => ({ ...node, renderKind: node.renderKind ?? 'shot-frame' })), 'Cold reopen preserves exact tables apart from the baseline renderKind backfill')
  await win.locator('[data-creation-resource-tree-toggle="collapse"]:visible').click()
  await screenshot('en-reopened-sidebar-collapsed')
  await gui.app.close(); gui = null
  assertNoExecution()
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'; report.error = String(error?.stack || error)
  if (gui) { report.mainLogTail = gui.mainLogTail(); await screenshot('failure').catch(() => {}) }
  throw error
} finally {
  await gui?.app.close().catch(() => {})
  report.requests = { text: fixture.requests.length, image: fixture.images.length, unexpected: fixture.unexpected.length }
  fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2))
  await fixture.close()
  console.log(JSON.stringify({ status: report.status, outputDir, checks: report.checks.length }))
}
