// Historical project COPY → original editor → cold restart → original MP4 export.
// Uses the existing packaged launcher; never opens or changes the source project.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { require as tsxRequire } from 'tsx/cjs/api'
import { clickOrFail, expect, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'
import { repoRoot } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { runOldStoryboardFormatMatrix } from './core-a-old-storyboard-formats.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'

const require = createRequire(import.meta.url)
const { productionRunsRoot } = tsxRequire('../../electron/productionRun/productionRunPaths.ts', import.meta.url)
const { renderShotNodePrompt, stableShotId } = tsxRequire('../../src/workbench/generationCanvas/agent/storyboardPlan.ts', import.meta.url)
const { createStoryboardShotTable } = tsxRequire('../../electron/shared/canvas/shotTable.ts', import.meta.url)
const { resolveNodeRenderKind } = tsxRequire('../../src/workbench/generationCanvas/nodes/resolveRenderKind.ts', import.meta.url)
const { NODE_KIND_DEFAULT_SIZE } = tsxRequire('../../electron/capabilityCore/nodeKindDomain.ts', import.meta.url)
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const inside = (root, file) => {
  const relative = path.relative(root, file)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

// Resolve existing ancestors before creating anything, including symlink aliases.
export function validateEvidenceDirectory(sourcePath, outputPath) {
  const sourceRoot = fs.realpathSync(sourcePath)
  const missing = []
  let ancestor = path.resolve(outputPath)
  while (!fs.existsSync(ancestor)) {
    missing.unshift(path.basename(ancestor))
    ancestor = path.dirname(ancestor)
  }
  const outputDir = path.join(fs.realpathSync(ancestor), ...missing)
  assert(outputDir !== sourceRoot && !inside(sourceRoot, outputDir), 'Evidence must not write inside the source project')
  const canonicalRepo = fs.realpathSync(repoRoot)
  assert(outputDir !== canonicalRepo && !inside(canonicalRepo, outputDir), 'Evidence must be outside the source tree')
  assert(!fs.existsSync(outputDir), 'Use a new evidence directory; never overwrite a previous receipt')
  return { sourceRoot, outputDir }
}

export function assertNewSourceClip(before, after, media) {
  const oldIds = new Set(before.map(clip => clip.id))
  assert.equal(after.length, before.length + 1)
  const added = after.filter(clip => !oldIds.has(clip.id))
  assert.equal(added.length, 1, 'Identify the new clip by id, even when this source was already on the timeline')
  for (const id of oldIds) assert(after.some(clip => clip.id === id), 'Adding must retain existing clips')
  assert.equal(added[0].sourceNodeId, media.id)
  assert.equal(added[0].url, media.result.url)
  return added[0]
}

export function fileHashes(root) {
  const result = {}
  const visit = dir => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, item.name)
      assert(!item.isSymbolicLink(), `Source/copy must not contain links: ${file}`)
      if (item.isDirectory()) visit(file)
      else {
        assert(item.isFile(), `Unsupported filesystem entry: ${file}`)
        result[path.relative(root, file)] = sha256(fs.readFileSync(file))
      }
    }
  }
  visit(root)
  return result
}

export function prepareOldProjectCopy(sourcePath, projectsDir) {
  const sourceRoot = fs.realpathSync(sourcePath)
  const sourceHashes = fileHashes(sourceRoot)
  const manifest = path.join('.nomi', 'project.json')
  const original = readJson(path.join(sourceRoot, manifest))
  assert.equal(original.version, 2, 'This journey covers an actual historical workspace v2, not invented migration states')
  const designs = Object.values(original.payload.storyboardDesignsByDocumentId ?? {}).flat()
  const design = designs.find(item => item.plan.shots.some(shot => !shot.prompt.includes('@[')))
  assert(design, 'Source needs an existing original storyboard design')
  const canvas = original.payload.generationCanvas
  const media = canvas.nodes.find(node => node.result?.type === 'image' && /\.jpe?g$/i.test(node.result.url))
  assert(media, 'Source must contain an existing real JPG result; SVG-only seeds do not qualify')
  const uri = new URL(media.result.url)
  assert.equal(uri.protocol, 'nomi-local:')
  assert.equal(uri.hostname, 'asset')
  const [projectId, ...assetParts] = uri.pathname.slice(1).split('/').map(decodeURIComponent)
  assert.equal(projectId, original.id)
  const mediaFile = path.resolve(sourceRoot, ...assetParts)
  assert(inside(sourceRoot, mediaFile), 'Source result must belong to the copied project')
  assert.equal(fs.readFileSync(mediaFile).subarray(0, 3).toString('hex'), 'ffd8ff', 'Result bytes must be JPEG')
  const copyRoot = path.resolve(projectsDir, 'historical-project-copy')
  assert(!inside(sourceRoot, copyRoot) && sourceRoot !== copyRoot, 'Copy must be separate from source')
  fs.mkdirSync(projectsDir, { recursive: true })
  fs.cpSync(sourceRoot, copyRoot, { recursive: true, errorOnExist: true, force: false })
  assert.deepEqual(fileHashes(copyRoot), sourceHashes, 'Open an exact byte copy, without rewriting ids, claims or paths')
  return { sourceRoot, sourceHashes, original, design, media, copyRoot, manifest }
}

