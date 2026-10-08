// 已批准行为（§2 第 3 条）：已提交的后台生成属于原项目，切项目不取消它。
// 这组测的是「身份在提交那一刻固定」：轮询期间用户切到别的项目，结果仍落回原项目（此时它不在前台，
// 所以写原项目的盘上副本），新项目的画布零副作用；任务查询只复述提交时的项目身份。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import type { WorkbenchProjectRecordV1 } from '../../project/projectRecordSchema'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useGenerationQueueStore } from './generationQueueStore'
import { runGenerationNode, runGenerationNodesBatch } from './generationRunController'
import { runGenerationNodesByPlan } from './generationRunWaves'
import { runCatalogGenerationTask } from './catalogTaskActions'
import { setCanvasEventSinkForTests } from '../events/canvasEventEmitter'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'
import { resetModelHealthMemory } from './modelHealthMemory'
import { readRunGraph, deliverRunOutcome } from './runProjectDelivery'
import { buildTaskCenterView } from '../../taskCenter/taskCenterEntries'
import { readLocalProjectAsync, saveLocalProject } from '../../library/localProjectStore'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness, testProjectBinding } from '../../project/projectSessionTestHarness'
import type { TaskRequestDto } from '../../api/taskApi'

const disk = vi.hoisted(() => new Map<string, unknown>())
vi.mock('../../library/localProjectStore', () => ({
  readLocalProjectAsync: vi.fn(async (projectId: string) => structuredClone(disk.get(projectId) ?? null)),
  saveLocalProject: vi.fn(async (projectId: string, payload: unknown, name?: string) => {
    const record = { id: projectId, name, version: 1, immutableProjectUuid: testProjectBinding(projectId).immutableProjectUuid, projectGeneration: testProjectBinding(projectId).projectGeneration, payload }
    disk.set(projectId, structuredClone(record))
    return record
  }),
}))
vi.mock('../../api/taskApi', () => ({ mintSpendGrant: vi.fn(async () => 'grant') }))
vi.mock('../../../desktop/bridge', () => ({
  getDesktopBridge: () => ({ projects: {
    applyCanvasNodePatch: async ({ projectId, nodeId, patch }: { projectId: string; nodeId: string; patch: Record<string, unknown> }) => {
      const record = disk.get(projectId) as { payload: { generationCanvas: { nodes: Array<Record<string, unknown>> } } } | undefined
      if (!record) return { applied: false }
      const nodes = record.payload.generationCanvas.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node)
      record.payload.generationCanvas.nodes = nodes
      disk.set(projectId, structuredClone(record))
      return { applied: true }
    },
  } }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const canvasBytes = () => {
  const state = useGenerationCanvasStore.getState()
  return JSON.stringify({ nodes: state.nodes, edges: state.edges, groups: state.groups })
}

/** 用户离开 A 前 A 已保存：它在盘上的样子就是此刻 store 的样子。 */
function persistOpenCanvasAs(projectId: string): void {
  const state = useGenerationCanvasStore.getState()
  disk.set(projectId, structuredClone({ id: projectId, name: projectId, version: 1, immutableProjectUuid: testProjectBinding(projectId).immutableProjectUuid, projectGeneration: testProjectBinding(projectId).projectGeneration,
    payload: { generationCanvas: { nodes: state.nodes, edges: state.edges, groups: state.groups, selectedNodeIds: [] } } }))
}

function diskNode(projectId: string, nodeId: string): GenerationCanvasNode | undefined {
  const record = disk.get(projectId) as WorkbenchProjectRecordV1 | undefined
  return record?.payload.generationCanvas.nodes.find((node) => node.id === nodeId)
}

let session: ProjectSessionTestHarness
beforeEach(() => {
  disk.clear()
  vi.mocked(saveLocalProject).mockClear()
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

describe('background generation keeps the project identity fixed at submission', () => {
  it('a project switch during polling lands the result in the original project and leaves the new project untouched', async () => {
    const projectA = await session.open('project-a')
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: '镜头 1' })
    const polling = deferred<GenerationNodeResult>()
    const submitted = deferred<void>()
    const run = runGenerationNodesBatch([node.id], {
      target: projectA,
      assetUploadConsent: 'not-needed',
      retry: { maxAttempts: 1 },
      executor: async (_node, context) => {
        expect(context.projectTarget).toEqual(projectA)
        context.onProgress?.({ phase: 'generating', message: 'polling', taskId: 'task-a-1' })
        submitted.resolve()
        return polling.promise
      },
    })
    await submitted.promise

    persistOpenCanvasAs('project-a')
    await session.open('project-b')
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [{ id: 'b-node', kind: 'image', title: 'B', prompt: 'B', position: { x: 0, y: 0 } }], edges: [], selectedNodeIds: [], groups: [],
    })
    const projectBBefore = canvasBytes()

    polling.resolve({ id: 'result-a', type: 'image', url: 'nomi-local://asset/project-a/result.png', createdAt: 1 } as GenerationNodeResult)
    const outcome = await run

    expect(outcome.successes.map((success) => success.nodeId)).toEqual([node.id])
    expect(canvasBytes()).toBe(projectBBefore)
    expect(vi.mocked(saveLocalProject)).not.toHaveBeenCalled()
    const landed = diskNode('project-a', node.id)
    expect(landed).toMatchObject({ status: 'success', result: { id: 'result-a', url: 'nomi-local://asset/project-a/result.png' } })
    expect(landed?.runs?.[0]).toMatchObject({ status: 'success', projectId: 'project-a', taskId: 'task-a-1' })
  })

  it('the catalog task names its submission project for submit and every poll, whatever is open when the poll runs', async () => {
    const projectA = await session.open('project-a')
    const submissions: Array<{ projectId: string | null; extras: TaskRequestDto['extras'] }> = []
    const polls: Array<string | null> = []
    const node: GenerationCanvasNode = { id: 'video-a', kind: 'video', title: '', prompt: 'walk', position: { x: 0, y: 0 },
      meta: { modelVendor: 'asyncv', modelKey: 'video-model' } }
    const result = runCatalogGenerationTask(node, {
      projectTarget: projectA,
      pollIntervalMs: 1,
      listCatalogVendors: async () => [{ key: 'asyncv', name: 'asyncv', enabled: true, hasApiKey: true, createdAt: '', updatedAt: '' }],
      listCatalogModels: async () => [{ modelKey: 'video-model', vendorKey: 'asyncv', labelZh: 'v', kind: 'video', enabled: true, published: true, availability: { usable: true }, publishedModes: ['text_to_video'], createdAt: '', updatedAt: '' }],
      runTask: async (_vendor, request, projectId) => {
        submissions.push({ projectId, extras: request.extras })
        await session.open('project-b')
        return { id: 'up-task', kind: request.kind, status: 'queued', assets: [], raw: {} }
      },
      fetchTaskResult: async (payload) => {
        polls.push(payload.projectId)
        return { vendor: 'asyncv', result: { id: 'up-task', kind: 'text_to_video', status: 'succeeded', assets: [{ type: 'video', url: 'nomi-local://asset/project-a/v.mp4' }], raw: {} } }
      },
    })
    await expect(result).resolves.toMatchObject({ type: 'video', url: 'nomi-local://asset/project-a/v.mp4' })
    expect(submissions).toHaveLength(1)
    expect(submissions[0].projectId).toBe('project-a')
    expect(submissions[0].extras?.projectId).toBeUndefined()
    expect(polls).toEqual(['project-a'])
  })
})


it.each([false, true])('does not submit a node deleted during author validation (background=%s)', async background => {
  const target = await session.open('project-a')
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'delete before submit' })
  const checking = deferred<void>()
  const resume = deferred<void>()
  const executor = vi.fn(async (): Promise<GenerationNodeResult> => ({ id: 'forbidden-result', type: 'image', url: 'nomi-local://asset/result.png', createdAt: 1 }))
  const run = runGenerationNode(node.id, {
    target, assetUploadConsent: 'not-needed', executor,
    assertAuthorCurrent: async () => { checking.resolve(); await resume.promise },
  })
  const rejected = expect(run).rejects.toThrow('node not found')
  await checking.promise
  useGenerationCanvasStore.getState().deleteNode(node.id)
  if (background) {
    persistOpenCanvasAs(target.projectId)
    await session.open('project-b')
  }
  resume.resolve()
  await rejected
  expect(executor).not.toHaveBeenCalled()
  expect(useGenerationCanvasStore.getState().nodes.find(candidate => candidate.id === node.id)).toBeUndefined()
})

