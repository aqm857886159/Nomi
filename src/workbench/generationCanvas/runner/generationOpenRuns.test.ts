import { withProjectAction } from '../../project/projectCanvasReadSurface'
import { recoverNodeResult } from './recoverTaskActions'
import { useWorkbenchStore } from '../../workbenchStore'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { confirmAndRunNode } from './generationRunController'
import { confirmAndRunPlan } from '../components/batchPlanPreview'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useGenerationQueueStore } from './generationQueueStore'
import { useSpendConfirmStore } from '../spend/spendConfirm'
import { continueUnknownSubmissionRelease, useUnknownSubmissionReleaseStore } from '../../production/releaseUnknownSubmission'
import { createProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import { encodeStructuredErrorMessage } from '../../../../electron/vendor/vendorHttp'
const calls = vi.hoisted(() => ({ poll: vi.fn(), open: vi.fn(), execute: vi.fn(), consent: vi.fn(), notify: vi.fn() }))
vi.mock('../../api/taskApi', () => ({ canvasOpenRuns: calls.open, pollCanvasShotRun: calls.poll, fetchWorkbenchTaskResultByVendor: vi.fn(), consentCanvasShots: calls.consent, withdrawCanvasShots: vi.fn(), releaseCanvasShotRun: vi.fn(async () => undefined) }))
vi.mock('./generationNodeExecutor', () => ({ generationNodeExecutor: calls.execute }))
vi.mock('./assetUploadConsent', async original => ({ ...await original<typeof import('./assetUploadConsent')>(), resolveAssetUploadConsent: async () => ({ allowed: true, needsConfirmation: false }) }))
vi.mock('./nodeModelHealth', () => ({ recordNodeModelFailure: vi.fn(), recordNodeModelSuccess: vi.fn() }))
vi.mock('../../../desktop/bridge', () => ({ getDesktopBridge: () => ({ projects: {} }) }))
vi.mock('../../../ui/notificationPolicy', async original => ({ ...await original<typeof import('../../../ui/notificationPolicy')>(), notify: calls.notify }))
let session: ReturnType<typeof createProjectSessionTestHarness>
const store = () => useGenerationCanvasStore.getState()
const add = (meta?: Record<string, unknown>) => {
 const node = store().addNode({ kind: 'image', prompt: 'same shot', meta })
 store().appendNodeRun(node.id, { id: 'original', status: 'recoverable', projectId: 'project-a' })
 store().setNodeStatus(node.id, 'recoverable')
 return node.id
}
beforeEach(async () => {
 vi.clearAllMocks(); calls.poll.mockReset(); calls.open.mockReset().mockResolvedValue([])
 calls.execute.mockReset().mockImplementation(async node => ({ id: 'result-' + node.id, type: 'image', url: 'https://fixture.invalid/image.png', createdAt: 1 }))
 calls.consent.mockReset().mockImplementation(async ({ shots }) => shots.map((shot: { runRecordId: string }) => 'canvas-' + shot.runRecordId))
 session = createProjectSessionTestHarness(); await session.open('project-a')
 store().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
 useGenerationQueueStore.setState({ entries: [], batches: {} }); useUnknownSubmissionReleaseStore.setState({ nodes: {} })
 vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(true)
})
afterEach(() => { session.dispose(); vi.restoreAllMocks() })
it('F3/F12: opening confirmation changes neither the original runs nor the free recovery state', async () => {
 const id = add(); const before = structuredClone(store().nodes.find(node => node.id === id)!)
 calls.open.mockResolvedValue([{ nodeId: id, runId: 'canvas-original', reason: 'in_flight', hasTaskId: false }])
 await confirmAndRunNode(id, { initiator: 'user' })
 expect(calls.execute).not.toHaveBeenCalled()
 expect(store().nodes.find(node => node.id === id)).toEqual(before)
 expect(useUnknownSubmissionReleaseStore.getState().nodes[id]).toEqual({ confirming: true, busy: false, failed: false })
})
it('F4: continuation still sends when the host reports that the old Run has already finished', async () => {
 const id = add()
 await continueUnknownSubmissionRelease(id)
 expect(calls.execute).toHaveBeenCalledOnce()
 expect(store().nodes.find(node => node.id === id)?.status).toBe('success')
})
it('F9: Agent acknowledgements do not bypass an open request', async () => {
 const id = add();const runs = structuredClone(store().nodes.find(node => node.id === id)?.runs)
 calls.open.mockResolvedValue([{ nodeId: id, runId: 'canvas-original', reason: 'in_flight', hasTaskId: true }])
 await expect(confirmAndRunNode(id, { initiator: 'agent', acknowledgedOpenRuns: ['canvas-original'] })).rejects.toMatchObject({ code: 'node_generation_in_flight' })
 expect(calls.execute).not.toHaveBeenCalled();expect(store().nodes.find(node => node.id === id)?.runs).toEqual(runs)
})
it('F6: batch confirmation excludes every open target, including cost rows and consent', async () => {
 const id = add();const other = store().addNode({ kind: 'image', prompt: 'other' }).id
 calls.open.mockImplementation(async ({ nodeId }) => nodeId === other ? [] : [{ nodeId: id, runId: 'canvas-original', reason: 'in_flight', hasTaskId: false }])
 await confirmAndRunPlan({ waves: [[id, other]], edgesUsed: [], blocked: [] }, { initiator: 'user' })
 expect(calls.consent.mock.calls[0][0].shots.map((shot: { nodeId: string }) => shot.nodeId)).toEqual([other])
 expect(calls.execute.mock.calls.map(([node]) => node.id)).toEqual([other])
 expect(calls.notify.mock.calls.some(([note]) => note.reason === 'generation-failed')).toBe(false)
 expect(calls.notify.mock.calls.find(([note]) => note.reason === 'generation-skipped')?.[0]).toMatchObject({ type: 'info' })
})
it('F8: two clicks while preflight is still pending produce one new intent', async () => {
 const id = add(); let release!: (value: never[]) => void
 calls.open.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
 const first = confirmAndRunNode(id, { initiator: 'user' });const second = confirmAndRunNode(id, { initiator: 'user' })
 release([]);await Promise.all([first, second]);expect(calls.execute).toHaveBeenCalledOnce()
})
it('F12: a host admission race withdraws the refused record and restores recovery before asking', async () => {
 const id = add();const runs = structuredClone(store().nodes.find(node => node.id === id)?.runs)
 calls.open.mockResolvedValueOnce([]).mockResolvedValue([{ nodeId: id, runId: 'canvas-original', reason: 'in_flight', hasTaskId: true }])
 calls.execute.mockRejectedValueOnce(new Error(encodeStructuredErrorMessage({ code: 'node_generation_in_flight', reason: 'in_flight' }, 'node_generation_in_flight')))
 await confirmAndRunNode(id, { initiator: 'user' })
 const node = store().nodes.find(value => value.id === id)!
 expect(node.runs).toEqual(runs);expect(node.status).toBe('recoverable');expect(node.error).toBeUndefined()
 expect(useGenerationQueueStore.getState().entries.every(entry => entry.state === 'cancelled')).toBe(true)
 expect(useUnknownSubmissionReleaseStore.getState().nodes[id].confirming).toBe(true)
})

it.each(['in_flight', 'needs_reconcile'] as const)('F12: repairing a stale running card for %s does not rewrite the original record', async reason => {
 const id = add();store().setNodeStatus(id, 'running')
 const runs = structuredClone(store().nodes.find(node => node.id === id)?.runs)
 calls.open.mockResolvedValue([{ nodeId: id, runId: 'canvas-original', reason, hasTaskId: false }])
 await confirmAndRunNode(id, { initiator: 'user' })
 expect(store().nodes.find(node => node.id === id)?.runs).toEqual(runs)
 expect(store().nodes.find(node => node.id === id)?.status).toBe(reason === 'in_flight' ? 'recoverable' : 'error')
 expect(calls.execute).not.toHaveBeenCalled()
 expect(useUnknownSubmissionReleaseStore.getState().nodes[id].confirming).toBe(true)
})

it('F4: late result after acknowledged resend changes neither the current card nor its timeline', async () => {
 const id = add()
 const timeline = vi.spyOn(useWorkbenchStore.getState(), 'reconcileTimelineForUpdatedNodes').mockImplementation(() => undefined)
 let finish!: (value: unknown) => void
 calls.execute.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
 const old = confirmAndRunNode(id, { initiator: 'user' })
 await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledOnce())
 calls.open.mockResolvedValue([{ nodeId: id, runId: 'old-host-run', reason: 'in_flight', hasTaskId: true }])
 await confirmAndRunNode(id, { initiator: 'user', acknowledgedOpenRuns: ['old-host-run'] })
 const current = store().nodes.find(node => node.id === id)!.result!
 finish({ id: 'late-old-result', type: 'image', url: 'https://fixture.invalid/old.png', createdAt: 1 })
 await old
 expect(store().nodes.find(node => node.id === id)?.result?.id).toBe(current.id)
 expect(timeline.mock.calls.map(([, result]) => result?.id)).toEqual([current.id])
})

