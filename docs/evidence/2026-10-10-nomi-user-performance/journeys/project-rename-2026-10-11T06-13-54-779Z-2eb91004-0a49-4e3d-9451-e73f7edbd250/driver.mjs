import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'

if (process.argv.length !== 2) throw new Error('This bounded project rename walk accepts no arguments')
const root = process.cwd()
const local = file => import(pathToFileURL(path.join(root, file)).href)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const out = path.join(root, 'docs/evidence/2026-10-10-nomi-user-performance/journeys', `project-rename-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`)
const report = { scope: 'Three actual native process launches; zh-CN project-library cancel, trim/commit, cold reopen and complete persisted payload/foreign-project isolation. One bounded functional run, no percentile or complete feature acceptance.', launches: [], archives: [], cases: [], textRequests: 0, imageRequests: 0, paidCalls: 0, unexpected: [], result: 'failed', performanceAcceptance: 'unverified' }
let launchNomiApp, closeNomiApp, makeTempDir, createNomiUserWorkflowFixture, projectCardSelector, redact, validateNativeWalkEvidence, expect, backToLibrary
let temp, projectsDir, settingsDir, guardLog, a, b, originalA, originalB
const recordPath = fixture => path.join(fixture.projectRoot, '.nomi/project.json')
let instance
async function launch(label) {
  instance = await launchNomiApp({ name: `nomi-project-rename-${label}`, tempRoot: temp, settingsDir, projectsDir, settleMs: 0,
    mainRequire: [path.join(root, 'scripts/walkthrough-network-guard.cjs')], env: { NOMI_WALK_NET_LOG: guardLog, NOMI_WALK_ALLOW_ORIGINS: '', NOMI_WALK_URL_REDIRECTS: '[]', NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '' } })
  const pid = await instance.app.evaluate(() => process.pid)
  instance.processHandle = instance.app.process()
  assert.equal(instance.processHandle.pid, pid, 'Captured native process handle must identify the launched main PID')
  const rendererUrl = await instance.win.evaluate(() => location.href)
  assert.equal(new URL(rendererUrl).protocol, 'file:', 'Native walk must use the built file renderer')
  assert.equal(decodeURIComponent(new URL(rendererUrl).pathname), path.join(root, 'dist/index.html'))
  report.launches.push({ label, pid, rendererUrl })
  await expect(instance.win.locator(projectCardSelector(a.record))).toBeVisible()
  return instance.win
}
async function close() {
  const { app, processHandle } = instance
  await closeNomiApp(app)
  assert.ok(processHandle.exitCode !== null || processHandle.signalCode !== null, 'Native process teardown must finish')
  instance = null
}
function archive(name, bytes) {
  const redacted = Buffer.from(redact(bytes.toString()))
  fs.writeFileSync(path.join(out, name), redacted, { flag: 'wx' })
  return { file: name, originalSha256: sha(bytes), archivedSha256: sha(redacted), originalBytes: bytes.length, fullRecordPreserved: true, redaction: 'checkout/temp paths only; full comparisons use original unredacted bytes' }
}
try {
  fs.mkdirSync(out, { recursive: true })
  const { verifyBuild } = await local('scripts/package-build-stamp.mjs')
  const verified = verifyBuild(root)
  report.source = { ...verified, driverSha256: sha(fs.readFileSync(process.argv[1])) }
  report.buildReceipt = JSON.parse(fs.readFileSync(path.join(root, 'dist/build-stamp.json')))
  assert.equal(report.buildReceipt.head, verified.head); assert.equal(report.buildReceipt.tree, verified.tree)
  assert.equal(report.buildReceipt.dirty, false)
  ;({ launchNomiApp, closeNomiApp } = await local('tests/ux/_launchApp.mjs'))
  ;({ makeTempDir } = await local('scripts/_test-temp.mjs'))
  ;({ createNomiUserWorkflowFixture } = await local('tests/ux/fixtures/nomi-user-workflow-fixture.mjs'))
  ;({ projectCardSelector, redact } = await local('tests/ux/nomi-user-workflow-performance.e2e.mjs'))
  ;({ validateNativeWalkEvidence } = await local('tests/ux/nomi-native-evidence-contract.mjs'))
  ;({ expect } = await local('tests/ux/_assert.mjs'))
  ;({ backToLibrary } = await local('tests/ux/_shell.mjs'))
  const files = ['scripts/package-build-stamp.mjs', 'tests/ux/_launchApp.mjs', 'scripts/walkthrough-network-guard.cjs', 'tests/ux/fixtures/nomi-user-workflow-fixture.mjs', 'tests/ux/nomi-native-evidence-contract.mjs', 'tests/ux/_shell.mjs', 'src/workbench/library/ProjectLibraryPage.tsx', 'src/workbench/NomiStudioApp.tsx', 'src/workbench/project/projectRepository.ts']
  report.source.fileHashes = Object.fromEntries(files.map(file => [file, sha(fs.readFileSync(path.join(root, file)))]))
  temp = makeTempDir('nomi-rename-native-'); projectsDir = path.join(temp, 'projects'); settingsDir = path.join(temp, 'settings')
  guardLog = path.join(out, 'network.jsonl')
  a = createNomiUserWorkflowFixture({ projectsDir, scale: 'small', projectId: 'rename-project-a' })
  b = createNomiUserWorkflowFixture({ projectsDir: path.join(temp, 'seed-b'), scale: 'small', projectId: 'rename-project-b' })
  const foreignRoot = path.join(projectsDir, 'ZZ-workflow-rename-b')
  fs.renameSync(b.projectRoot, foreignRoot); b.projectRoot = foreignRoot; b.projectsDir = projectsDir
  b.record.lastKnownRootPath = foreignRoot
  for (const file of [path.join(foreignRoot, 'project.json'), recordPath(b)]) fs.writeFileSync(file, JSON.stringify(b.record, null, 1))
  fs.writeFileSync(path.join(projectsDir, 'recent-workspaces.json'), JSON.stringify([a,b].map(f => ({ id: f.record.id, name: f.record.name, rootPath: f.projectRoot, lastOpenedAt: f.record.updatedAt, missing: false })), null, 2))
  assert.notEqual(a.projectRoot, b.projectRoot, 'Two fixtures must have distinct actual directories')
  assert.notEqual(a.record.id, b.record.id)
  for (const fixture of [a,b]) assert.equal(JSON.parse(fs.readFileSync(recordPath(fixture))).id, fixture.record.id)
  originalA = fs.readFileSync(recordPath(a)); originalB = fs.readFileSync(recordPath(b))
  report.archives.push(archive('project-a-before.json', originalA), archive('project-b-before.json', originalB))
  let page = await launch('cancel')
  let card = page.locator(projectCardSelector(a.record))
  await card.getByText(a.record.name, { exact: true }).dblclick()
  let input = card.getByRole('textbox')
  await expect(input).toHaveValue(a.record.name)
  await input.fill('CANCELLED_RENAME_MUST_NOT_PERSIST')
  await input.press('Escape')
  await expect(input).toHaveCount(0)
  await expect(card.getByText(a.record.name, { exact: true })).toBeVisible()
  await page.screenshot({ path: path.join(out, 'cancelled.png') })
  await close()
  const cancelledBytes = fs.readFileSync(recordPath(a))
  report.archives.push(archive('project-a-cancelled.json', cancelledBytes))
  assert.deepEqual(cancelledBytes, originalA, 'Cancelled rename must preserve the entire original record bytes after teardown')
  assert.deepEqual(fs.readFileSync(recordPath(b)), originalB)
  report.cases.push({ id: 'project.rename-cancel', executed: true, passed: true, originalRecordBytesUnchanged: true, foreignRecordBytesUnchanged: true })

  page = await launch('commit')
  card = page.locator(projectCardSelector(a.record))
  await card.getByText(a.record.name, { exact: true }).dblclick()
  input = card.getByRole('textbox')
  const renamed = 'Nomi 本地改名 Native Rename A'
  await input.fill(`  ${renamed}  `)
  await input.press('Enter')
  await expect(input).toHaveCount(0)
  await expect(card.getByText(renamed, { exact: true })).toBeVisible()
  await page.screenshot({ path: path.join(out, 'committed.png') })
  await close()
  const afterRenameBytes = fs.readFileSync(recordPath(a))
  report.archives.push(archive('project-a-renamed.json', afterRenameBytes))
  const afterRename = JSON.parse(afterRenameBytes)
  assert.equal(afterRename.id, a.record.id); assert.equal(afterRename.name, renamed)
  assert.deepEqual(afterRename.payload, JSON.parse(originalA).payload, 'Rename must preserve the complete original domain payload')
  assert.deepEqual(fs.readFileSync(recordPath(b)), originalB)
  report.cases.push({ id: 'project.rename-commit', executed: true, passed: true, trimmedName: renamed, exactProjectId: afterRename.id, completePayloadUnchanged: true, foreignRecordBytesUnchanged: true })

  page = await launch('cold-reopen')
  card = page.locator(projectCardSelector(a.record))
  await expect(card.getByText(renamed, { exact: true })).toBeVisible()
  await card.click()
  await expect(page.locator('.generation-canvas-v2__stage[data-ready="true"]')).toBeVisible()
  await expect(page.locator('[data-shell-project-menu]')).toContainText(renamed)
  for (const node of a.record.payload.generationCanvas.nodes) await expect(page.locator(`[data-node-id="${node.id}"]`)).toBeVisible()
  const projectId = await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] || '').get('projectId'))
  assert.equal(projectId, a.record.id)
  await page.screenshot({ path: path.join(out, 'cold-reopened.png') })
  await backToLibrary(page)
  await close()
  const reopenedBytes = fs.readFileSync(recordPath(a))
  report.archives.push(archive('project-a-reopened.json', reopenedBytes))
  const reopened = JSON.parse(reopenedBytes)
  assert.equal(reopened.name, renamed); assert.equal(reopened.id, a.record.id)
  assert.deepEqual(reopened.payload, afterRename.payload, 'Cold opening must preserve the entire renamed project payload')
  assert.deepEqual(fs.readFileSync(recordPath(b)), originalB)
  report.cases.push({ id: 'project.rename-cold-reopen', executed: true, passed: true, exactProjectId: projectId, completePayloadUnchanged: true, allNodeIdsVisible: true, foreignRecordBytesUnchanged: true })

  report.result = 'passed'
  report.guard = validateNativeWalkEvidence(report, guardLog, 0)
  report.guard.sha256 = sha(fs.readFileSync(guardLog))
} catch (error) { report.result = 'failed'; report.error = error.message; if (error.guard) report.guard = error.guard; process.exitCode = 1 }
finally {
  if (instance) { try { await close() } catch (error) { report.result = 'failed'; report.cleanupError = error.message; process.exitCode = 1 } }
  fs.mkdirSync(out, { recursive: true })
  if (a && b && redact) {
    try { for (const [label, fixture] of [['a', a], ['b', b]]) if (fs.existsSync(recordPath(fixture))) report.archives.push(archive(`project-${label}-final.json`, fs.readFileSync(recordPath(fixture)))) }
    catch (error) { report.result = 'failed'; report.recordCollectionFailure = error.message; process.exitCode = 1 }
  }
  fs.writeFileSync(path.join(out, 'driver.mjs'), fs.readFileSync(process.argv[1]), { flag: 'wx' })
  fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(redact ? redact(report) : report, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ out, result: report.result, cases: report.cases, error: report.error }))
}
