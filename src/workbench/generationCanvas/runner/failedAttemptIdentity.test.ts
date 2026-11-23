// 失败属于「发出去的那一次」，不属于「节点现在选着谁」（2026-09-29 走查 pb06）。
// 走的是真的运行咽喉 runGenerationNode + 真的画布 store（只有磁盘与付费令牌是桩）：
// 运行开始时把 (供应商, 模型) 写进运行记录，之后失败提示点名它、健康记账记到它——运行期间用户可以换家。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeStructuredErrorMessage } from '../../../../electron/shared/vendorFailure'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { generationNodeRunRecordSchema } from '../model/generationCanvasSchema'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useGenerationQueueStore } from './generationQueueStore'
import { runGenerationNode, runGenerationNodesBatch } from './generationRunController'
import { setCanvasEventSinkForTests } from '../events/canvasEventEmitter'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'
import { isModelRecentlyAiling, recordModelFailure, resetModelHealthMemory } from './modelHealthMemory'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'

vi.mock('../../library/localProjectStore', () => ({
  readLocalProjectAsync: vi.fn(async () => null),
  saveLocalProject: vi.fn(async () => ({})),
}))
vi.mock('../../api/taskApi', () => ({ mintSpendGrant: vi.fn(async () => 'grant'), canvasOpenRuns: vi.fn(async () => []) }))

const A = { vendor: 'vendor-a', modelKey: 'image-model' }
const B = { vendor: 'vendor-b', modelKey: 'image-model' }
const metaFor = (identity: { vendor: string; modelKey: string }) => ({ modelVendor: identity.vendor, modelKey: identity.modelKey })

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const nodeById = (id: string): GenerationCanvasNode | undefined => useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)

let session: ProjectSessionTestHarness
beforeEach(() => {
  session = createProjectSessionTestHarness()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  useGenerationQueueStore.setState({ entries: [], batches: {} })
  __resetCanvasUndoJournalForTests()
  setCanvasEventSinkForTests(() => {})
  resetModelHealthMemory()
})
afterEach(() => {
  setCanvasEventSinkForTests(null)
  session.dispose()
})

const runWith = async (nodeId: string, executor: () => Promise<never | GenerationCanvasNode['result']>) => {
  const target = await session.open('project-a')
  return runGenerationNode(nodeId, { target, executor: executor as never })
}

describe('the run record carries which (vendor, model) the run was dispatched to', () => {
  it.each(['image', 'video'] as const)('one authorized %s node executes once on a deterministic unsent failure', async kind => {
    const target = await session.open('project-a')
    const node = useGenerationCanvasStore.getState().addNode({ kind, prompt: 'one shot', meta: metaFor(A) })
    const refusal = encodeStructuredErrorMessage({ code: 'submission_not_sent', reason: 'never_reached_network' }, 'asset upload timeout')
    const executor = vi.fn(async () => { throw new Error(refusal) })
    await expect(runGenerationNode(node.id, { target, executor })).rejects.toThrow(refusal)
    expect(executor).toHaveBeenCalledTimes(1)
  })

  it('nine separate inputs in one session produce nine local failures', async () => {
    const target = await session.open('project-a')
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'one shot', meta: metaFor(A) })
    const message = encodeStructuredErrorMessage({ code: 'submission_not_sent', reason: 'never_reached_network' }, 'asset upload timeout')
    const { submitCanvasShotRun } = await vi.importActual<typeof import('../../api/taskApi')>('../../api/taskApi')
    const canvasSubmit = vi.fn(async () => { throw new Error(message) })
    const track = vi.fn(async (_event: { eventName: string; props: { errorType?: string } }) => ({ queued: true }))
    vi.stubGlobal('window', { nomiDesktop: { tasks: { canvasSubmit }, telemetry: { track } } })
    try {
      for (let intent = 0; intent < 9; intent++) {
        const executor = async () => {
          await submitCanvasShotRun({
            projectId: 'project-a', nodeId: node.id, runRecordId: `intent-${intent}`, vendor: A.vendor,
            request: { kind: 'text_to_image', prompt: 'one shot' },
          })
          throw new Error('Expected the controlled submission to fail')
        }
        await expect(runGenerationNode(node.id, { target, executor })).rejects.toThrow(message)
      }
      const failures = track.mock.calls.map(([event]) => [event.eventName, event.props.errorType])
      expect(failures).toEqual(Array.from({ length: 9 }, () => ['generation.completed', 'submission-not-sent']))
      expect(canvasSubmit).toHaveBeenCalledTimes(9)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a batch does not repeat a classified terminal refusal', async () => {
    const target = await session.open('project-a')
    const nodes = ['first', 'second'].map(prompt =>
      useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt }))
    const message = encodeStructuredErrorMessage({ category: 'auth', retryable: false }, 'upstream socket rejected')
    const executor = vi.fn(async () => { throw new Error(message) })
    const result = await runGenerationNodesBatch(nodes.map(node => node.id), { target, executor })
    expect(result.failures).toHaveLength(2)
    expect(executor).toHaveBeenCalledTimes(2)
  })

  it('a failed run keeps the dispatched pair on the failure record', async () => {
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'x', meta: metaFor(A) })
    await expect(runWith(node.id, async () => { throw new Error('Provider request failed') })).rejects.toThrow()
    expect(nodeById(node.id)).toMatchObject({ status: 'error' })
    expect(nodeById(node.id)?.runs?.[0]).toMatchObject({ status: 'error', attempt: { vendorKey: 'vendor-a', modelKey: 'image-model' } })
  })

  // 红（旧代码：记账读「失败那一刻节点选着谁」）：运行期间用户换到了 B，失败却记到了 B 头上。
  it('the pair survives the user switching the node to another vendor while the run is in flight', async () => {
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'x', meta: metaFor(A) })
    const started = deferred()
    const gate = deferred()
    const running = runWith(node.id, async () => { started.resolve(); await gate.promise; throw new Error('Provider request failed') })
    await started.promise
    useGenerationCanvasStore.getState().updateNode(node.id, { meta: { ...nodeById(node.id)?.meta, ...metaFor(B) } })
    gate.resolve()
    await expect(running).rejects.toThrow()

    expect(nodeById(node.id)?.meta?.modelVendor).toBe('vendor-b')
    expect(nodeById(node.id)?.runs?.[0].attempt).toEqual({ vendorKey: 'vendor-a', modelKey: 'image-model' })
  })

  it('a run that was never dispatched to a concrete model records no pair (nobody is blamed)', async () => {
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'x' })
    await expect(runWith(node.id, async () => { throw new Error('请先在模型管理里选择一个可用模型') })).rejects.toThrow()
    expect(nodeById(node.id)?.runs?.[0].attempt).toBeUndefined()
  })
})

