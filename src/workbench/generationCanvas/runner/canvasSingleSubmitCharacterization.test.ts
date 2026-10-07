// 特征测试：画布单节点 ↑ 的用户可见行为（发动机收敛第一刀 第 1–2 步动手前钉住，收敛后断言不变）。
// 设计卡：docs/plan/2026-10-05-engine-convergence-cut1-step12-design-card.md §7。
//
// 走真实的控制器（confirmAndRunNode / regenerateNodeInPlace）+ 真实的执行器（generationNodeExecutor →
// runCatalogGenerationTask），只在渲染层 ↔ 主进程那条边上换成假的（taskApi）。
// 收敛后这条边从「铸令牌 + runTask + 查任务」换成了单镜 Run 的「交 / 查」（submitCanvasShotRun / pollCanvasShotRun）：
// 节点状态、结果落地、任务队列、取消的样子一条没改；改的只有边上的调用形状（不再铸令牌，交的时候带这一次运行记录号）。
// 「写出去之后断了」那一条按 2026-10-05 拍板（F3）翻成「结果没法确认、核对前不许再点」；「当场拒绝」本来就是失败可再点。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmAndRunNode, regenerateNodeInPlace } from './generationRunController'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useGenerationQueueStore } from './generationQueueStore'
import { useSpendConfirmStore } from '../spend/spendConfirm'
import { requestTaskCancel } from './localTaskControl'
import { classifyGenerationError } from '../../observability/classifyError'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import type { WorkbenchProjectRecordV1 } from '../../project/projectRecordSchema'
import type { TaskRequestDto, TaskResultDto } from '../../api/taskApi'

/** 主进程那一侧（单镜 Run）的假样子：交 = (vendor, request)，查 = (taskId, taskKind)。 */
type SubmitInput = { projectId: string; nodeId: string; runRecordId: string; vendor: string; request: TaskRequestDto }

const calls = vi.hoisted(() => ({
  disk: new Map<string, unknown>(),
  mint: vi.fn(),
  runTask: vi.fn(),
  fetchResult: vi.fn(),
  release: vi.fn(),
  confirm: vi.fn(),
}))
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
  mintSpendGrant: calls.mint,
  submitCanvasShotRun: (input: SubmitInput) =>
    calls.runTask(input.vendor, { ...input.request, extras: { ...input.request.extras, runRecordId: input.runRecordId } }, input.projectId),
  pollCanvasShotRun: async (input: { projectId: string; runRecordId: string }) => {
    const latest = calls.runTask.mock.results.at(-1)?.value as Promise<TaskResultDto> | undefined
    const submitted = latest ? await latest.catch(() => undefined) : undefined
    const response = await calls.fetchResult({ taskId: submitted?.id ?? '', taskKind: submitted?.kind ?? 'text_to_image', vendor: 'acme', projectId: input.projectId, runRecordId: input.runRecordId })
    return response.result
  },
  releaseCanvasShotRun: calls.release,
}))
// 目录解析不是这里要钉的东西：拿不到目录 = 信任节点上钉的供应商（catalogTaskResolve 的既有退路）。
vi.mock('../../api/modelCatalogApi', async (original) => ({
  ...await original<typeof import('../../api/modelCatalogApi')>(),
  listWorkbenchModelCatalogVendors: async () => { throw new Error('no catalog bridge in tests') },
}))
vi.mock('./assetUploadConsent', async (original) => ({
  ...await original<typeof import('./assetUploadConsent')>(),
  resolveAssetUploadConsent: async () => ({ allowed: true, needsConfirmation: false }),
}))

const IMAGE_META = { modelKey: 'img-model', modelVendor: 'acme', vendor: 'acme' }
const LOCAL_URL = 'nomi-local://asset/project-a/out.png'

function succeeded(request: Pick<TaskRequestDto, 'kind'>, id = 'task-sync'): TaskResultDto {
  return { id, kind: request.kind, status: 'succeeded', assets: [{ type: 'image', url: LOCAL_URL }], raw: {} }
}