// Measure the ORIGINAL card footer; never derive an allowance from changed meta.
export async function readCardInfoMeasurements(win, original) {
  const measurements = {}
  for (const node of original.nodes) {
    if (!node.result?.url) continue
    const measurement = { result: structuredClone(node.result) }
    if (node.result.type === 'image') {
      // Decode the exact original local result, independently of canvas meta.
      // This detached Image has no product onLoad handler and cannot write state.
      assert.equal(new URL(node.result.url).protocol, 'nomi-local:')
      measurement.image = await win.evaluate(async url => {
        const image = new Image()
        image.src = url
        await image.decode()
        return { width: image.naturalWidth, height: image.naturalHeight }
      }, node.result.url)
      assert(measurement.image.width > 0 && measurement.image.height > 0)
    }
    if (['character-card', 'prop-card'].includes(resolveNodeRenderKind(node)) && ['image', 'video'].includes(node.result.type)) {
      const footer = win.locator(`[data-node-id="${node.id}"][data-kind="${node.kind}"] .shrink-0.px-3.py-2`)
      await expect(footer).toHaveCount(1)
      measurement.height = await footer.evaluate(element => element.offsetHeight)
      assert(Number.isFinite(measurement.height) && measurement.height >= 0)
    }
    if (measurement.image || Object.hasOwn(measurement, 'height')) measurements[node.id] = measurement
  }
  return measurements
}

export function recordCandidateFailure(report, phase, error) {
  const detail = value => value instanceof Error
    ? { name: value.name, message: value.message, stack: value.stack,
        ...(value instanceof AggregateError ? { errors: value.errors.map(detail) } : {}),
        ...(value.cause !== undefined ? { cause: detail(value.cause) } : {}) }
    : { message: String(value) }
  ;(report.failures ??= []).push({ phase, ...detail(error) })
  console.error(`Candidate journey failure (${phase}):`, error)
}

export async function assertNoHydratedCanvasAddition(win, original) {
  // Packaged builds expose no development store bridge. Check the original
  // persisted graph separately and the actual mounted node shells here.
  const mounted = await win.locator('[data-node-id][data-kind]').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.nodeId, kind: node.dataset.kind })))
  assert(mounted.length > 0, 'The original canvas must have mounted node shells')
  for (const node of mounted) assert(original.nodes.some(before => before.id === node.id && before.kind === node.kind),
    `Opening alone must not manufacture a canvas node: ${node.id}`)
}

export function editedCanvasExpectation(original, design, expectedPlan, shot) {
  const expected = structuredClone(original)
  const matches = expected.nodes.filter(node => node.meta?.storyboardDesignId === design.id
    && node.meta?.shotId === stableShotId(shot) && node.meta?.storyboardKeyframe !== true
    && !node.regeneratedFrom && !node.derivedFrom)
  assert(matches.length <= 1, 'Historical fixture must have an unambiguous original shot binding')
  if (matches.length) {
    assert(!(matches[0].meta?.overriddenFields ?? []).includes('prompt'), 'Chosen original shot must not have a canvas prompt override')
    matches[0].prompt = renderShotNodePrompt(expectedPlan, expectedPlan.shots.find(item => item.index === shot.index))
  }
  return expected
}

