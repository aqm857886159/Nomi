import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { confirmAndRunNode } from './generationRunController'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useGenerationQueueStore } from './generationQueueStore'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import { useSpendConfirmStore } from '../spend/spendConfirm'
import type { GenerationNodeResult } from '../model/generationCanvasTypes'
import { type WorkbenchProjectRecordV1 } from '../../project/projectRecordSchema'

const calls = vi.hoisted(() => ({ execute: vi.fn(), disk: new Map<string, WorkbenchProjectRecordV1>(), confirm: vi.fn(), mint: vi.fn(), consent: vi.fn(), unknown: vi.fn() }))
const applyCanvasNodePatch = vi.hoisted(() => vi.fn())
vi.mock('../../../desktop/bridge', () => ({
  getDesktopBridge: () => ({ projects: { applyCanvasNodePatch } }),
}))
vi.mock('../../library/localProjectStore', () => ({
  readLocalProjectAsync: async (id: string) => structuredClone(calls.disk.get(id) ?? null),
  saveLocalProject: async (id: string, payload: WorkbenchProjectRecordV1['payload'], name: string) => {
    const record = { ...calls.disk.get(id), id, name, version: 1 as const, payload } as WorkbenchProjectRecordV1
    calls.disk.set(id, structuredClone(record))
    return record
  },
}))
vi.mock('../../api/taskApi', () => ({ canvasUnknownRuns: calls.unknown, mintSpendGrant: calls.mint, consentCanvasShots: calls.consent, withdrawCanvasShots: vi.fn(), releaseCanvasShotRun: vi.fn(async () => undefined) }))
vi.mock('./generationNodeExecutor', () => ({ generationNodeExecutor: calls.execute }))
vi.mock('./assetUploadConsent', async original => ({ ...await original<typeof import('./assetUploadConsent')>(), resolveAssetUploadConsent: async () => ({ allowed: true, needsConfirmation: false }) }))

let session: ProjectSessionTestHarness
beforeEach(() => {
  vi.clearAllMocks()
  calls.disk.clear()
  applyCanvasNodePatch.mockReset().mockImplementation(async ({ projectId, nodeId, patch }: {
    projectId: string
    nodeId: string
    patch: Record<string, unknown>
  }) => {
    const record = calls.disk.get(projectId)
    if (!record) return { applied: false }
    const canvas = record.payload.generationCanvas
    const nodes = canvas.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node)
    calls.disk.set(projectId, structuredClone({ ...record, payload: { ...record.payload, generationCanvas: { ...canvas, nodes } } }))
    return { applied: true }
  })
  calls.confirm.mockReset().mockResolvedValue(true)
  calls.execute.mockReset()
  vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockImplementation(calls.confirm)
  calls.mint.mockReset().mockResolvedValue('approved-three')
  calls.consent.mockReset().mockImplementation(async (input: { shots: Array<{ runRecordId: string }> }) => input.shots.map((shot) => `canvas-${shot.runRecordId}`))
  session = createProjectSessionTestHarness()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
  useGenerationQueueStore.setState({ entries: [], batches: {} })
})
afterEach(() => { session.dispose(); vi.restoreAllMocks() })


import { runGenerationNode } from './generationRunController'
import { runGenerationNodesByPlan } from './generationRunWaves'
import { encodeStructuredErrorMessage } from '../../../../electron/vendor/vendorHttp'
import { recordNodeModelFailure } from './nodeModelHealth'
import { withdrawCanvasShots } from '../../api/taskApi'
vi.mock('./nodeModelHealth', () => ({ recordNodeModelFailure: vi.fn(), recordNodeModelSuccess: vi.fn() }))

const imageResult = (id: string): GenerationNodeResult => ({ id: 'result-' + id, type: 'image', url: 'https://fixture.invalid/' + id + '.png', createdAt: 1 })
it.each(['quota', 'local-refusal', 'server'])('A1/A2/A3: %s uses the correct brake and model-health policy at the shared runner', async kind => {
  const target = await session.open('project-a')
  const nodes = Array.from({ length: 8 }, (_, i) => useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'fixture ' + i }))
  const message = kind === 'quota' ? '429 concurrency limit exceeded' : kind === 'server' ? '500 Internal Server Error' : encodeStructuredErrorMessage({ code: 'node_generation_in_flight' }, 'node_generation_in_flight')
  calls.execute.mockImplementation(async node => {
    if (nodes.slice(0, 4).some(n => n.id === node.id)) throw new Error(message)
    return imageResult(node.id)
  })
  let observedPause = false
  const unsubscribe = useGenerationQueueStore.subscribe(state => {
    const paused = Object.values(state.batches).find(b => b.paused)
    if (paused) { observedPause = true; state.cancelBatchRemaining(paused.id) }
  })
  try {
    await runGenerationNodesByPlan({ waves: [nodes.map(n => n.id)], edgesUsed: [], blocked: [] }, { target, concurrency: kind === 'server' ? 1 : 6, retry: { maxAttempts: 1 }, assetUploadConsent: 'not-needed' })
    expect(observedPause).toBe(kind === 'server')
    if (kind !== 'server') expect(calls.execute).toHaveBeenCalledTimes(8)
    if (kind === 'local-refusal') expect(recordNodeModelFailure).not.toHaveBeenCalled()
  } finally { unsubscribe() }
})
it.each([false, true])('B3: a single generation takes the node out of another queued batch (paused=%s)', async paused => {
  const target = await session.open('project-a')
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'queued once' })
  const queue = useGenerationQueueStore.getState()
  const batch = queue.enqueueBatch([[node.id]], target.projectId)
  queue.attachCanvasConsent(batch, new Map([[node.id, 'original-offer']]))
  if (paused) useGenerationQueueStore.setState(state => ({ batches: { ...state.batches, [batch]: { ...state.batches[batch], paused: true } } }))
  calls.execute.mockImplementation(async node => imageResult(node.id))
  await runGenerationNode(node.id, { target, assetUploadConsent: 'not-needed', retry: { maxAttempts: 1 } })
  expect(useGenerationQueueStore.getState().entries.find(e => e.batchId === batch)?.state).toBe('cancelled')
  expect(withdrawCanvasShots).toHaveBeenCalledWith({ projectId: target.projectId, runRecordIds: ['original-offer'], by: 'removed' })
  expect(calls.execute).toHaveBeenCalledOnce()
})