/** 主进程按 IPC 结构化标记送过来的错误（runTaskIpcGuard 的编码）。 */
function structuredIpcError(structured: Record<string, unknown>, message: string): Error {
  return new Error(`NOMI_VENDOR_ERR_B64::${Buffer.from(JSON.stringify(structured), 'utf8').toString('base64')}:: ${message}`)
}

let session: ProjectSessionTestHarness
beforeEach(async () => {
  calls.disk.clear()
  calls.mint.mockReset().mockImplementation(async () => `grant-${calls.mint.mock.calls.length}`)
  calls.runTask.mockReset()
  calls.fetchResult.mockReset()
  calls.release.mockReset().mockResolvedValue(undefined)
  calls.confirm.mockReset().mockResolvedValue(true)
  vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockImplementation(calls.confirm)
  session = createProjectSessionTestHarness()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
  useGenerationQueueStore.setState({ entries: [], batches: {} })
  await session.open('project-a')
})
afterEach(() => { session.dispose(); vi.restoreAllMocks() })

function addImageNode(prompt = 'a red cube') {
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt })
  useGenerationCanvasStore.getState().updateNode(node.id, { meta: { ...IMAGE_META } })
  return node.id
}

const nodeOf = (id: string) => useGenerationCanvasStore.getState().nodes.find((node) => node.id === id)!
const queueOf = (id: string) => useGenerationQueueStore.getState().entries.filter((entry) => entry.nodeId === id)
const submitted = (index: number) => calls.runTask.mock.calls[index]?.[1] as TaskRequestDto

