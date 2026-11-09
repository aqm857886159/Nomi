// 一次出 N 张（张数 1–4）全部进同一镜的版本历史：画布那条路（渲染层）。
// 设计卡 docs/plan/2026-11-09-multi-result-landing.md ★9 第 1、7、8 条。
//
// 走真实的控制器（confirmAndRunNode）+ 真实的执行器（generationNodeExecutor → runCatalogGenerationTask → 归一），
// 只在渲染层 ↔ 主进程那条边上换成假的（taskApi：交 / 查）。以前归一那一步只取第一份产物：付 N 张、看到 1 张。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmAndRunNode, runGenerationNode, runGenerationNodesBatch } from './generationRunController'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useGenerationQueueStore } from './generationQueueStore'
import { useSpendConfirmStore } from '../spend/spendConfirm'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import type { ProjectBinding } from '../../../../electron/shared/projectBinding'
import type { WorkbenchProjectRecordV1 } from '../../project/projectRecordSchema'
import type { TaskAssetDto, TaskRequestDto, TaskResultDto } from '../../api/taskApi'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

type SubmitInput = { projectId: string; nodeId: string; runRecordId: string; vendor: string; request: TaskRequestDto }

const calls = vi.hoisted(() => ({ disk: new Map<string, unknown>(), submit: vi.fn(), confirm: vi.fn() }))
vi.mock('../../library/localProjectStore', () => ({
  readLocalProjectAsync: async (id: string) => structuredClone(calls.disk.get(id) ?? null),
  saveLocalProject: async (id: string, payload: WorkbenchProjectRecordV1['payload'], name: string) => {
    const record = { ...(calls.disk.get(id) as object | undefined), id, name, version: 1 as const, payload }
    calls.disk.set(id, structuredClone(record))
    return record
  },
}))
vi.mock('../../api/taskApi', async (original) => ({
  ...await original<typeof import('../../api/taskApi')>(),
  canvasOpenRuns: vi.fn(async () => []),
  submitCanvasShotRun: (input: SubmitInput) => calls.submit(input),
  pollCanvasShotRun: async () => { throw new Error('sync fixture never polls') },
  releaseCanvasShotRun: vi.fn(async () => undefined),
}))
vi.mock('../../api/modelCatalogApi', async (original) => ({
  ...await original<typeof import('../../api/modelCatalogApi')>(),
  listWorkbenchModelCatalogVendors: async () => { throw new Error('no catalog bridge in tests') },
}))
vi.mock('./assetUploadConsent', async (original) => ({
  ...await original<typeof import('./assetUploadConsent')>(),
  resolveAssetUploadConsent: async () => ({ allowed: true, needsConfirmation: false }),
}))

/** 主进程（单镜 Run）交回：这一单 N 份已落进项目的产物（与 runtime.runTask 逐张落地后的形状一样）。 */
function answersWith(count: number, taskId: string) {
  calls.submit.mockImplementationOnce(async (input: SubmitInput): Promise<TaskResultDto> => ({
    id: taskId, kind: input.request.kind, status: 'succeeded', raw: {},
    assets: Array.from({ length: count }, (_, index) => ({ type: 'image', url: `nomi-local://asset/project-a/${taskId}-${index + 1}.png`, width: 1024, height: 1024 })),
  }))
}

/**
 * 主进程按运行记录号记账的样子（真的那一侧见 electron/capabilityCore/canvasShotMultiOutput.test.ts 的重放格）：
 * 第一次交 = 供应商收到一次、N 张落账，但回话在路上丢了（渲染层收到网络错，按可重试处理）；
 * 同一个运行记录号再交 = 照账本回这 N 张，供应商不再收到请求。
 */
function ledgerWithLostAnswer(count: number, taskId: string) {
  const ledger = new Map<string, TaskResultDto>()
  const provider = { requests: 0 }
  calls.submit.mockImplementation(async (input: SubmitInput): Promise<TaskResultDto> => {
    const booked = ledger.get(input.runRecordId)
    if (booked) return structuredClone(booked)
    provider.requests += 1
    ledger.set(input.runRecordId, {
      id: taskId, kind: input.request.kind, status: 'succeeded', raw: {},
      assets: Array.from({ length: count }, (_, index) => ({ type: 'image', url: `nomi-local://asset/project-a/${taskId}-${index + 1}.png` })),
    })
    throw new TypeError('failed to fetch')
  })
  return provider
}

/** 主进程交回这几份产物（种类、地址由格子定；同一个地址出现在两次运行里时用）。 */
function answersWithAssets(taskId: string, assets: TaskAssetDto[]) {
  calls.submit.mockImplementationOnce(async (input: SubmitInput): Promise<TaskResultDto> => ({
    id: taskId, kind: input.request.kind, status: 'succeeded', raw: {}, assets,
  }))
}

