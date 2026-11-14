// 一次出几份 × 镜头结果归谁（方向检查 docs/engineering/direction-checks/2026-11-09-multi-result-landing.md 硬约束 4）：
// 两次运行倒序到达时，当前选中和时间轴不被旧运行抢走；四个候选不会变成四个镜头（时间轴只对账一次、只用当前那份）；
// 旧运行的每一份都留在这一镜的版本历史里、记在它自己的运行记录上。
// 「几乎同时」靠压住执行器的回话造出来；旧数据用 v0.24.0 真实落盘的节点。
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import type { GenerationNodeExecutorContext } from './generationNodeExecutor'
import type { GenerationNodeResults } from './catalogTaskResultParse'

const calls = vi.hoisted(() => ({ execute: vi.fn(), open: vi.fn(), confirm: vi.fn(), poll: vi.fn() }))
vi.mock('../../api/taskApi', () => ({
  canvasOpenRuns: calls.open, releaseCanvasShotRun: vi.fn(async () => undefined), withdrawCanvasShots: vi.fn(),
  pollCanvasShotRun: calls.poll, consentCanvasShots: vi.fn(), mintSpendGrant: vi.fn(), fetchWorkbenchTaskResultByVendor: vi.fn(),
}))
vi.mock('./generationNodeExecutor', () => ({ generationNodeExecutor: calls.execute }))
vi.mock('./assetUploadConsent', async (original) => ({ ...await original<typeof import('./assetUploadConsent')>(), resolveAssetUploadConsent: async () => ({ allowed: true, needsConfirmation: false }) }))
vi.mock('./nodeModelHealth', () => ({ recordNodeModelFailure: vi.fn(), recordNodeModelSuccess: vi.fn() }))
vi.mock('../../library/localProjectStore', () => ({ readLocalProjectAsync: vi.fn(async () => null), saveLocalProject: vi.fn(async () => null) }))

