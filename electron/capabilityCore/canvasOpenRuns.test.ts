// Reviewer POST/crash and endless-provider reproductions, exercised against the real Run repository.
import { expect, it, vi } from 'vitest'
import { CANVAS_TEST_PROJECT as PROJECT, canvasTestRequest, setupCanvasShots } from './canvasShotTestUtils'
import { canvasRunIdFor } from '../productionRun/canvasShotRunIndex'
import type { CanvasTaskResult } from './canvasTransportProvider'
const queued = (): CanvasTaskResult => ({ id: 'accepted-task', kind: 'text_to_image', status: 'queued', assets: [], raw: {} })

it('F1: an interrupted POST becomes submission_unknown on project open', async () => {
  const h = setupCanvasShots()
  h.vendor.answer = () => new Promise(() => undefined)
  void h.submit('node-a', 'original')
  await vi.waitFor(() => expect(h.vendor.executes).toHaveLength(1))
  const restarted = setupCanvasShots({ root: h.root })
  restarted.runs.recoverOrphans(PROJECT)
  expect(restarted.repository.read(PROJECT, canvasRunIdFor('original'))?.jobs[0]).toMatchObject({ status: 'submission_unknown', errorCode: 'submission_unknown_restart' })
})
it('F2: a live POST survives renderer reload without becoming unknown', async () => {
  const h = setupCanvasShots()
  h.vendor.answer = () => new Promise(() => undefined)
  void h.submit('node-a', 'original')
  await vi.waitFor(() => expect(h.vendor.executes).toHaveLength(1))
  h.runs.releaseSender(h.senderId);h.runs.recoverOrphans(PROJECT)
  expect(h.repository.read(PROJECT, canvasRunIdFor('original'))?.jobs[0].status).toBe('submitting')
})
it('F4/F5: a user can acknowledge the exact open Run and send again while the provider stays running', async () => {
  const h = setupCanvasShots();h.vendor.answer = async () => queued()
  await h.submit('node-a', 'original')
  await expect(h.runs.submit({ projectId: PROJECT, nodeId: 'node-a', runRecordId: 'again', vendor: 'acme', request: canvasTestRequest('node-a'), gesture: h.gesture, senderId: h.senderId, acknowledgedOpenRuns: [canvasRunIdFor('original')] } as never)).resolves.toMatchObject({ status: 'queued' })
  expect(h.vendor.executes).toHaveLength(2)
  expect(h.observed).toContainEqual([PROJECT, canvasRunIdFor('original')])
})
it.each(['missing', 'wrong', 'machine', 'consented'] as const)('F9/F12: %s acknowledgement never authorizes another submit', async kind => {
  const h = setupCanvasShots();h.vendor.answer = async () => queued()
  await h.submit('node-a', 'original')
  if (kind === 'consented') h.consent([{ nodeId: 'node-a', runRecordId: 'again' }])
  await expect(h.runs.submit({ projectId: PROJECT, nodeId: 'node-a', runRecordId: 'again', vendor: 'acme', request: canvasTestRequest('node-a'), gesture: kind === 'machine' ? undefined : h.gesture, senderId: h.senderId, ...(kind === 'missing' ? {} : { acknowledgedOpenRuns: [kind === 'wrong' ? 'wrong' : canvasRunIdFor('original')] }) } as never)).rejects.toMatchObject({ code: 'node_generation_in_flight' })
  expect(h.vendor.executes).toHaveLength(1)
})

it('F2: polling a live POST without a provider task ID is free and reports running', async () => {
 const h = setupCanvasShots();h.vendor.answer = () => new Promise(() => undefined)
 void h.submit('node-a', 'original')
 await vi.waitFor(() => expect(h.vendor.executes).toHaveLength(1))
 await expect(h.runs.poll({ projectId: PROJECT, runRecordId: 'original', senderId: h.senderId })).resolves.toMatchObject({ status: 'running' })
 expect(h.vendor.executes).toHaveLength(1);expect(h.vendor.fetches).toHaveLength(0)
})
it('F9: the project query covers different nodes and every uncovered later Run still refuses stale consent', async () => {
 const h = setupCanvasShots();h.vendor.answer = async () => queued()
 await h.submit('node-a', 'original-a');await h.submit('node-b', 'original-b')
 expect(h.runs.canvasOpenRuns({ projectId: PROJECT }).map(entry => entry.nodeId).sort()).toEqual(['node-a', 'node-b'])
 await h.runs.submit({ projectId: PROJECT, nodeId: 'node-a', runRecordId: 'again-a', vendor: 'acme', request: canvasTestRequest('node-a'), gesture: h.gesture, senderId: h.senderId, acknowledgedOpenRuns: [canvasRunIdFor('original-a')] })
 await expect(h.runs.submit({ projectId: PROJECT, nodeId: 'node-a', runRecordId: 'stale-a', vendor: 'acme', request: canvasTestRequest('node-a'), gesture: h.gesture, senderId: h.senderId, acknowledgedOpenRuns: [canvasRunIdFor('original-a')] })).rejects.toMatchObject({ code: 'node_generation_in_flight' })
 expect(h.vendor.executes).toHaveLength(3)
})

import i18n from '../../src/i18n'
import { generationFailureActions } from '../../src/workbench/observability/generationFailureActions'
import fs from 'node:fs'
import path from 'node:path'
import { createProductionRunService } from '../productionRun/productionRunService'
it('F10: replay the actual v0.24.0 submitting Run and release it without another POST before user consent', async () => {
 const snapshot = path.resolve('tests/fixtures/old-user-data/runs/v0.24.0-canvas-interrupted')
 const manifest = JSON.parse(fs.readFileSync(path.join(snapshot, 'manifest.json'), 'utf8'))
 const oldNode = JSON.parse(fs.readFileSync(path.join(snapshot, 'node.json'), 'utf8'))
 expect(manifest.recordedFrom).toBe('9f3bb3c575058156690c0663a6c88a0b28dfa2a2')
 expect(oldNode.error).toContain('node_generation_in_flight')
 expect(generationFailureActions(oldNode.error, oldNode.runs[0])).toMatchObject({ kind: 'local-refusal', primary: 'release-regenerate', secondary: 'reconcile', reason: i18n.t('generationCommon.observability.error.submissionUnknown.reason'), hint: '' })
 const h = setupCanvasShots();fs.cpSync(path.join(snapshot, '.nomi'), path.join(h.root, '.nomi'), { recursive: true })
 expect(h.repository.read(PROJECT, manifest.runId)?.jobs[0].status).toBe('submitting')
 h.runs.recoverOrphans(PROJECT)
 const entry = h.runs.canvasOpenRuns({ projectId: PROJECT, nodeId: manifest.nodeId })[0]
 expect(entry).toMatchObject({ runId: manifest.runId, nodeId: manifest.nodeId, reason: 'needs_reconcile', hasTaskId: false })
 const run = h.repository.read(PROJECT, manifest.runId)!
 const service = createProductionRunService({ repository: h.repository, projectRootResolver: () => h.root })
 await service.command(PROJECT, manifest.runId, { commandId: 'upgrade-checked', expectedRevision: run.revision, type: 'job.reconcile', payload: { jobId: entry.jobId, outcome: 'user_checked_abandon' }, humanGesture: true, issuedAt: new Date().toISOString() })
 expect(h.vendor.executes).toHaveLength(0)
 await h.submit(manifest.nodeId, 'upgrade-send-again')
 expect(h.vendor.executes).toHaveLength(1)
})
