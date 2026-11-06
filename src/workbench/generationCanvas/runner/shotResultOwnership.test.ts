// 镜头结果归谁（设计卡 docs/plan/2026-11-07-shot-result-ownership.md ★9 第 2 条的特征矩阵）。
//
// 创作者那一刻：同一镜从画布生成框和分镜表几乎同时点了生成，后发那下被主进程拒了；先发那次付了钱的图
// 必须落到这一镜上、镜头不能一直「生成中」、取消能停、能再生成，被拒那下不多下单。
// 每格断言四件事：结果在不在、记在哪条运行记录、下了几单、终态能不能动手（不忙 + 再生成一次真的跑）。
// 「几乎同时」靠压住执行器的回话造出来，不靠手速；主进程的拒绝用它真实的结构化错误码。
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import type { GenerationNodeExecutorContext } from './generationNodeExecutor'
import type { WorkbenchProjectRecordV1 } from '../../project/projectRecordSchema'

const calls = vi.hoisted(() => ({ execute: vi.fn(), open: vi.fn(), confirm: vi.fn(), disk: new Map<string, unknown>() }))
vi.mock('../../api/taskApi', () => ({
  canvasOpenRuns: calls.open, releaseCanvasShotRun: vi.fn(async () => undefined), withdrawCanvasShots: vi.fn(),
  pollCanvasShotRun: vi.fn(), consentCanvasShots: vi.fn(), mintSpendGrant: vi.fn(), fetchWorkbenchTaskResultByVendor: vi.fn(),
}))
vi.mock('./generationNodeExecutor', () => ({ generationNodeExecutor: calls.execute }))
vi.mock('./assetUploadConsent', async (original) => ({ ...await original<typeof import('./assetUploadConsent')>(), resolveAssetUploadConsent: async () => ({ allowed: true, needsConfirmation: false }) }))
vi.mock('./nodeModelHealth', () => ({ recordNodeModelFailure: vi.fn(), recordNodeModelSuccess: vi.fn() }))
vi.mock('../../library/localProjectStore', () => ({
  readLocalProjectAsync: vi.fn(async (projectId: string) => structuredClone(calls.disk.get(projectId) ?? null)),
  saveLocalProject: vi.fn(async () => null),
}))
vi.mock('../../../desktop/bridge', () => ({
  getDesktopBridge: () => ({ projects: {
    applyCanvasNodePatch: async ({ projectId, nodeId, patch }: { projectId: string; nodeId: string; patch: Record<string, unknown> }) => {
      const record = calls.disk.get(projectId) as WorkbenchProjectRecordV1 | undefined
      if (!record) return { applied: false }
      record.payload.generationCanvas.nodes = record.payload.generationCanvas.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node)
      calls.disk.set(projectId, structuredClone(record))
      return { applied: true }
    },
  } }),
}))