it.each(['success', 'failed', 'query-error', 'running'] as const)('F4: outstanding free query cannot overwrite a later acknowledged result or its status (%s)', async outcome => {
 const id = add({ vendor: 'acme', modelVendor: 'acme', modelKey: 'img-model' })
 let finish!: (value: unknown) => void
 calls.poll.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = outcome === 'query-error' ? reject : resolve })).mockResolvedValueOnce(null)
 const retrieval = recoverNodeResult(id, withProjectAction(project => project)!)
 await vi.waitFor(() => expect(calls.poll).toHaveBeenCalledOnce())
 calls.open.mockResolvedValue([{ nodeId: id, runId: 'old-host-run', reason: 'in_flight', hasTaskId: true }])
 await confirmAndRunNode(id, { initiator: 'user', acknowledgedOpenRuns: ['old-host-run'] })
 const current = store().nodes.find(node => node.id === id)!.result!
 finish(outcome === 'query-error' ? new Error('old query failed') : { id: 'old-task', kind: 'text_to_image', status: outcome === 'success' ? 'succeeded' : outcome, assets: [{ type: 'image', url: 'nomi-local://asset/project-a/assets/old.png' }], raw: {} })
 await retrieval
 expect(store().nodes.find(node => node.id === id)?.result?.id).toBe(current.id)
 expect(store().nodes.find(node => node.id === id)?.status).toBe('success')
})