import { releaseUnknownCanvasSubmissionsForNode } from '../../production/releaseUnknownSubmission'

it('C2: a refused second click stays in history while the host-selected original Run is released and regenerated', async () => {
  await session.open('project-a')
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'unconfirmed shot' })
  calls.execute.mockRejectedValueOnce(new Error('NOMI_ERR::submission-unknown::The provider did not confirm this submission'))
  await confirmAndRunNode(node.id, { initiator: 'user' })
  const original = useGenerationCanvasStore.getState().nodes.find(n => n.id === node.id)!.runs![0].id
  calls.execute.mockRejectedValueOnce(new Error(encodeStructuredErrorMessage({ code: 'production_shot_claimed', reason: 'needs_reconcile' }, 'production_shot_claimed: needs_reconcile')))
  await confirmAndRunNode(node.id, { initiator: 'user' })
  const history = structuredClone(useGenerationCanvasStore.getState().nodes.find(n => n.id === node.id)!.runs!)
  expect(history[0].id).not.toBe(original)
  calls.unknown.mockResolvedValue([{ runId: 'canvas-' + original, jobId: 'original-job' }])
  const command = vi.fn(async () => ({ run: { runId: 'canvas-' + original, projectId: 'project-a', revision: 2, jobs: [] }, events: [] }))
  await releaseUnknownCanvasSubmissionsForNode('project-a', node.id, {
    read: async (_project: string, runId: string) => runId === 'canvas-' + original ? { runId, projectId: 'project-a', revision: 1, jobs: [] } : null,
    command,
  } as never)
  expect(command.mock.calls[0]).toMatchObject(['project-a', 'canvas-' + original, { payload: { jobId: 'original-job', outcome: 'user_checked_abandon' } }])
  expect(useGenerationCanvasStore.getState().nodes.find(n => n.id === node.id)!.runs).toEqual(history)
  calls.execute.mockImplementation(async n => imageResult(n.id))
  await confirmAndRunNode(node.id, { initiator: 'user' })
  const done = useGenerationCanvasStore.getState().nodes.find(n => n.id === node.id)!
  expect(done.status).toBe('success')
  expect(done.runs!.some(run => run.id === history[0].id)).toBe(true)
})


it('B2: retrying a failed card while its batch is paused does not resubmit it when the batch resumes', async () => {
  const target = await session.open('project-a')
  const nodes = Array.from({ length: 4 }, (_, index) => useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'paused ' + index }))
  calls.execute.mockRejectedValue(new Error('500 Internal Server Error'))
  let paused!: (id: string) => void
  const pause = new Promise<string>(resolve => { paused = resolve })
  const unsubscribe = useGenerationQueueStore.subscribe(state => {
    const batch = Object.values(state.batches).find(value => value.paused)
    if (batch) paused(batch.id)
  })
  const running = runGenerationNodesByPlan({ waves: [nodes.map(node => node.id)], edgesUsed: [], blocked: [] },
    { target, concurrency: 1, retry: { maxAttempts: 1 }, assetUploadConsent: 'not-needed' })
  const batchId = await pause
  try {
    calls.execute.mockImplementation(async node => imageResult(node.id))
    await confirmAndRunNode(nodes[0].id, { initiator: 'user' })
    expect(useGenerationQueueStore.getState().batches[batchId].paused).toBe(true)
    useGenerationQueueStore.getState().resumeBatch(batchId)
    await running
    expect(calls.execute).toHaveBeenCalledTimes(5)
    expect(calls.execute.mock.calls.filter(([node]) => node.id === nodes[0].id)).toHaveLength(2)
    expect(calls.execute.mock.calls.filter(([node]) => node.id === nodes[3].id)).toHaveLength(1)
  } finally {
    unsubscribe()
    useGenerationQueueStore.getState().cancelBatchRemaining(batchId)
    await running
  }
})