import { confirmAndRunNode, regenerateNodeInPlace, runGenerationNodesBatch } from './generationRunController'
import { deliverRunOutcome } from './runProjectDelivery'
import { requestTaskCancel, LocalTaskCancelledError } from './localTaskControl'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useGenerationQueueStore } from './generationQueueStore'
import { useSpendConfirmStore } from '../spend/spendConfirm'
import { useWorkbenchStore } from '../../workbenchStore'
import { isGenerationNodeBusy } from '../components/canvasProductionScope'
import { attachShotResult } from '../../capability/multiShotCanvasLanding'
import { setCanvasEventSinkForTests } from '../events/canvasEventEmitter'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'
import { createProjectSessionTestHarness, testProjectBinding, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import { encodeStructuredErrorMessage } from '../../../../electron/vendor/vendorHttp'

type Attempt = { runId: string; ctx: GenerationNodeExecutorContext; resolve: (result: GenerationNodeResult) => void; reject: (error: unknown) => void }
let attempts: Attempt[] = []
let session: ProjectSessionTestHarness
let timeline: ReturnType<typeof vi.spyOn>

const store = () => useGenerationCanvasStore.getState()
const live = (id: string) => store().nodes.find((node) => node.id === id)
const image = (id: string): GenerationNodeResult => ({ id, type: 'image', url: `nomi-local://asset/project-a/${id}.png`, createdAt: 1 })
const refused = () => new Error(encodeStructuredErrorMessage({ code: 'node_generation_in_flight', reason: 'in_flight' }, 'node_generation_in_flight'))
const results = (node: GenerationCanvasNode | undefined) => [node?.result, ...(node?.history ?? [])].filter(Boolean).map((entry) => entry!.id)
const record = (node: GenerationCanvasNode | undefined, runId: string) => node?.runs?.find((run) => run.id === runId)

function persistOpenCanvasAs(projectId: string): void {
  const state = store()
  const binding = testProjectBinding(projectId)
  calls.disk.set(projectId, structuredClone({ id: projectId, name: projectId, version: 1, immutableProjectUuid: binding.immutableProjectUuid, projectGeneration: binding.projectGeneration,
    payload: { generationCanvas: { nodes: state.nodes, edges: state.edges, groups: state.groups, selectedNodeIds: [] } } }))
}
const diskNode = (projectId: string, nodeId: string) => (calls.disk.get(projectId) as WorkbenchProjectRecordV1 | undefined)?.payload.generationCanvas.nodes.find((node) => node.id === nodeId)

async function nextAttempt(count: number): Promise<Attempt> {
  await vi.waitFor(() => expect(attempts.length).toBeGreaterThanOrEqual(count))
  return attempts[count - 1]
}

/** 终态能动手：不忙，再点一次生成真的下一单、出图、成功。 */
async function assertActionable(id: string): Promise<void> {
  expect(isGenerationNodeBusy(live(id))).toBe(false)
  calls.open.mockResolvedValue([])
  const before = attempts.length
  const again = confirmAndRunNode(id, { initiator: 'user' })
  const attempt = await nextAttempt(before + 1)
  attempt.resolve(image(`again-${before}`))
  expect(await again).toBe('started')
  expect(live(id)).toMatchObject({ status: 'success', result: { id: `again-${before}` } })
  expect(record(live(id), attempt.runId)).toMatchObject({ status: 'success', resultId: `again-${before}` })
}

beforeEach(async () => {
  vi.clearAllMocks()
  calls.disk.clear()
  attempts = []
  calls.execute.mockReset().mockImplementation((_node: GenerationCanvasNode, ctx: GenerationNodeExecutorContext) => new Promise<GenerationNodeResult>((resolve, reject) => {
    attempts.push({ runId: String(ctx.idempotencyKey), ctx, resolve, reject })
  }))
  calls.open.mockReset().mockResolvedValue([])
  calls.confirm.mockReset().mockResolvedValue(true)
  vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockImplementation(calls.confirm)
  timeline = vi.spyOn(useWorkbenchStore.getState(), 'reconcileTimelineForUpdatedNodes').mockImplementation(() => undefined)
  session = createProjectSessionTestHarness()
  await session.open('project-a')
  store().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
  useGenerationQueueStore.setState({ entries: [], batches: {} })
  __resetCanvasUndoJournalForTests()
  setCanvasEventSinkForTests(() => {})
})
afterEach(() => { setCanvasEventSinkForTests(null); session.dispose(); vi.restoreAllMocks() })

describe('two entries click the same shot almost together; the later click is refused by the main process', () => {
  const cells = [
    ['success-first', 'foreground', 'confirm'], ['success-first', 'foreground', 'cancel'],
    ['refused-first', 'foreground', 'confirm'], ['refused-first', 'foreground', 'cancel'],
    ['success-first', 'background', 'cancel'], ['refused-first', 'background', 'cancel'],
  ] as const
  it.each(cells)('%s · %s · resend card answered %s', async (order, where, answer) => {
    const id = store().addNode({ kind: 'image', prompt: 'shot 1' }).id
    const canvas = confirmAndRunNode(id, { initiator: 'user' })
    const A = await nextAttempt(1)
    const storyboard = regenerateNodeInPlace(id, { initiator: 'user' })
    const B = await nextAttempt(2)
    if (where === 'background') {
      persistOpenCanvasAs('project-a')
      await session.open('project-b')
      store().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
    }
    calls.confirm.mockResolvedValue(answer === 'confirm')
    let C: Attempt | undefined
    if (order === 'success-first') {
      A.resolve(image('paid-a'))
      await canvas
      calls.open.mockResolvedValue([])
      B.reject(refused())
      if (answer === 'confirm') { C = await nextAttempt(3); C.resolve(image('paid-c')) }
      await storyboard
    } else {
      calls.open.mockResolvedValue([{ nodeId: id, runId: `canvas-${A.runId}`, reason: 'in_flight', hasTaskId: false }])
      B.reject(refused())
      if (answer === 'confirm') C = await nextAttempt(3)
      else await storyboard
      A.resolve(image('paid-a'))
      await canvas
      if (C) { C.resolve(image('paid-c')); await storyboard }
    }
    const node = where === 'background' ? diskNode('project-a', id) : live(id)
    // 结果在：先发那次付了钱的图在这一镜上（当前图或版本历史里）。
    expect(results(node)).toContain('paid-a')
    // 记在哪：先发那次自己的记录成功、对得上图；被拒那下从来不是一次运行，没有记录。
    expect(record(node, A.runId)).toMatchObject({ status: 'success', resultId: 'paid-a' })
    expect(record(node, B.runId)).toBeUndefined()
    // 下了几单：被拒那下不重发；只有人亲手确认的「再发一次」多一单。
    expect(attempts).toHaveLength(answer === 'confirm' && where === 'foreground' ? 3 : 2)
    expect(node?.status).toBe('success')
    expect(node?.result?.id).toBe(C ? 'paid-c' : 'paid-a')
    if (C) expect(record(node, C.runId)).toMatchObject({ status: 'success', resultId: 'paid-c' })
    if (where === 'background') {
      await session.open('project-a')
      store().restoreSnapshot((calls.disk.get('project-a') as WorkbenchProjectRecordV1).payload.generationCanvas)
    }
    await assertActionable(id)
  })
})

describe('the user confirmed "send again"; the earlier run arrives late', () => {
  async function resendWhileOldRuns(): Promise<{ id: string; A: Attempt; C: Attempt; old: Promise<unknown>; resend: Promise<unknown> }> {
    const id = store().addNode({ kind: 'image', prompt: 'shot 1' }).id
    const old = confirmAndRunNode(id, { initiator: 'user' })
    const A = await nextAttempt(1)
    A.ctx.onProgress?.({ phase: 'generating', message: 'old', taskId: 'task-a' })
    calls.open.mockResolvedValue([{ nodeId: id, runId: `canvas-${A.runId}`, reason: 'in_flight', hasTaskId: true }])
    const resend = confirmAndRunNode(id, { initiator: 'user', resend: true })
    const C = await nextAttempt(2)
    C.ctx.onProgress?.({ phase: 'generating', message: 'new', taskId: 'task-c' })
    return { id, A, C, old, resend }
  }

  it('the old image arrives after the new one succeeded: it goes into version history, the current image and the timeline stay on the new one', async () => {
    const { id, A, C, old, resend } = await resendWhileOldRuns()
    C.resolve(image('paid-c')); await resend
    A.resolve(image('paid-a')); await old
    const node = live(id)
    expect(node?.result?.id).toBe('paid-c')
    expect(results(node)).toContain('paid-a')
    expect(record(node, A.runId)).toMatchObject({ status: 'success', resultId: 'paid-a' })
    expect(record(node, C.runId)).toMatchObject({ status: 'success', resultId: 'paid-c', taskId: 'task-c' })
    expect(timeline.mock.calls.map(([, result]) => (result as GenerationNodeResult).id)).toEqual(['paid-c'])
    expect(attempts).toHaveLength(2)
    await assertActionable(id)
  })

  it('the old run fails late: its own record ends as failed, the new success is untouched', async () => {
    const { id, A, C, old, resend } = await resendWhileOldRuns()
    C.resolve(image('paid-c')); await resend
    A.reject(new Error('500 Internal Server Error')); await old.catch(() => undefined)
    const node = live(id)
    expect(node).toMatchObject({ status: 'success', result: { id: 'paid-c' } })
    expect(record(node, A.runId)?.status).toBe('error')
    expect(record(node, C.runId)).toMatchObject({ status: 'success', taskId: 'task-c' })
    await assertActionable(id)
  })

  it('stale foreground progress of the old run never lands on the new record', async () => {
    const { id, A, C, old, resend } = await resendWhileOldRuns()
    A.ctx.onProgress?.({ phase: 'generating', message: 'old again', taskId: 'task-a-late' })
    expect(record(live(id), C.runId)?.taskId).toBe('task-c')
    expect(live(id)?.progress?.runId).toBe(C.runId)
    C.resolve(image('paid-c')); await resend
    A.ctx.onProgress?.({ phase: 'generating', message: 'old after', taskId: 'task-a-later' })
    expect(record(live(id), C.runId)?.taskId).toBe('task-c')
    expect(live(id)).toMatchObject({ status: 'success', result: { id: 'paid-c' } })
    expect(live(id)?.progress).toBeUndefined()
    A.resolve(image('paid-a')); await old
    expect(live(id)?.result?.id).toBe('paid-c')
    await assertActionable(id)
  })

  it('the new run fails and the old image arrives: the paid old image becomes the current image', async () => {
    const { id, A, C, old, resend } = await resendWhileOldRuns()
    C.reject(new Error('500 Internal Server Error')); await resend
    A.resolve(image('paid-a')); await old
    const node = live(id)
    expect(node).toMatchObject({ status: 'success', result: { id: 'paid-a' } })
    expect(record(node, A.runId)).toMatchObject({ status: 'success', resultId: 'paid-a' })
    expect(record(node, C.runId)?.status).toBe('error')
    await assertActionable(id)
  })

  it('batch path: a late old image does not rewrite the timeline when it is not the current image', async () => {
    const id = store().addNode({ kind: 'image', prompt: 'shot 1' }).id
    const target = testProjectBinding('project-a')
    const batch = runGenerationNodesBatch([id], { target, assetUploadConsent: 'not-needed', retry: { maxAttempts: 1 }, canvasRunRecordIds: new Map([[id, 'batch-a']]) })
    const A = await nextAttempt(1)
    A.ctx.onProgress?.({ phase: 'generating', message: 'old', taskId: 'task-a' })
    calls.open.mockResolvedValue([{ nodeId: id, runId: 'canvas-batch-a', reason: 'in_flight', hasTaskId: true }])
    const resend = confirmAndRunNode(id, { initiator: 'user', resend: true })
    const C = await nextAttempt(2)
    C.resolve(image('paid-c')); await resend
    A.resolve(image('paid-a')); await batch
    expect(live(id)?.result?.id).toBe('paid-c')
    expect(results(live(id))).toContain('paid-a')
    expect(timeline.mock.calls.map(([, result]) => (result as GenerationNodeResult).id)).toEqual(['paid-c'])
  })
})

it('cancel after the refusal stops the running shot and the shot can be generated again', async () => {
  const id = store().addNode({ kind: 'image', prompt: 'shot 1' }).id
  const canvas = confirmAndRunNode(id, { initiator: 'user' })
  const A = await nextAttempt(1)
  const storyboard = regenerateNodeInPlace(id, { initiator: 'user' })
  const B = await nextAttempt(2)
  calls.confirm.mockResolvedValue(false)
  B.reject(refused()); await storyboard
  expect(isGenerationNodeBusy(live(id))).toBe(true)
  requestTaskCancel(live(id)!, () => undefined)
  A.reject(new LocalTaskCancelledError()); await canvas.catch(() => undefined)
  expect(live(id)?.status).toBe('idle')
  expect(record(live(id), A.runId)?.status).toBe('cancelled')
  expect(record(live(id), B.runId)).toBeUndefined()
  expect(attempts).toHaveLength(2)
  await assertActionable(id)
})

it('the node is deleted while both clicks are out; undo brings it back with the paid image', async () => {
  const id = store().addNode({ kind: 'image', prompt: 'shot 1' }).id
  const canvas = confirmAndRunNode(id, { initiator: 'user' })
  const A = await nextAttempt(1)
  const storyboard = regenerateNodeInPlace(id, { initiator: 'user' })
  const B = await nextAttempt(2)
  store().deleteNode(id)
  calls.confirm.mockResolvedValue(false)
  A.resolve(image('paid-a')); await canvas
  B.reject(refused()); await storyboard
  store().undo()
  const node = live(id)
  expect(node).toMatchObject({ status: 'success', result: { id: 'paid-a' } })
  expect(record(node, A.runId)).toMatchObject({ status: 'success', resultId: 'paid-a' })
  expect(record(node, B.runId)).toBeUndefined()
  expect(attempts).toHaveLength(2)
  await assertActionable(id)
})

describe('restart convergence only touches the run that was in flight', () => {
  const base = { kind: 'image', title: 'shot', position: { x: 0, y: 0 }, prompt: 'shot', categoryId: 'shots' } as const
  it('an in-flight run with a task id becomes recoverable', () => {
    store().restoreSnapshot({ nodes: [{ ...base, id: 'n1', status: 'running', runs: [{ id: 'a', status: 'running', startedAt: 1, taskId: 'task-a' }] }], edges: [], groups: [] })
    expect(live('n1')).toMatchObject({ status: 'recoverable', runs: [{ id: 'a', status: 'recoverable', taskId: 'task-a' }] })
  })
  it('only an optimistic display (no admitted record) recomputes from the records and leaves them alone', () => {
    const runs = [{ id: 'done', status: 'success' as const, startedAt: 1, resultId: 'r1', completedAt: 2 }]
    store().restoreSnapshot({ nodes: [{ ...base, id: 'n2', status: 'queued', progress: { runId: 'attempt-x', phase: 'queued', updatedAt: 3 }, result: image('r1'), history: [image('r1')], runs }], edges: [], groups: [] })
    expect(live('n2')?.status).toBe('success')
    expect(live('n2')?.runs).toEqual(runs)
  })
  it('a newer record that already succeeded is never rewritten; the older in-flight one is converged', () => {
    store().restoreSnapshot({ nodes: [{ ...base, id: 'n3', status: 'running', result: image('rc'), history: [image('rc')], runs: [
      { id: 'c', status: 'success', startedAt: 5, resultId: 'rc', completedAt: 6 },
      { id: 'a', status: 'running', startedAt: 1, taskId: 'task-a' },
    ] }], edges: [], groups: [] })
    const node = live('n3')
    expect(record(node, 'c')).toMatchObject({ status: 'success', resultId: 'rc' })
    expect(record(node, 'a')).toMatchObject({ status: 'recoverable', taskId: 'task-a' })
    expect(node?.status).toBe('success')
  })
})

describe('v0.24.0 real saved node (old version wrote the refused click as the latest run)', () => {
  const snapshot = path.resolve('tests/fixtures/old-user-data/runs/v0.24.0-canvas-interrupted')
  const manifest = JSON.parse(fs.readFileSync(path.join(snapshot, 'manifest.json'), 'utf8')) as { nodeId: string; runRecordId: string }
  const oldNode = (): GenerationCanvasNode => JSON.parse(fs.readFileSync(path.join(snapshot, 'node.json'), 'utf8'))
  const load = () => store().restoreSnapshot({ nodes: [oldNode()], edges: [], groups: [] })

  it('opens unchanged, and the observer outcome for the old record lands on that record by its number', async () => {
    load()
    const opened = live(manifest.nodeId)!
    expect({ status: opened.status, error: opened.error, runs: opened.runs }).toEqual({ status: oldNode().status, error: oldNode().error, runs: oldNode().runs })
    await deliverRunOutcome(testProjectBinding('project-a'), manifest.nodeId, { kind: 'result', runId: manifest.runRecordId, result: image('observer') })
    expect(live(manifest.nodeId)).toMatchObject({ status: 'success', result: { id: 'observer' } })
    expect(record(live(manifest.nodeId), manifest.runRecordId)).toMatchObject({ status: 'success', resultId: 'observer' })
  })

  it('another refused click leaves it exactly as it was', async () => {
    load()
    const before = structuredClone(live(manifest.nodeId))
    calls.confirm.mockResolvedValue(true)
    const click = confirmAndRunNode(manifest.nodeId, { initiator: 'user' })
    const X = await nextAttempt(1)
    calls.confirm.mockResolvedValue(false)
    X.reject(refused()); await click
    const after = live(manifest.nodeId)
    expect({ status: after?.status, error: after?.error, runs: after?.runs, progress: after?.progress }).toEqual({ status: before?.status, error: before?.error, runs: before?.runs, progress: before?.progress })
    expect(attempts).toHaveLength(1)
  })
})

it('a result without a run number (production projection) never closes the user\'s own run record', () => {
  const id = store().addNode({ kind: 'image', prompt: 'shot 1' }).id
  store().appendNodeRun(id, { id: 'mine', status: 'running', startedAt: 10, taskId: 'task-mine' })
  attachShotResult({ nodeId: id, result: image('production') })
  const node = live(id)
  expect(results(node)).toContain('production')
  expect(record(node, 'mine')).toMatchObject({ status: 'running', taskId: 'task-mine' })
  expect(record(node, 'mine')?.resultId).toBeUndefined()
})