describe('model health is accounted to the dispatched pair, not to whoever the node points at afterwards', () => {
  it('a failure after the user switched to vendor B is charged to A; B stays healthy', async () => {
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'x', meta: metaFor(A) })
    const started = deferred()
    const gate = deferred()
    const running = runWith(node.id, async () => { started.resolve(); await gate.promise; throw new Error('Provider request failed') })
    await started.promise
    useGenerationCanvasStore.getState().updateNode(node.id, { meta: { ...nodeById(node.id)?.meta, ...metaFor(B) } })
    gate.resolve()
    await expect(running).rejects.toThrow()

    // 「近 24h 连败 ≥ 2」才避让：A 已经有 1 笔，再一笔就避让；B 若被冤记了 1 笔，再一笔就会被判病。
    recordModelFailure({ modelKey: A.modelKey, vendor: A.vendor })
    recordModelFailure({ modelKey: B.modelKey, vendor: B.vendor })
    expect(isModelRecentlyAiling({ modelKey: A.modelKey, vendor: A.vendor })).toBe(true)
    expect(isModelRecentlyAiling({ modelKey: B.modelKey, vendor: B.vendor })).toBe(false)
  })

  it('a success after the switch clears the dispatched pair, not the new one', async () => {
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'x', meta: metaFor(A) })
    recordModelFailure({ modelKey: A.modelKey, vendor: A.vendor })
    recordModelFailure({ modelKey: B.modelKey, vendor: B.vendor })
    const started = deferred()
    const gate = deferred()
    const running = runWith(node.id, async () => {
      started.resolve()
      await gate.promise
      return [{ id: 'r1', type: 'image', url: 'nomi-local://asset/project-a/a.png', createdAt: 1 }] as never
    })
    await started.promise
    useGenerationCanvasStore.getState().updateNode(node.id, { meta: { ...nodeById(node.id)?.meta, ...metaFor(B) } })
    gate.resolve()
    await running

    recordModelFailure({ modelKey: A.modelKey, vendor: A.vendor })
    recordModelFailure({ modelKey: B.modelKey, vendor: B.vendor })
    expect(isModelRecentlyAiling({ modelKey: A.modelKey, vendor: A.vendor })).toBe(false) // A：成功清零，再败一笔才 1
    expect(isModelRecentlyAiling({ modelKey: B.modelKey, vendor: B.vendor })).toBe(true) // B：没被清，2 笔
  })
})

describe('the pair is part of the persisted run record (a saved project keeps who failed)', () => {
  const base = { id: 'run-1', status: 'error', startedAt: 1, updatedAt: 2 }
  it('survives the schema, legacy records without it still load, and an empty pair is refused', () => {
    expect(generationNodeRunRecordSchema.parse({ ...base, attempt: { vendorKey: 'a', modelKey: 'm' } }).attempt).toEqual({ vendorKey: 'a', modelKey: 'm' })
    expect(generationNodeRunRecordSchema.parse(base).attempt).toBeUndefined()
    expect(() => generationNodeRunRecordSchema.parse({ ...base, attempt: { vendorKey: '', modelKey: 'm' } })).toThrow()
  })
})
