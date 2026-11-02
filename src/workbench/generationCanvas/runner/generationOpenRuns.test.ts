import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { confirmAndRunNode } from './generationRunController'
import { confirmAndRunPlan } from '../components/batchPlanPreview'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useGenerationQueueStore } from './generationQueueStore'
import { useSpendConfirmStore } from '../spend/spendConfirm'
import { continueUnknownSubmissionRelease, useUnknownSubmissionReleaseStore } from '../../production/releaseUnknownSubmission'
import { createProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import { encodeStructuredErrorMessage } from '../../../../electron/vendor/vendorHttp'
const calls = vi.hoisted(() => ({ open: vi.fn(), execute: vi.fn(), consent: vi.fn(), notify: vi.fn() }))
vi.mock('../../api/taskApi', () => ({ canvasOpenRuns: calls.open, consentCanvasShots: calls.consent, withdrawCanvasShots: vi.fn(), releaseCanvasShotRun: vi.fn(async () => undefined) }))
vi.mock('./generationNodeExecutor', () => ({ generationNodeExecutor: calls.execute }))
vi.mock('./assetUploadConsent', async original => ({ ...await original<typeof import('./assetUploadConsent')>(), resolveAssetUploadConsent: async () => ({ allowed: true, needsConfirmation: false }) }))
vi.mock('./nodeModelHealth', () => ({ recordNodeModelFailure: vi.fn(), recordNodeModelSuccess: vi.fn() }))
vi.mock('../../../desktop/bridge', () => ({ getDesktopBridge: () => ({ projects: {} }) }))
vi.mock('../../../ui/notificationPolicy', async original => ({ ...await original<typeof import('../../../ui/notificationPolicy')>(), notify: calls.notify }))
let session: ReturnType<typeof createProjectSessionTestHarness>
const store = () => useGenerationCanvasStore.getState()
const add = () => {
 const node = store().addNode({ kind: 'image', prompt: 'same shot' })
 store().appendNodeRun(node.id, { id: 'original', status: 'recoverable', projectId: 'project-a' })
 store().setNodeStatus(node.id, 'recoverable')
 return node.id
}
beforeEach(async () => {
 vi.clearAllMocks(); calls.open.mockReset().mockResolvedValue([])
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