// Source content stays exact except explicit bound prompt projection, measured
// footer height/decoded image dimensions and the existing absent → shot-frame category backfill.
export function assertCanvasPreserved(actual, expected, measurements = {}, { beforeEdit = false } = {}) {
  const expectedNodes = structuredClone(expected.nodes)
  for (const node of expectedNodes) {
    const current = actual.nodes.find(item => item.id === node.id)
    if (!node.renderKind && node.categoryId === 'shots'
      && !['whiteboard', 'audio', 'character', 'scene'].includes(node.kind)
      && current?.renderKind === 'shot-frame') node.renderKind = 'shot-frame'
    const measurement = measurements[node.id]
    if (measurement) {
      assert.deepEqual(current?.result, measurement.result, 'Runtime measurement may not excuse replacing the original result')
      if (Object.hasOwn(measurement, 'height') && (!beforeEdit || Object.hasOwn(current?.meta ?? {}, 'cardInfoHeight'))) {
        node.meta = { ...node.meta, cardInfoHeight: measurement.height }
      }
      const imageKeys = ['imageWidth', 'imageHeight', 'imageAspectRatio']
      if (measurement.image && imageKeys.every(key => !Object.hasOwn(node.meta ?? {}, key))
        && imageKeys.some(key => Object.hasOwn(current?.meta ?? {}, key))) {
        const { width, height } = measurement.image
        node.meta = { ...node.meta, imageWidth: width, imageHeight: height, imageAspectRatio: width / height }
      }
    }
  }
  assert.deepEqual(actual.nodes, expectedNodes, 'All original graph content and only explicitly expected edits must survive')
  assert.deepEqual(actual.edges, expected.edges)
  assert.deepEqual(actual.groups ?? [], expected.groups ?? [])
}

export function captureExpectedLegacyTable(actual, original, savedDesign) {
  const originalIds = new Set(original.nodes.map(node => node.id))
  const additions = actual.nodes.filter(node => !originalIds.has(node.id))
  assert.equal(additions.length, 1, 'Only one existing-kind storyboard view may be created by the explicit retired-plan edit')
  const table = additions[0]
  assert.equal(typeof table.id, 'string')
  assert(table.id.length > 0)
  assert(Number.isFinite(table.position?.x) && Number.isFinite(table.position?.y))
  assert.deepEqual(table, {
    id: table.id, kind: 'shot_table', title: savedDesign.title,
    position: table.position, size: NODE_KIND_DEFAULT_SIZE.shot_table,
    prompt: '', references: [], history: [], status: 'idle', categoryId: 'shots',
    meta: { shotTable: createStoryboardShotTable(savedDesign.documentId, savedDesign.id, new Date(savedDesign.updatedAt).toISOString()) },
  }, 'Validate the complete original table envelope; no media results, rows, lineage or extra metadata')
  return structuredClone(table)
}

async function hashLargeFile(file) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

// These are negative workspace-manifest fixtures, not historical legacy projects.
// The separate root/project.json legacy migration must not be confused with
// an unsupported version inside .nomi/project.json (whose schema is literal 2).
export function prepareRejectedWorkspaceFormats(root) {
  const cases = [
    { key: 'workspace-version-1', version: 1, error: /version/ },
    { key: 'workspace-version-999', version: 999, error: /version/ },
    { key: 'identity-uuid-only', omit: 'projectGeneration', error: /identity is only partially present/ },
    { key: 'identity-generation-only', omit: 'immutableProjectUuid', error: /identity is only partially present/ },
    { key: 'partial-backup-identity', partialBackup: true, error: /backup identity is only partially present/ },
  ]
  return cases.map(test => {
    const projectRoot = path.join(root, test.key)
    assert(!fs.existsSync(projectRoot), 'Never overwrite a format fixture')
    fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
    const record = { id: `c18-${test.key}`, name: `C18 ${test.key}`, version: test.version ?? 2,
      createdAt: 1, updatedAt: 1, revision: 0,
      immutableProjectUuid: crypto.randomUUID(), projectGeneration: 1,
      payload: { preserveSentinel: test.key } }
    if (test.omit) delete record[test.omit]
    fs.writeFileSync(path.join(projectRoot, '.nomi/project.json'), `${JSON.stringify(record, null, 2)}\n`)
    if (test.partialBackup) {
      const backup = { ...record }
      delete backup.projectGeneration
      fs.writeFileSync(path.join(projectRoot, '.nomi/project.backup.json'), `${JSON.stringify(backup, null, 2)}\n`)
    }
    fs.writeFileSync(path.join(projectRoot, 'user-document.txt'), `Keep user content: ${test.key}\n`)
    return { ...test, projectRoot, projectId: record.id, files: fileHashes(projectRoot) }
  })
}