it('does not resurrect the initial node on a retry after deletion', async () => {
  const target = await session.open('project-a')
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'delete during failed attempt' })
  const executor = vi.fn(async (): Promise<GenerationNodeResult> => {
    useGenerationCanvasStore.getState().deleteNode(node.id)
    throw new TypeError('failed to fetch')
  })
  await expect(runGenerationNode(node.id, {
    target, assetUploadConsent: 'not-needed', executor, retry: { maxAttempts: 2, baseDelayMs: 0 },
  })).rejects.toThrow('node not found')
  expect(executor).toHaveBeenCalledOnce()
})


it.each([0, 1])('batch validates author target before every wave (allowed attempts=%s)', async allowed => {
  const target = await session.open('project-a')
  const ids = [1, 2].map(index => useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: `shot ${index}` }).id)
  const executor = vi.fn(async (): Promise<GenerationNodeResult> => ({ id: 'result', type: 'image', url: 'nomi-local://asset/result.png', createdAt: 1 }))
  const outcome = await runGenerationNodesByPlan({ waves: ids.map(id => [id]), blocked: [], edgesUsed: [] }, {
    target, assetUploadConsent: 'not-needed', executor,
    assertAuthorCurrent: async () => { if (executor.mock.calls.length >= allowed) throw new Error('storyboard_content_conflict') },
  })
  expect(executor).toHaveBeenCalledTimes(allowed)
  expect(outcome.failures.map(item => item.nodeId)).toEqual(ids.slice(allowed))
  expect(outcome.failures.every(item => item.error.message === 'storyboard_content_conflict')).toBe(true)
})