let session: ProjectSessionTestHarness
let target: ProjectBinding
beforeEach(async () => {
  calls.disk.clear()
  calls.submit.mockReset()
  calls.confirm.mockReset().mockResolvedValue(true)
  vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockImplementation(calls.confirm)
  session = createProjectSessionTestHarness()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
  useGenerationQueueStore.setState({ entries: [], batches: {} })
  target = await session.open('project-a')
})
afterEach(() => { session.dispose(); vi.restoreAllMocks() })

function addImageNode(): string {
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'a red cube' })
  useGenerationCanvasStore.getState().updateNode(node.id, { meta: { modelKey: 'img-model', modelVendor: 'acme', vendor: 'acme', n: 4 } })
  return node.id
}
function addNodeOf(kind: 'image' | 'video' | 'audio'): string {
  const node = useGenerationCanvasStore.getState().addNode({ kind, prompt: 'a red cube' })
  useGenerationCanvasStore.getState().updateNode(node.id, { meta: { modelKey: `${kind}-model`, modelVendor: 'acme', vendor: 'acme', n: 4 } })
  return node.id
}
const nodeOf = (id: string): GenerationCanvasNode => useGenerationCanvasStore.getState().nodes.find((node) => node.id === id)!
const versions = (node: GenerationCanvasNode) => [...(node.history ?? [])].sort((left, right) => (left.versionNo ?? 0) - (right.versionNo ?? 0))

describe('画布 ↑ 一次出 N 张', () => {
  it.each([1, 2, 4])('N=%i：同一镜版本历史 N 条、都是这次运行的、当前是最后一张、只交一次', async (count) => {
    const id = addImageNode()
    answersWith(count, 'task-1')

    await expect(confirmAndRunNode(id, { initiator: 'user' })).resolves.toBe('started')

    const node = nodeOf(id)
    const history = versions(node)
    expect(history).toHaveLength(count)
    expect(history.map((entry) => entry.versionNo)).toEqual(Array.from({ length: count }, (_, index) => index + 1))
    expect(history.map((entry) => entry.url)).toEqual(Array.from({ length: count }, (_, index) => `nomi-local://asset/project-a/task-1-${index + 1}.png`))
    // 结果号：第一张和以前一字不差（`${节点}-${任务号}`），之后各加序号。
    expect(history.map((entry) => entry.id)).toEqual(Array.from({ length: count }, (_, index) => index === 0 ? `${id}-task-1` : `${id}-task-1-${index + 1}`))
    expect(history.every((entry) => entry.taskId === 'task-1')).toBe(true)
    // 都按这次的运行记录号结账：只有一条运行记录，成功，指向当前那张。
    expect(node.runs).toHaveLength(1)
    expect(node.runs?.[0]).toMatchObject({ status: 'success', taskId: 'task-1', resultId: history.at(-1)!.id })
    expect(node.status).toBe('success')
    expect(node.result?.id).toBe(history.at(-1)!.id)
    expect(node.resultVersionMax).toBe(count)
    expect(calls.submit).toHaveBeenCalledOnce()
    expect(useGenerationQueueStore.getState().entries.filter((entry) => entry.nodeId === id).map((entry) => entry.state)).toEqual(['success'])
  })

  it('同一镜跑两次（2 张 + 2 张）：两次的结果各归各的运行记录，不串；当前是第二次的最后一张', async () => {
    const id = addImageNode()
    answersWith(2, 'task-a')
    await confirmAndRunNode(id, { initiator: 'user' })
    answersWith(2, 'task-b')
    await confirmAndRunNode(id, { initiator: 'user' })

    const node = nodeOf(id)
    expect(versions(node).map((entry) => [entry.versionNo, entry.taskId])).toEqual([[1, 'task-a'], [2, 'task-a'], [3, 'task-b'], [4, 'task-b']])
    expect(node.runs).toHaveLength(2)
    const byTask = new Map(node.runs!.map((run) => [run.taskId, run]))
    expect(byTask.get('task-a')).toMatchObject({ status: 'success', resultId: `${id}-task-a-2` })
    expect(byTask.get('task-b')).toMatchObject({ status: 'success', resultId: `${id}-task-b-2` })
    expect(node.result?.id).toBe(`${id}-task-b-2`)
    expect(calls.submit).toHaveBeenCalledTimes(2)
  })

  it.each([1, 2, 4])('同一运行记录号重放出 %i 张（第一次的回话丢了）：回 N 份、版本历史 N 条、重放时供应商请求 0', async (count) => {
    const id = addImageNode()
    const provider = ledgerWithLostAnswer(count, 'task-replay')

    await runGenerationNode(id, { target, ledger: 'run', assetUploadConsent: 'allow', retry: { maxAttempts: 2, baseDelayMs: 0 } })

    const submissions = calls.submit.mock.calls.map(([input]) => (input as SubmitInput).runRecordId)
    expect(submissions).toHaveLength(2)
    expect(new Set(submissions).size).toBe(1)
    expect(provider.requests).toBe(1)
    const node = nodeOf(id)
    expect(versions(node).map((entry) => entry.url)).toEqual(Array.from({ length: count }, (_, index) => `nomi-local://asset/project-a/task-replay-${index + 1}.png`))
    expect(node.runs).toHaveLength(1)
    expect(node.runs?.[0]).toMatchObject({ id: submissions[0], status: 'success', resultId: versions(node).at(-1)!.id })
    expect(node.result?.id).toBe(versions(node).at(-1)!.id)
  })
})