async function rejectUnsupportedFormats({ app, win, cases, report, snap }) {
  report.formatRejections = []
  for (const test of cases) {
    // A reload clears the previous inline feedback via the real app lifecycle,
    // so an old alert cannot satisfy the next rejection's visible-error oracle.
    await win.reload({ waitUntil: 'domcontentloaded' })
    const openFolder = win.getByRole('button', { name: /^打开已有文件夹/ })
    await expect(openFolder).toBeVisible()
    const libraryProof = await proveProbe(openFolder, '原项目库按钮确实可被角色探针找到')
    await expectAbsent(win.getByRole('alert'), { provenBy: libraryProof,
      message: '重新加载原库后不能沿用上一例错误提示' })
    const libraryUrl = win.url()
    const before = await win.evaluate(() => window.nomiDesktop.projects.listAsync())
    assert(!before.some(project => project.id === test.projectId || project.rootPath === test.projectRoot))
    await app.evaluate(({ dialog }, selectedPath) => {
      const original = dialog.showOpenDialog
      globalThis.__coreAFormatPicker = { original, calls: [] }
      dialog.showOpenDialog = async (...args) => {
        const options = args.at(-1)
        globalThis.__coreAFormatPicker.calls.push(options.properties)
        dialog.showOpenDialog = original
        if (!options.properties.includes('openDirectory')) throw new Error('Expected original workspace folder picker')
        return { canceled: false, filePaths: [selectedPath] }
      }
    }, test.projectRoot)
    try {
      await clickOrFail(openFolder, `原库打开拒绝格式 ${test.key}`)
      const alert = win.getByRole('alert')
      await expect(alert).toBeVisible()
      await expect(alert).toContainText(test.error)
      await expect(openFolder).toBeVisible()
      assert.equal(win.url(), libraryUrl, 'A rejected folder must leave the original project library open')
      const rejectionProof = await proveProbe(alert, '本例原错误提示确实出现')
      await expectAbsent(win.getByRole('dialog'), { provenBy: rejectionProof,
        message: '不支持的项目必须显示错误，不能同时弹出初始化确认' })
      const after = await win.evaluate(() => window.nomiDesktop.projects.listAsync())
      assert.deepEqual(after.map(project => [project.id, project.rootPath]), before.map(project => [project.id, project.rootPath]),
        'Rejected formats must not become registered projects')
      assert.deepEqual(fileHashes(test.projectRoot), test.files,
        'Rejection must retain all files byte-for-byte, with no new manifest, backup, or initialized content')
      const pickerCalls = await app.evaluate(() => globalThis.__coreAFormatPicker.calls)
      assert.equal(pickerCalls.length, 1, 'The original UI must invoke the native picker exactly once')
      await snap(`rejected-${test.key}`)
      report.formatRejections.push({ key: test.key, projectRoot: test.projectRoot, files: test.files,
        error: await alert.innerText(), originalLibraryRetained: true, unregistered: true, filesUnchanged: true, pickerCalls })
    } finally {
      await app.evaluate(({ dialog }) => {
        dialog.showOpenDialog = globalThis.__coreAFormatPicker.original
        delete globalThis.__coreAFormatPicker
      })
    }
  }
}