it.each(['immutableProjectUuid', 'projectGeneration'] as const)('rejects background reads and writes to a replacement %s', async field => {
  const target = await session.open('project-a')
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'original' })
  persistOpenCanvasAs(target.projectId)
  await session.open('project-b')
  const record = disk.get(target.projectId) as WorkbenchProjectRecordV1
  if (field === 'immutableProjectUuid') record.immutableProjectUuid = '22222222-2222-4222-8222-222222222222'
  else record.projectGeneration = target.projectGeneration + 1
  const before = JSON.stringify(record)
  await expect(readRunGraph(target)).rejects.toThrow('project_binding_stale')
  await expect(deliverRunOutcome(target, node.id, { kind: 'status', status: 'error' })).rejects.toThrow('project_binding_stale')
  expect(JSON.stringify(disk.get(target.projectId))).toBe(before)
  expect(saveLocalProject).not.toHaveBeenCalled()
})


it('settles the original run when a replaced workspace rejects late progress without unhandled rejection or foreign writes', async () => {
  const target = await session.open('project-a')
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'approved' })
  const unhandled: unknown[] = []
  const listener = (error: unknown) => unhandled.push(error)
  process.on('unhandledRejection', listener)
  try {
    await expect(runGenerationNode(node.id, { target, assetUploadConsent: 'not-needed', executor: async (_node, context) => {
      persistOpenCanvasAs('project-a')
      ;(disk.get('project-a') as WorkbenchProjectRecordV1).projectGeneration = target.projectGeneration + 1
      await session.open('project-b')
      useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
      context.onProgress?.({ phase: 'generating', message: 'poll', taskId: 'late-task' })
      // One event-loop boundary observes Node's actual unhandledRejection event, not a timing sleep.
      await new Promise<void>(resolve => setImmediate(resolve))
      return { id: 'result', type: 'image', url: 'nomi-local://asset/a/result.png', createdAt: 1 }
    } })).rejects.toThrow('project_binding_stale')
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(unhandled).toEqual([])
    const queue = useGenerationQueueStore.getState()
    const taskView = buildTaskCenterView({ entries: queue.entries, batches: queue.batches, nodes: [], fallbackTitle: 'Original task', now: Date.now() })
    expect(taskView.rows).toEqual([expect.objectContaining({ nodeId: node.id, group: 'done', outcome: 'error', error: 'project_binding_stale' })])
    expect((taskView.rows[0].phaseText ?? '').length).toBeGreaterThan(0)
    expect(Object.values(queue.batches).every(batch => batch.projectId === target.projectId)).toBe(true)
    expect(useGenerationQueueStore.getState().entries).toEqual([expect.objectContaining({ nodeId: node.id, state: 'error' })])
    expect(Object.values(useGenerationQueueStore.getState().batches)).toEqual([expect.objectContaining({ finishedAt: expect.any(Number) })])
    expect(saveLocalProject).not.toHaveBeenCalled()
    expect(useGenerationCanvasStore.getState().nodes).toEqual([])
  } finally { process.off('unhandledRejection', listener) }
})