// 复盘 §6 的矩阵：张数 0 / 1 / 2 / 4 × 媒体种类（图 / 视频 / 音频——配音、音乐都走音频这条）× 入口（画布生成、批量生成）。
// 判据只有一条：上游给几份有效产物就留几份，都归这次运行，当前选中是最后一份；0 份不是成功。
const KINDS = [
  { kind: 'image', ext: 'png' },
  { kind: 'video', ext: 'mp4' },
  { kind: 'audio', ext: 'mp3' },
] as const
const ENTRIES = ['canvas', 'batch'] as const
const MATRIX = KINDS.flatMap(({ kind, ext }) => ENTRIES.flatMap((entry) => [0, 1, 2, 4].map((count) => ({ kind, ext, entry, count }))))

async function runThrough(entry: typeof ENTRIES[number], id: string): Promise<void> {
  if (entry === 'canvas') {
    await confirmAndRunNode(id, { initiator: 'user' })
    return
  }
  await runGenerationNodesBatch([id], { target, assetUploadConsent: 'allow', retry: { maxAttempts: 1 }, canvasRunRecordIds: new Map([[id, `batch-${id}`]]) })
}

describe('画布 ↑ 张数 × 媒体种类 × 入口', () => {
  it.each(MATRIX)('$kind · $entry · 上游给 $count 份', async ({ kind, ext, entry, count }) => {
    const id = addNodeOf(kind)
    answersWithAssets('task-m', Array.from({ length: count }, (_, index) => ({ type: kind, url: `nomi-local://asset/project-a/task-m-${index + 1}.${ext}` })))

    await runThrough(entry, id)

    const node = nodeOf(id)
    const history = versions(node)
    expect(calls.submit).toHaveBeenCalledOnce()
    if (count === 0) {
      // 上游说成了却一份都读不出：不是成功，没有版本，这次的运行记录也不指向任何结果（落「可找回」，照旧）。
      expect(history).toHaveLength(0)
      expect(node.result).toBeFalsy()
      expect(node.status).not.toBe('success')
      expect(node.runs?.[0]?.status).not.toBe('success')
      expect(node.runs?.[0]?.resultId).toBeUndefined()
      return
    }
    expect(history.map((entry) => [entry.type, entry.url])).toEqual(Array.from({ length: count }, (_, index) => [kind, `nomi-local://asset/project-a/task-m-${index + 1}.${ext}`]))
    expect(new Set(history.map((entry) => entry.id)).size).toBe(count)
    expect(history.every((entry) => entry.taskId === 'task-m')).toBe(true)
    expect(node.runs).toHaveLength(1)
    expect(node.runs?.[0]).toMatchObject({ status: 'success', resultId: history.at(-1)!.id })
    expect(node.result?.id).toBe(history.at(-1)!.id)
  })
})

describe('画布 ↑ 身份不靠地址', () => {
  it('两次运行回了同一组地址（中转把同一张占位图回给不同任务）：各是各的产物，两次运行各收各的，一份都不被并掉', async () => {
    const id = addImageNode()
    const same: TaskAssetDto[] = [1, 2].map((index) => ({ type: 'image', url: `nomi-local://asset/project-a/shared-${index}.png` }))
    answersWithAssets('task-a', same)
    await confirmAndRunNode(id, { initiator: 'user' })
    answersWithAssets('task-b', same)
    await confirmAndRunNode(id, { initiator: 'user' })

    const node = nodeOf(id)
    expect(versions(node).map((entry) => [entry.id, entry.taskId])).toEqual([
      [`${id}-task-a`, 'task-a'], [`${id}-task-a-2`, 'task-a'], [`${id}-task-b`, 'task-b'], [`${id}-task-b-2`, 'task-b'],
    ])
    const byTask = new Map(node.runs!.map((run) => [run.taskId, run]))
    expect(byTask.get('task-a')).toMatchObject({ status: 'success', resultId: `${id}-task-a-2` })
    expect(byTask.get('task-b')).toMatchObject({ status: 'success', resultId: `${id}-task-b-2` })
    expect(node.result?.id).toBe(`${id}-task-b-2`)
  })
})