describe('画布单节点 ↑ —— 用户看得见的样子', () => {
  it('用户点 ↑：不弹卡，只发一笔，结果落在节点上，任务队列记成功', async () => {
    const id = addImageNode()
    calls.runTask.mockImplementation(async (_vendor: string, request: TaskRequestDto) => succeeded(request))

    await expect(confirmAndRunNode(id, { initiator: 'user' })).resolves.toBe('started')

    expect(calls.confirm).not.toHaveBeenCalled()
    expect(calls.runTask).toHaveBeenCalledOnce()
    const [vendor, request, projectId] = calls.runTask.mock.calls[0] as [string, TaskRequestDto, string]
    expect(vendor).toBe('acme')
    expect(projectId).toBe('project-a')
    // 收敛后：不再铸令牌——批准就是这一下点击，记在主进程的单镜 Run 里。
    expect(calls.mint).not.toHaveBeenCalled()
    expect(request.extras).toMatchObject({ nodeId: id })
    expect(request.extras?.grantId).toBeUndefined()
    // 同一次意图 = 节点这一次的运行记录号：幂等键与单镜 Run 号都认它（重试不二次下单靠它）。
    expect(request.extras?.idempotencyKey).toBe(nodeOf(id).runs?.[0]?.id)
    expect(request.extras?.runRecordId).toBe(nodeOf(id).runs?.[0]?.id)
    const node = nodeOf(id)
    expect(node.status).toBe('success')
    expect(node.result).toMatchObject({ type: 'image', url: LOCAL_URL })
    expect(node.runs?.[0]?.status).toBe('success')
    expect(queueOf(id).map((entry) => entry.state)).toEqual(['success'])
  })

  it('受理后轮询：等待期间节点挂着任务号（重开能找回），出片后落节点', async () => {
    const id = addImageNode()
    calls.runTask.mockImplementation(async (_vendor: string, request: TaskRequestDto) => ({ id: 'task-async', kind: request.kind, status: 'queued', assets: [], raw: {} }))
    let progressTaskIdWhileWaiting = ''
    calls.fetchResult.mockImplementation(async (input: { taskId: string; taskKind: TaskRequestDto['kind'] }) => {
      progressTaskIdWhileWaiting = nodeOf(id).progress?.taskId ?? ''
      return { vendor: 'acme', result: succeeded({ kind: input.taskKind }, input.taskId) }
    })

    await confirmAndRunNode(id, { initiator: 'user' })

    expect(calls.runTask).toHaveBeenCalledOnce()
    expect(calls.fetchResult).toHaveBeenCalledOnce()
    // 收敛后：查也经这一次运行的单镜 Run。
    expect(calls.fetchResult.mock.calls[0]?.[0]).toMatchObject({ taskId: 'task-async', vendor: 'acme', projectId: 'project-a', runRecordId: nodeOf(id).runs?.[0]?.id })
    expect(progressTaskIdWhileWaiting).toBe('task-async')
    expect(nodeOf(id)).toMatchObject({ status: 'success', result: { url: LOCAL_URL } })
    expect(queueOf(id).map((entry) => entry.state)).toEqual(['success'])
  })

  it('供应商当场明确拒绝：节点失败带原话，任务队列记失败；用户改了再点 ↑ 能重新发（F3：没受理、没扣钱）', async () => {
    const id = addImageNode()
    calls.runTask.mockRejectedValueOnce(new Error('acme rejected the request: prompt violates content policy'))

    await expect(confirmAndRunNode(id, { initiator: 'user' })).resolves.toBe('started')

    expect(calls.runTask).toHaveBeenCalledOnce()
    expect(nodeOf(id).status).toBe('error')
    expect(nodeOf(id).runs?.[0]).toMatchObject({ status: 'error', error: expect.stringContaining('content policy') })
    expect(queueOf(id).map((entry) => entry.state)).toEqual(['error'])

    calls.runTask.mockImplementation(async (_vendor: string, request: TaskRequestDto) => succeeded(request))
    useGenerationCanvasStore.getState().updateNode(id, { prompt: 'a blue cube' })
    await confirmAndRunNode(id, { initiator: 'user' })

    expect(calls.mint).not.toHaveBeenCalled()
    expect(calls.runTask).toHaveBeenCalledTimes(2)
    // 再点一次 = 新的一次运行、新的单镜 Run。
    expect(submitted(1).extras?.runRecordId).not.toBe(submitted(0).extras?.runRecordId)
    expect(nodeOf(id)).toMatchObject({ status: 'success', result: { url: LOCAL_URL } })
  })

  it('写出去之后连接断了：结果没法确认（指去核对），这个节点在核对前再点被拒（F3，2026-10-05 拍板）', async () => {
    const id = addImageNode()
    // 主进程：这一次的单镜 Run 记成 submission_unknown，同一次意图的重试照 Run 账本回同一个「结果未知」；
    // 新的一次点击被准入口拒（这一镜在核对前不许再发）。
    calls.runTask.mockImplementation(async (_vendor: string, request: TaskRequestDto) => {
      if (request.extras?.runRecordId === submitted(0).extras?.runRecordId) {
        throw new Error('NOMI_ERR::submission-unknown:: acme create failed: socket hang up')
      }
      throw structuredIpcError({ code: 'production_shot_claimed', reason: 'needs_reconcile' }, 'production_shot_claimed: needs_reconcile')
    })

    await confirmAndRunNode(id, { initiator: 'user' })

    // 同一次意图（同一个运行记录号）：主进程只交过一笔；控制器的重试只是重放。
    expect(new Set(calls.runTask.mock.calls.map((call) => (call[1] as TaskRequestDto).extras?.runRecordId)).size).toBe(1)
    expect(nodeOf(id).status).toBe('error')
    expect(classifyGenerationError(nodeOf(id).runs?.[0]?.error ?? '').kind).toBe('submission-unknown')
    expect(queueOf(id).map((entry) => entry.state)).toEqual(['error'])

    calls.runTask.mockClear()
    await confirmAndRunNode(id, { initiator: 'user' })
    expect(classifyGenerationError(nodeOf(id).runs?.[0]?.error ?? '').primary).toBe('reconcile')
  })

  it('供应商任务在轮询中失败：节点失败，任务队列记失败', async () => {
    const id = addImageNode()
    calls.runTask.mockImplementation(async (_vendor: string, request: TaskRequestDto) => ({ id: 'task-async', kind: request.kind, status: 'queued', assets: [], raw: {} }))
    calls.fetchResult.mockImplementation(async (input: { taskId: string; taskKind: TaskRequestDto['kind'] }) => ({
      vendor: 'acme', result: { id: input.taskId, kind: input.taskKind, status: 'failed', assets: [], raw: {}, error: 'upstream render failed' },
    }))

    await confirmAndRunNode(id, { initiator: 'user' })

    expect(nodeOf(id).status).toBe('error')
    expect(queueOf(id).map((entry) => entry.state)).toEqual(['error'])
    expect(nodeOf(id).result).toBeUndefined()
  })

  it('等结果时用户点停：节点回空闲，任务队列记取消，不再查结果，结果不落', async () => {
    const id = addImageNode()
    calls.runTask.mockImplementation(async (_vendor: string, request: TaskRequestDto) => ({ id: 'task-async', kind: request.kind, status: 'queued', assets: [], raw: {} }))
    calls.fetchResult.mockImplementation(async (input: { taskId: string; taskKind: TaskRequestDto['kind'] }) => {
      requestTaskCancel(nodeOf(id), () => undefined)
      return { vendor: 'acme', result: succeeded({ kind: input.taskKind }, input.taskId) }
    })

    await confirmAndRunNode(id, { initiator: 'user' })

    expect(calls.fetchResult).toHaveBeenCalledOnce()
    expect(nodeOf(id).status).toBe('idle')
    expect(nodeOf(id).result).toBeUndefined()
    expect(queueOf(id).map((entry) => entry.state)).toEqual(['cancelled'])
    // 收敛后：渲染层不等了，那一笔交给主进程观察者收完（钱花了的结果照样进项目，节点不落）。
    expect(calls.release).toHaveBeenCalledWith({ projectId: 'project-a', runRecordId: submitted(0).extras?.runRecordId })
  })

  it('提交还在路上时用户点停：节点回空闲，不进轮询，任务队列记取消', async () => {
    const id = addImageNode()
    calls.runTask.mockImplementation(async (_vendor: string, request: TaskRequestDto) => {
      requestTaskCancel(nodeOf(id), () => undefined)
      return { id: 'task-async', kind: request.kind, status: 'queued', assets: [], raw: {} }
    })

    await confirmAndRunNode(id, { initiator: 'user' })

    expect(calls.fetchResult).not.toHaveBeenCalled()
    expect(nodeOf(id).status).toBe('idle')
    expect(queueOf(id).map((entry) => entry.state)).toEqual(['cancelled'])
  })

  it('原地重新生成：同一个节点、结果进版本历史，旧结果不丢', async () => {
    const id = addImageNode()
    calls.runTask.mockImplementation(async (_vendor: string, request: TaskRequestDto) => succeeded(request, `task-${calls.runTask.mock.calls.length}`))
    await confirmAndRunNode(id, { initiator: 'user' })
    const first = nodeOf(id).result

    await expect(regenerateNodeInPlace(id, { initiator: 'user' })).resolves.toBe('started')

    expect(calls.confirm).not.toHaveBeenCalled()
    expect(calls.mint).not.toHaveBeenCalled()
    expect(submitted(1).extras?.nodeId).toBe(id)
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(1)
    const node = nodeOf(id)
    expect(node.result?.id).not.toBe(first?.id)
    expect((node.history ?? []).some((entry) => entry.id === first?.id)).toBe(true)
  })

  it('Agent 发起的单节点生成：先弹卡，用户点取消就一笔都不发', async () => {
    const id = addImageNode()
    calls.confirm.mockResolvedValueOnce(false)

    await expect(confirmAndRunNode(id, { initiator: 'agent' })).resolves.toBe('declined')

    expect(calls.confirm).toHaveBeenCalledOnce()
    expect(calls.mint).not.toHaveBeenCalled()
    expect(calls.runTask).not.toHaveBeenCalled()
    expect(nodeOf(id).status ?? 'idle').toBe('idle')
  })
})