export async function openCopiedStoryboardEditor(win, { original, design, copyRoot }) {
  const summaries = await win.evaluate(() => window.nomiDesktop.projects.listAsync())
  const project = summaries.find(item => item.id === original.id)
  assert(project, 'The copied historical project must be discovered by the packaged app')
  assert.equal(fs.realpathSync(project.rootPath), fs.realpathSync(copyRoot), 'The app must bind the COPY, never source')
  if (!win.url().includes(`projectId=${original.id}`)) {
    await clickOrFail(win.locator('[data-project-card]').filter({ hasText: original.name }), '打开旧项目副本')
  }
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '原创作区')
  const treeToggle = win.locator('[data-creation-resource-tree-toggle]:visible')
  await expect(treeToggle).toBeVisible()
  if (await treeToggle.getAttribute('data-creation-resource-tree-toggle') === 'expand') await clickOrFail(treeToggle, '展开原文稿侧栏')
  await openStoryboardEditor(win, design.id, '打开原分镜方案')
  const editor = win.locator('[data-storyboard-editor="true"]')
  await expect(editor).toBeVisible()
  await expect(editor.locator('[data-storyboard-bulkbar]')).toBeVisible()
  await expect(editor.locator('[data-storyboard-row]')).toHaveCount(design.plan.shots.length)
  return editor
}