it.each(['cycle', 'missing-upstream'] as const)('awaits blocked %s status delivery and settles the batch if the original workspace was replaced', async reason => {
  const target = await session.open('project-a')
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'blocked' })
  persistOpenCanvasAs('project-a')
  ;(disk.get('project-a') as WorkbenchProjectRecordV1).projectGeneration = target.projectGeneration + 1
  await session.open('project-b')
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  const unhandled: unknown[] = []
  const listener = (error: unknown) => unhandled.push(error)
  process.on('unhandledRejection', listener)
  try {
    await expect(runGenerationNodesByPlan({ waves: [], edgesUsed: [], blocked: [{ nodeId: node.id, reason, detail: 'blocked' }] },
      { target, assetUploadConsent: 'not-needed' })).rejects.toThrow('project_binding_stale')
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(unhandled).toEqual([])
    const queue = useGenerationQueueStore.getState()
    const taskView = buildTaskCenterView({ entries: queue.entries, batches: queue.batches, nodes: [], fallbackTitle: 'Original task', now: Date.now() })
    expect(taskView.rows).toEqual([expect.objectContaining({ nodeId: node.id, group: 'done', outcome: 'error', error: 'project_binding_stale' })])
    expect((taskView.rows[0].phaseText ?? '').length).toBeGreaterThan(0)
    expect(Object.values(queue.batches).every(batch => batch.projectId === target.projectId)).toBe(true)
    expect(useGenerationQueueStore.getState().entries).toEqual([expect.objectContaining({ nodeId: node.id, state: 'error' })])
    expect(Object.values(useGenerationQueueStore.getState().batches)).toEqual([expect.objectContaining({ finishedAt: expect.any(Number) })])
    expect(saveLocalProject).not.toHaveBeenCalled()
    expect(useGenerationCanvasStore.getState().nodes).toEqual([])
  } finally { process.off('unhandledRejection', listener) }
})


it('settles the queue if workspace identity changes between the graph read and initial run-record write', async () => {
  const target = await session.open('project-a')
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'approved' })
  persistOpenCanvasAs('project-a')
  await session.open('project-b')
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  vi.mocked(readLocalProjectAsync).mockImplementationOnce(async () => {
    const before = structuredClone(disk.get('project-a')) as WorkbenchProjectRecordV1
    ;(disk.get('project-a') as WorkbenchProjectRecordV1).projectGeneration = target.projectGeneration + 1
    return before
  })
  const executor = vi.fn()
  await expect(runGenerationNode(node.id, { target, executor, assetUploadConsent: 'not-needed' })).rejects.toThrow('project_binding_stale')
  expect(executor).not.toHaveBeenCalled()
  expect(saveLocalProject).not.toHaveBeenCalled()
  expect(useGenerationCanvasStore.getState().nodes).toEqual([])
  expect(useGenerationQueueStore.getState().entries).toEqual([expect.objectContaining({ nodeId: node.id, state: 'error' })])
  expect(Object.values(useGenerationQueueStore.getState().batches)).toEqual([expect.objectContaining({ finishedAt: expect.any(Number) })])
})
