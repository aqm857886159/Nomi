// Candidate-only compatibility fixtures. These are synthetic old field shapes
// over a COPY of historical project content, not claimed historical v1 projects.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { require as tsxRequire } from 'tsx/cjs/api'
import { expect, screenshotSettled } from './_assert.mjs'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'

const { productionRunsRoot } = tsxRequire('../../electron/productionRun/productionRunPaths.ts', import.meta.url)

export function writeOldStoryboardShape(copy, shape) {
  const record = structuredClone(copy.original)
  const payload = record.payload
  const { design } = copy
  const legacyKeys = { map: 'storyboardPlans', single: 'storyboardPlan', committed: 'storyboardPlanCommitted' }
  for (const key of Object.values(legacyKeys)) delete payload[key]
  payload.activeDocumentId = design.documentId
  if (shape === 'retired-map') {
    delete payload.storyboardDesignsByDocumentId
    payload[legacyKeys.map] = { [design.documentId]: { plan: design.plan, committed: design.committed } }
  } else if (shape === 'retired-single') {
    delete payload.storyboardDesignsByDocumentId
    payload[legacyKeys.single] = design.plan
    payload[legacyKeys.committed] = design.committed
  } else {
    assert.equal(shape, 'owner-with-conflicting-retired-map')
    const conflicting = structuredClone(design.plan)
    conflicting.title = 'C18 retired title must not replace current owner'
    conflicting.shots[0].prompt = 'C18 retired prompt must not replace current owner'
    payload[legacyKeys.map] = { [design.documentId]: { plan: conflicting, committed: !design.committed } }
  }
  const bytes = `${JSON.stringify(record, null, 2)}\n`
  fs.writeFileSync(path.join(copy.copyRoot, copy.manifest), bytes)
  // A coherent source+backup fixture avoids accidentally testing backup recovery.
  fs.writeFileSync(path.join(copy.copyRoot, '.nomi/project.backup.json'), bytes)
  return { record, legacyKeys, design: { ...design,
    id: shape === 'owner-with-conflicting-retired-map' ? design.id : `migrated-${design.documentId}` } }
}