async function main() {
  const args = process.argv.slice(2)
  const take = flag => {
    const index = args.indexOf(flag)
    assert(index >= 0 && args[index + 1] && !args[index + 1].startsWith('--'), `Required: ${flag} <absolute path>`)
    return args.splice(index, 2)[1]
  }
  const sourcePath = take('--source-project'), executable = take('--packaged'), outputPath = take('--output-dir')
  assert.equal(args.length, 0, 'Unknown arguments')
  for (const value of [sourcePath, executable, outputPath]) assert(path.isAbsolute(value), 'Use absolute paths')
  assert.equal(process.platform, 'darwin', 'This is the macOS candidate journey; Windows remains unverified')
  const { sourceRoot: source, outputDir } = validateEvidenceDirectory(sourcePath, outputPath)
  fs.mkdirSync(outputDir, { recursive: true })
  process.argv = [process.argv[0], process.argv[1], '--packaged', executable]
  const walk = await createRuntimeWalk('core-a-old-project')
  walk.report.outputDir = outputDir
  let copy, failure, win, app, rejectedFormats, runFiles, runsBefore, verifyFinalGraph
  const snap = async label => {
    const file = path.join(outputDir, `${walk.report.screenshots.length + 1}-${label}.png`)
    await screenshotSettled(win, { path: file })
    walk.report.screenshots.push(file)
  }
  try {
    copy = prepareOldProjectCopy(source, path.join(walk.report.tempRoot, 'projects'))
    const runsRoot = productionRunsRoot(copy.copyRoot)
    runFiles = () => fs.existsSync(runsRoot) ? fileHashes(runsRoot) : {}
    runsBefore = runFiles()
    // Keep negative fixtures outside auto-discovery; they must enter through the picker.
    rejectedFormats = prepareRejectedWorkspaceFormats(path.join(walk.report.tempRoot, 'format-rejections'))
    const { original, design, media, copyRoot, sourceHashes } = copy
    const readCopy = () => readJson(path.join(copyRoot, copy.manifest))
    const readDesign = () => readCopy().payload.storyboardDesignsByDocumentId[design.documentId].find(item => item.id === design.id)
    const originalCanvas = original.payload.generationCanvas
    const shot = design.plan.shots.find(item => !item.prompt.includes('@['))
    const editedPrompt = `${shot.prompt} 候选包副本保存验证。`
    const expectedPlan = structuredClone(design.plan)
    Object.assign(expectedPlan.shots.find(item => item.index === shot.index), { prompt: editedPrompt, promptSegments: [] })
    const expectedCanvas = editedCanvasExpectation(originalCanvas, design, expectedPlan, shot)
    assert.equal(expectedCanvas.nodes.filter((node, index) => node.prompt !== originalCanvas.nodes[index].prompt).length, 1)
    let measurements = {}
    const appAsar = path.resolve(executable, '../../Resources/app.asar')
    walk.report.candidate = { executable, executableSha256: await hashLargeFile(executable), appAsar,
      appAsarSha256: await hashLargeFile(appAsar) }
    walk.report.source = { root: copy.sourceRoot, projectId: original.id, schema: original.version,
      manifestSha256: sourceHashes[copy.manifest], files: sourceHashes, updatedAt: original.updatedAt,
      boundary: 'Historical workspace v2 copy; separate synthetic fixtures exercise unsupported manifest versions and partial identity rejection. Root/project.json legacy migration remains unverified.' }
    walk.report.projectRoot = copyRoot
    walk.report.projectId = original.id
    walk.report.normalizationAllowance = 'Original category renderKind backfill; independently measured card footer height and original-image decode dimensions (only previously absent complete triples); explicit edit projects only the exact bound unoverridden shot prompt. All other graph fields remain exact.'
    const openOriginalEditor = () => openCopiedStoryboardEditor(win, { original, design, copyRoot })
    ;({ win, app } = await walk.start({ first: true }))
    await rejectUnsupportedFormats({ app, win, cases: rejectedFormats, report: walk.report, snap })
    let editor = await openOriginalEditor()
    const prompt = editor.locator(`[data-storyboard-row="${shot.index}"] [data-storyboard-prompt-block] [contenteditable="true"]`).first()
    await expect(prompt).toHaveText(shot.prompt)
    await snap('historical-original-editor')
    measurements = await readCardInfoMeasurements(win, originalCanvas)
    ;(walk.report.cardInfoMeasurements ??= []).push(structuredClone(measurements))
    assertCanvasPreserved(readCopy().payload.generationCanvas, originalCanvas, measurements, { beforeEdit: true })
    await assertNoHydratedCanvasAddition(win, originalCanvas)
    walk.report.beforeEditPersistedGraphAndMountedIdsPreserved = true
    await prompt.fill(editedPrompt)
    await expect.poll(() => readDesign().plan.shots.find(item => item.index === shot.index).prompt).toBe(editedPrompt)
    assert.deepEqual(readDesign().plan, expectedPlan, 'Editing one prompt preserves all author fields in every shot and anchor')
    measurements = await readCardInfoMeasurements(win, originalCanvas)
    ;(walk.report.cardInfoMeasurements ??= []).push(structuredClone(measurements))
    assertCanvasPreserved(readCopy().payload.generationCanvas, expectedCanvas, measurements)
    verifyFinalGraph = () => assertCanvasPreserved(readCopy().payload.generationCanvas, expectedCanvas, measurements)
    await snap('saved-original-editor')
    await walk.stopApp()
    ;({ win } = await walk.start())
    assert.notEqual(walk.report.launches[0].pid, walk.report.launches[1].pid, 'Cold restoration requires a new Electron process')
    editor = await openOriginalEditor()
    await expect(editor.locator(`[data-storyboard-row="${shot.index}"] [data-storyboard-prompt-block] [contenteditable="true"]`).first()).toHaveText(editedPrompt)
    assert.deepEqual(readDesign().plan, expectedPlan)
    measurements = await readCardInfoMeasurements(win, originalCanvas)
    ;(walk.report.cardInfoMeasurements ??= []).push(structuredClone(measurements))
    assertCanvasPreserved(readCopy().payload.generationCanvas, expectedCanvas, measurements)
    verifyFinalGraph = () => assertCanvasPreserved(readCopy().payload.generationCanvas, expectedCanvas, measurements)
    await snap('cold-restored-original-editor')

    // Original preview source card uses the same addGenerationNodeToTimelineEnd as canvas.
    await clickOrFail(win.getByRole('button', { name: '预览', exact: true }), '原预览区')
    const card = win.locator(`[data-testid="preview-source-shot"][data-node-id="${media.id}"]`)
    await expect(card).toBeVisible()
    await expect.poll(() => card.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true)
    const clipsBefore = readCopy().payload.timeline.tracks.flatMap(track => track.clips)
    await clickOrFail(card, '将旧项目真实 JPG 加入原时间轴')
    await expect.poll(() => readCopy().payload.timeline.tracks.flatMap(track => track.clips).length).toBe(clipsBefore.length + 1)
    const added = assertNewSourceClip(clipsBefore, readCopy().payload.timeline.tracks.flatMap(track => track.clips), media)
    walk.report.addedClipId = added.id
    await snap('old-jpg-on-original-timeline')
    const exportsDir = path.join(copyRoot, 'exports')
    const oldExports = new Set(fs.existsSync(exportsDir) ? fs.readdirSync(exportsDir) : [])
    await clickOrFail(win.getByRole('button', { name: '导出 MP4', exact: true }).first(), '原 MP4 导出')
    // The original exporter atomically renames .partial.mp4 after completion.
    // A temporary file is not a completed export and must not freeze our probe target.
    const newExports = () => fs.existsSync(exportsDir) ? fs.readdirSync(exportsDir)
      .filter(name => /\.mp4$/i.test(name) && !/\.partial\.mp4$/i.test(name) && !oldExports.has(name)) : []
    await expect.poll(() => newExports().length, { timeout: stationTimeout({ operations: 2 }) }).toBe(1)
    const exportPath = path.join(exportsDir, newExports()[0])
    const probe = () => {
      try {
        return JSON.parse(execFileSync(require('@ffprobe-installer/ffprobe').path,
          ['-v', 'error', '-show_streams', '-show_entries', 'format=duration', '-of', 'json', exportPath], { encoding: 'utf8', timeout: 10_000 }))
      } catch { return null } // A real export may have created its file before writing the MP4 trailer.
    }
    await expect.poll(() => {
      const data = probe()
      return Boolean(data?.streams?.some(stream => stream.codec_type === 'video') && Number(data?.format?.duration) > 0)
    }, { timeout: stationTimeout({ operations: 2 }) }).toBe(true)
    await snap('packaged-export-complete')
    measurements = await readCardInfoMeasurements(win, originalCanvas)
    ;(walk.report.cardInfoMeasurements ??= []).push(structuredClone(measurements))
    assertCanvasPreserved(readCopy().payload.generationCanvas, expectedCanvas, measurements)
    verifyFinalGraph = () => assertCanvasPreserved(readCopy().payload.generationCanvas, expectedCanvas, measurements)
    assert.deepEqual(readDesign().plan, expectedPlan)
    walk.report.export = { path: exportPath, sha256: await hashLargeFile(exportPath), probe: probe(), sourceNodeId: media.id, sourceResultId: media.result.id }
    walk.report.checks = { originalEditor: true, completeAuthorFields: true, graphAndResults: true, coldRestart: true, actualJpgDecoded: true, originalMp4Export: true,
      unsupportedManifestVersionsRejected: true, partialMainAndBackupIdentityRejected: true }
    walk.report.unverified = ['Windows', 'Historical root/project.json legacy migration; unsupported fixtures are not historical legacy projects']
    assert.equal(walk.fixture.requests.length, 0, 'Opening/editing/exporting must not call an Agent supplier')
    assert.equal(walk.fixture.images.length, 0, 'Existing results must not regenerate')
    await walk.stopApp()
    verifyFinalGraph()
    walk.report.oldStoryboardFormats = await runOldStoryboardFormatMatrix({ source, outputDir,
      prepareOldProjectCopy, openCopiedStoryboardEditor, assertCanvasPreserved, assertNoHydratedCanvasAddition, editedCanvasExpectation, readCardInfoMeasurements, captureExpectedLegacyTable, recordCandidateFailure, fileHashes })
  } catch (error) {
    recordCandidateFailure(walk.report, 'journey', error)
    failure = error
    if (win && !win.isClosed()) {
      try { await win.screenshot({ path: path.join(outputDir, 'FAIL.png') }) }
      catch (captureError) { console.error('Failure screenshot unavailable:', captureError.message) }
    }
  }
  try {
    await walk.stopApp()
    assert.equal(walk.fixture.requests.length, 0, 'Final shutdown must not request an Agent')
    assert.equal(walk.fixture.images.length, 0, 'Final shutdown must not generate media')
    if (verifyFinalGraph) verifyFinalGraph()
    if (runFiles) assert.deepEqual(runFiles(), runsBefore, 'Historical project editing, export and final shutdown must not create or rewrite any Run')
    if (runFiles) walk.report.historicalRunFilesUnchangedAfterShutdown = true
    if (copy) {
      assert.deepEqual(fileHashes(copy.sourceRoot), copy.sourceHashes, 'Every source project file must remain untouched')
      walk.report.sourceUntouched = true
      walk.report.finalCopyFiles = fileHashes(copy.copyRoot)
    }
    for (const test of rejectedFormats ?? []) {
      assert.deepEqual(fileHashes(test.projectRoot), test.files,
        `${test.key}: all rejected-format files must remain unchanged after cold restart and shutdown`)
    }
    if (rejectedFormats) walk.report.rejectedFormatFilesUntouchedAfterShutdown = true
  } catch (error) {
    recordCandidateFailure(walk.report, 'final-preservation', error)
    failure = failure ? new AggregateError([failure, error], 'Journey and preservation checks failed') : error
  }
  await walk.finish(failure)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