import { confirmAndRunNode } from './generationRunController'
import { RecoverableTimeoutError } from './recoverableTimeout'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useGenerationQueueStore } from './generationQueueStore'
import { useSpendConfirmStore } from '../spend/spendConfirm'
import { useWorkbenchStore } from '../../workbenchStore'
import { setCanvasEventSinkForTests } from '../events/canvasEventEmitter'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'
import { createProjectSessionTestHarness, testProjectBinding, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'

type Attempt = { runId: string; ctx: GenerationNodeExecutorContext; resolve: (results: GenerationNodeResults) => void; reject: (error: unknown) => void }
let attempts: Attempt[] = []
let session: ProjectSessionTestHarness
let timeline: ReturnType<typeof vi.spyOn>

const store = () => useGenerationCanvasStore.getState()
const live = (id: string) => store().nodes.find((node) => node.id === id)
const four = (prefix: string): GenerationNodeResults => {
  const [first, ...rest] = [1, 2, 3, 4].map((index): GenerationNodeResult => ({ id: `${prefix}-${index}`, type: 'image', url: `nomi-local://asset/project-a/${prefix}-${index}.png`, taskId: prefix, createdAt: index }))
  return [first!, ...rest]
}
/** 这一镜留下的全部结果号（当前选中本身也在版本历史里，去重）。 */
const allIds = (node: GenerationCanvasNode | undefined) => [...new Set([node?.result, ...(node?.history ?? [])].filter(Boolean).map((entry) => entry!.id))]
const record = (node: GenerationCanvasNode | undefined, runId: string) => node?.runs?.find((run) => run.id === runId)
const timelineIds = () => timeline.mock.calls.map((call: unknown[]) => (call[1] as GenerationNodeResult).id)

async function nextAttempt(count: number): Promise<Attempt> {
  await vi.waitFor(() => expect(attempts.length).toBeGreaterThanOrEqual(count))
  return attempts[count - 1]
}

async function observerSettles(projectId: string, nodeId: string, runRecordId: string): Promise<void> {
  const { handleCapabilityApply } = await import('../../capability/capabilityApplyHandler')
  await handleCapabilityApply('canvas.run-settled', { ...testProjectBinding(projectId), nodeId, runRecordId }).catch(() => undefined)
}

beforeEach(async () => {
  vi.clearAllMocks()
  attempts = []
  calls.execute.mockReset().mockImplementation((_node: GenerationCanvasNode, ctx: GenerationNodeExecutorContext) => new Promise<GenerationNodeResults>((resolve, reject) => {
    attempts.push({ runId: String(ctx.idempotencyKey), ctx, resolve, reject })
  }))
  calls.open.mockReset().mockResolvedValue([])
  calls.poll.mockReset().mockResolvedValue(null)
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

describe('两次运行各出四份，倒序到达', () => {
  it('新的四份先成功、旧的四份后到：八份都在版本历史，当前选中和时间轴都留在新运行的最后一份，各归各的记录', async () => {
    const { id, A, C, old, resend } = await resendWhileOldRuns()
    C.resolve(four('task-c')); await resend
    A.resolve(four('task-a')); await old

    const node = live(id)
    expect(node?.result?.id).toBe('task-c-4')
    expect(allIds(node).sort()).toEqual([...four('task-a'), ...four('task-c')].map((entry) => entry.id).sort())
    expect(record(node, A.runId)).toMatchObject({ status: 'success', resultId: 'task-a-4' })
    expect(record(node, C.runId)).toMatchObject({ status: 'success', resultId: 'task-c-4', taskId: 'task-c' })
    // 四个候选不变成四个镜头：时间轴只按当前选中对账一次，旧运行晚到不改它。
    expect(timelineIds()).toEqual(['task-c-4'])
    expect(attempts).toHaveLength(2)
  })

  it('新的那次失败、旧的四份后到：付了钱的旧四份都落，最后一份成为当前选中', async () => {
    const { id, A, C, old, resend } = await resendWhileOldRuns()
    C.reject(new Error('500 Internal Server Error')); await resend
    A.resolve(four('task-a')); await old

    const node = live(id)
    expect(node).toMatchObject({ status: 'success', result: { id: 'task-a-4' } })
    expect(allIds(node).sort()).toEqual(four('task-a').map((entry) => entry.id).sort())
    expect(record(node, A.runId)).toMatchObject({ status: 'success', resultId: 'task-a-4' })
    expect(record(node, C.runId)?.status).toBe('error')
  })

  it('旧的那次交给了主进程观察者、收尾时带回四份：四份按它自己的运行号进历史，新运行的当前选中和时间轴不动', async () => {
    const id = store().addNode({ kind: 'image', prompt: 'shot 1' }).id
    const old = confirmAndRunNode(id, { initiator: 'user' })
    const A = await nextAttempt(1)
    A.ctx.onProgress?.({ phase: 'generating', message: 'old', taskId: 'task-a' })
    A.reject(new RecoverableTimeoutError({ taskId: 'task-a', vendor: 'v' } as never)); await old.catch(() => undefined)
    calls.open.mockResolvedValue([{ nodeId: id, runId: `canvas-${A.runId}`, reason: 'in_flight', hasTaskId: true }])
    const resend = confirmAndRunNode(id, { initiator: 'user', resend: true })
    const C = await nextAttempt(2)
    C.resolve(four('task-c')); await resend

    const urls = [1, 2, 3, 4].map((index) => `nomi-local://asset/project-a/observed-${index}.png`)
    calls.poll.mockResolvedValue({ id: 'task-a', kind: 'text_to_image', status: 'succeeded', raw: {}, assets: urls.map((url) => ({ type: 'image', url })) })
    await observerSettles('project-a', id, A.runId)

    const node = live(id)
    expect(node?.result?.id).toBe('task-c-4')
    const observed = (node?.history ?? []).filter((entry) => entry.taskId === 'task-a').sort((left, right) => (left.versionNo ?? 0) - (right.versionNo ?? 0))
    expect(observed.map((entry) => entry.url)).toEqual(urls)
    expect(observed.map((entry) => entry.id)).toEqual([`${id}-task-a`, `${id}-task-a-2`, `${id}-task-a-3`, `${id}-task-a-4`])
    expect(record(node, A.runId)).toMatchObject({ status: 'success', taskId: 'task-a', resultId: `${id}-task-a-4` })
    expect(record(node, C.runId)).toMatchObject({ status: 'success', resultId: 'task-c-4' })
    expect(timelineIds()).toEqual(['task-c-4'])
  })
})

describe('v0.24.0 真实落盘的节点（旧版把被拒那下记成了最新运行）', () => {
  const snapshot = path.resolve('tests/fixtures/old-user-data/runs/v0.24.0-canvas-interrupted')
  const manifest = JSON.parse(fs.readFileSync(path.join(snapshot, 'manifest.json'), 'utf8')) as { nodeId: string; runRecordId: string }
  const oldNode = (): GenerationCanvasNode => JSON.parse(fs.readFileSync(path.join(snapshot, 'node.json'), 'utf8'))

  it('原样打开：结果、历史、运行记录都不变（旧数据就是「一份的集合」，不需要迁移）', () => {
    store().restoreSnapshot({ nodes: [oldNode()], edges: [], groups: [] })
    const opened = live(manifest.nodeId)!
    const saved = oldNode()
    expect({ status: opened.status, error: opened.error, runs: opened.runs, result: opened.result, history: opened.history ?? [] })
      .toEqual({ status: saved.status, error: saved.error, runs: saved.runs, result: saved.result, history: saved.history ?? [] })
  })

  it('观察者为那条旧记录收尾带回四份：四份都按它的运行号落到这个旧节点，记录收成成功、指向最后一份', async () => {
    store().restoreSnapshot({ nodes: [oldNode()], edges: [], groups: [] })
    const urls = [1, 2, 3, 4].map((index) => `nomi-local://asset/project-a/old-run-${index}.png`)
    calls.poll.mockResolvedValue({ id: 'task-old', kind: 'text_to_image', status: 'succeeded', raw: {}, assets: urls.map((url) => ({ type: 'image', url })) })
    await observerSettles('project-a', manifest.nodeId, manifest.runRecordId)

    const node = live(manifest.nodeId)
    const landed = [node?.result, ...(node?.history ?? [])].filter((entry) => entry?.taskId === 'task-old')
    expect(new Set(landed.map((entry) => entry!.url))).toEqual(new Set(urls))
    expect(new Set(landed.map((entry) => entry!.id)).size).toBe(4)
    expect(record(node, manifest.runRecordId)).toMatchObject({ status: 'success', resultId: `${manifest.nodeId}-task-old-4` })
    expect(node).toMatchObject({ status: 'success', result: { id: `${manifest.nodeId}-task-old-4` } })
    expect(node?.runs).toHaveLength(oldNode().runs?.length ?? 0)
  })
})