export async function runOldStoryboardFormatMatrix({ source, outputDir, prepareOldProjectCopy,
  openCopiedStoryboardEditor, assertCanvasPreserved, assertNoHydratedCanvasAddition, editedCanvasExpectation, readCardInfoMeasurements, recordCandidateFailure, fileHashes }) {
  const reports = []
  for (const shape of ['retired-map', 'retired-single', 'owner-with-conflicting-retired-map']) {
    const walk = await createRuntimeWalk(`core-a-old-storyboard-${shape}`)
    const caseOutput = path.join(outputDir, 'old-storyboard-formats', shape)
    assert(!fs.existsSync(caseOutput), 'Never overwrite old-format evidence')
    fs.mkdirSync(caseOutput, { recursive: true })
    walk.report.outputDir = caseOutput
    walk.report.fixtureBoundary = 'Synthetic retired storyboard field shape over an exact historical project copy; original ids/assets retained'
    walk.report.shape = shape
    let copy, win, failure, runFiles, runsBefore, verifyFinalGraph
    try {
      copy = prepareOldProjectCopy(source, path.join(walk.report.tempRoot, 'projects'))
      const fixture = writeOldStoryboardShape(copy, shape)
      walk.report.fixtureFiles = fileHashes(copy.copyRoot)
      walk.report.source = { root: copy.sourceRoot, files: copy.sourceHashes }
      const runsRoot = productionRunsRoot(copy.copyRoot)
      runFiles = () => fs.existsSync(runsRoot) ? fileHashes(runsRoot) : {}
      runsBefore = runFiles()
      const readCopy = () => JSON.parse(fs.readFileSync(path.join(copy.copyRoot, copy.manifest), 'utf8'))
      const readSavedDesign = () => readCopy().payload.storyboardDesignsByDocumentId?.[fixture.design.documentId]
        ?.find(item => item.id === fixture.design.id)
      const snap = async label => {
        const file = path.join(caseOutput, `${label}.png`)
        await screenshotSettled(win, { path: file })
        walk.report.screenshots.push(file)
      }
      const open = () => openCopiedStoryboardEditor(win, { original: copy.original, design: fixture.design, copyRoot: copy.copyRoot })
      const shot = fixture.design.plan.shots.find(item => !item.prompt.includes('@['))
      assert(shot)
      const expectedPlan = structuredClone(fixture.design.plan)
      const editedPrompt = `${shot.prompt} C18 ${shape} saved.`
      Object.assign(expectedPlan.shots.find(item => item.index === shot.index), { prompt: editedPrompt, promptSegments: [] })
      const originalCanvas = copy.original.payload.generationCanvas
      const expectedCanvas = editedCanvasExpectation(originalCanvas, fixture.design, expectedPlan, shot)
      const retired = shape !== 'owner-with-conflicting-retired-map'
      assert.equal(expectedCanvas.nodes.filter((node, index) => node.prompt !== originalCanvas.nodes[index].prompt).length, retired ? 0 : 1)
      let measurements = {}
      ;({ win } = await walk.start({ first: true }))
      let editor = await open()
      await expect(editor.getByRole('textbox', { name: '方案标题', exact: true })).toHaveValue(fixture.design.plan.title)
      const prompt = () => editor.locator(`[data-storyboard-row="${shot.index}"] [data-storyboard-prompt-block] [contenteditable="true"]`).first()
      await expect(prompt()).toHaveText(shot.prompt)
      assert.deepEqual(runFiles(), runsBefore, 'Reading old storyboard fields must not create or rewrite any Run')
      await snap('original-editor-before-edit')
      measurements = await readCardInfoMeasurements(win, originalCanvas)
      ;(walk.report.cardInfoMeasurements ??= []).push(structuredClone(measurements))
      assertCanvasPreserved(readCopy().payload.generationCanvas, originalCanvas, measurements, { beforeEdit: true })
      await assertNoHydratedCanvasAddition(win, originalCanvas)
      walk.report.beforeEditPersistedGraphAndMountedIdsPreserved = true
      await prompt().fill(editedPrompt)
      await expect.poll(() => readSavedDesign()?.plan?.shots.find(item => item.index === shot.index)?.prompt).toBe(editedPrompt)
      // 显式编辑旧方案不再长出任何分镜表节点（0.24 退役）：画布节点数不变，由下面的 assertCanvasPreserved 钉住。
      const assertSaved = () => {
        assert.deepEqual(readSavedDesign().plan, expectedPlan, 'Only the explicit prompt edit changes the complete original plan')
        assert.equal(readSavedDesign().documentId, fixture.design.documentId)
        assert.equal(readSavedDesign().committed, false, 'Original edits return the design to draft')
        assert.equal(readSavedDesign().status, 'draft')
        // Existing normalizePayload/captureWorkbenchProjectPayload persist only
        // the current owner. Do not demand retired fields remain writable.
        for (const key of Object.values(fixture.legacyKeys)) {
          assert(!Object.hasOwn(readCopy().payload, key), `Saved payload must not double-write retired ${key}`)
        }
        if (shape === 'owner-with-conflicting-retired-map') {
          for (const designs of Object.values(copy.original.payload.storyboardDesignsByDocumentId)) {
            for (const design of designs) {
              if (design.id === fixture.design.id) continue
              assert.deepEqual(readCopy().payload.storyboardDesignsByDocumentId[design.documentId].find(item => item.id === design.id), design,
                'Editing the selected owner must preserve every sibling design')
            }
          }
        }
        assertCanvasPreserved(readCopy().payload.generationCanvas, expectedCanvas, measurements)
        assert.deepEqual(runFiles(), runsBefore, 'Old editor saves must not create or rewrite any Run')
      }
      measurements = await readCardInfoMeasurements(win, originalCanvas)
      ;(walk.report.cardInfoMeasurements ??= []).push(structuredClone(measurements))
      assertSaved()
      verifyFinalGraph = assertSaved
      await snap('saved-original-owner')
      await walk.stopApp()
      ;({ win } = await walk.start())
      assert.notEqual(walk.report.launches[0].pid, walk.report.launches[1].pid)
      editor = await open()
      await expect(prompt()).toHaveText(editedPrompt)
      await expect(editor.getByRole('textbox', { name: '方案标题', exact: true })).toHaveValue(expectedPlan.title)
      measurements = await readCardInfoMeasurements(win, originalCanvas)
      ;(walk.report.cardInfoMeasurements ??= []).push(structuredClone(measurements))
      assertSaved()
      verifyFinalGraph = assertSaved
      await snap('cold-restored-original-owner')
      assert.equal(walk.fixture.requests.length, 0, 'Compatibility reading/editing must not request an Agent')
      assert.equal(walk.fixture.images.length, 0, 'Compatibility reading/editing must not generate media')
      walk.report.checks = { originalEditor: true, correctOwner: true, completePlanSaved: true,
        retiredFieldsNotWritten: true, noRunCreationOrMutation: true, coldRestart: true }
    } catch (error) {
      recordCandidateFailure(walk.report, 'journey', error)
      failure = error
      if (win && !win.isClosed()) await win.screenshot({ path: path.join(caseOutput, 'FAIL.png') }).catch(captureError => console.error(captureError.message))
    }
    try {
      await walk.stopApp()
      assert.equal(walk.fixture.requests.length, 0, 'Final shutdown must not request an Agent')
      assert.equal(walk.fixture.images.length, 0, 'Final shutdown must not generate media')
      if (verifyFinalGraph) verifyFinalGraph()
      if (runFiles) assert.deepEqual(runFiles(), runsBefore, 'Final shutdown must not create or rewrite any Run')
      if (copy) {
        assert.deepEqual(fileHashes(copy.sourceRoot), copy.sourceHashes, 'Historical source must remain untouched')
        walk.report.sourceUntouched = true
        walk.report.finalCopyFiles = fileHashes(copy.copyRoot)
      }
    } catch (error) {
      recordCandidateFailure(walk.report, 'final-preservation', error)
      failure = failure ? new AggregateError([failure, error], 'Old-format checks and source preservation failed') : error
    }
    await walk.finish(failure)
    if (walk.report.result !== 'passed') throw failure ?? new Error(`Old-format finalization failed: ${shape}; see ${caseOutput}/report.json`)
    reports.push({ shape, report: path.join(caseOutput, 'report.json'), screenshots: walk.report.screenshots })
  }
  return reports
}
