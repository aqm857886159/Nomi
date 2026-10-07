// 一键派生走真实路径（真实画布 store）：只准备、不花钱——派生后供应商收到的提交数是 0、Run 账本没有新条目；
// 花钱是用户随后在新节点上点 ↑（confirmAndRunNode，现有入口，一个字没改）。
// 设计卡：docs/plan/2026-10-04-node-quick-actions-batch1.md §2；用户 2026-10-05 拍板：派生不自动开跑。
// 渲染层 ↔ 主进程那条边换成假的（同 canvasSingleSubmitCharacterization.test.ts）：假供应商，全程不花真钱。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelOption } from '../../../config/models'
import { confirmAndRunNode } from '../runner/generationRunController'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useGenerationQueueStore } from '../runner/generationQueueStore'
import { useSpendConfirmStore } from '../spend/spendConfirm'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import type { WorkbenchProjectRecordV1 } from '../../project/projectRecordSchema'
import type { TaskRequestDto, TaskResultDto } from '../../api/taskApi'
import { deriveFromNode, isDerivedPromptReady, QUICK_ACTION_META_KEY, readQuickActionMeta, type DeriveHost } from './deriveFromNode'

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
vi.mock('../../api/modelCatalogApi', async (original) => ({
  ...await original<typeof import('../../api/modelCatalogApi')>(),
  listWorkbenchModelCatalogVendors: async () => { throw new Error('no catalog bridge in tests') },
}))
vi.mock('../runner/assetUploadConsent', async (original) => ({
  ...await original<typeof import('../runner/assetUploadConsent')>(),
  resolveAssetUploadConsent: async () => ({ allowed: true, needsConfirmation: false }),
}))

const LOCAL_URL = 'nomi-local://asset/project-a/out.png'
const TEMPLATE = '这是一张 3×3 机位联系表：同一时刻、同一场景，只换九个机位。'
const MODEL: ModelOption = { value: 'img-model', label: 'Img', vendor: 'acme', modelKey: 'img-model' }

function succeeded(request: Pick<TaskRequestDto, 'kind'>, id = 'task-sync'): TaskResultDto {
  return { id, kind: request.kind, status: 'succeeded', assets: [{ type: 'image', url: LOCAL_URL }], raw: {} }
}

let session: ProjectSessionTestHarness
beforeEach(async () => {
  calls.disk.clear()
  calls.mint.mockReset().mockResolvedValue('grant-x')
  calls.runTask.mockReset().mockImplementation(async (_vendor: string, request: TaskRequestDto) => succeeded(request))
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

const store = () => useGenerationCanvasStore.getState()
const nodeOf = (id: string) => store().nodes.find((node) => node.id === id)!

function addSource(over: { kind?: 'image' | 'text'; withResult?: boolean } = {}): string {
  const node = store().addNode({ kind: over.kind ?? 'image', title: '雨夜街口', prompt: 'a rainy street', position: { x: 100, y: 40 } })
  store().updateNode(node.id, {
    status: 'success',
    meta: { modelKey: 'img-model', modelVendor: 'acme', vendor: 'acme' },
    ...(over.withResult === false ? {} : { result: { id: 'r', type: 'image', url: LOCAL_URL, createdAt: 1 } }),
  })
  store().selectNode(node.id)
  return node.id
}

function hostWith(over: Partial<DeriveHost> = {}): DeriveHost {
  return {
    editModelOptions: [MODEL],
    resolveEffectPrompt: async (effectId) => (effectId === 'effect-multi-angle-grid' ? TEMPLATE : null),
    ...over,
  }
}

const derive = (sourceNodeId: string, host: DeriveHost, actionId: 'multi-angle-grid' | 'next-moment' | 'upscale' = 'multi-angle-grid') =>
  deriveFromNode({ sourceNodeId, actionId }, host)
const derivedIdOf = (outcome: Awaited<ReturnType<typeof derive>>): string => {
  if (outcome.status !== 'prepared') throw new Error('expected prepared')
  return outcome.derivedNodeId
}

describe('一键派生 —— 新节点 + 连参考 + 填模板 + 沿用模型，到此为止（不提交、不扣费）', () => {
  it('点一次：供应商收到的提交数 0、Run 账本没有新条目、不弹卡、不铸令牌；新节点空闲', async () => {
    const source = addSource()

    const derivedId = derivedIdOf(await derive(source, hostWith()))

    expect(calls.runTask).not.toHaveBeenCalled()
    expect(calls.mint).not.toHaveBeenCalled()
    expect(calls.confirm).not.toHaveBeenCalled()
    expect(nodeOf(derivedId)).toMatchObject({ status: 'idle' })
    expect(nodeOf(derivedId).runs ?? []).toHaveLength(0)
    expect(nodeOf(source).runs ?? []).toHaveLength(0)
    expect(useGenerationQueueStore.getState().entries).toHaveLength(0)
  })

  it('新节点长什么样：右侧、连着一条来自源的参考边、模板在 prompt 里、沿用源的模型、记着自己是谁派生的；选中留在源上', async () => {
    const source = addSource()

    const derived = nodeOf(derivedIdOf(await derive(source, hostWith())))

    expect(derived.kind).toBe('image')
    expect(derived.position.x).toBeGreaterThan(nodeOf(source).position.x)
    expect(derived.prompt).toBe(TEMPLATE)
    expect(derived.title).toContain('雨夜街口')
    expect(store().edges.filter((edge) => edge.target === derived.id).map((edge) => edge.source)).toEqual([source])
    expect(derived.meta).toMatchObject({ modelKey: 'img-model', modelVendor: 'acme' })
    expect(readQuickActionMeta(derived)).toEqual({ id: 'multi-angle-grid', sourceNodeId: source, grid: { rows: 3, cols: 3 }, promptReady: true })
    expect((derived.meta as Record<string, unknown>)[QUICK_ACTION_META_KEY]).toBeDefined()
    expect(store().selectedNodeIds).toEqual([source])
    expect(store().groups).toHaveLength(0)
  })

  it('连点两次：建两个空闲节点，仍然 0 提交、0 条 Run', async () => {
    const source = addSource()
    const host = hostWith()

    const [first, second] = await Promise.all([derive(source, host), derive(source, host)])

    expect(derivedIdOf(first)).not.toBe(derivedIdOf(second))
    expect(store().nodes.filter((node) => readQuickActionMeta(node))).toHaveLength(2)
    expect(calls.runTask).not.toHaveBeenCalled()
    for (const outcome of [first, second]) expect(nodeOf(derivedIdOf(outcome)).runs ?? []).toHaveLength(0)
  })

  it('用户随后在新节点上点 ↑：走现有入口，恰好 1 笔提交、1 条 Run，源节点不受影响', async () => {
    const source = addSource()
    const derivedId = derivedIdOf(await derive(source, hostWith()))
    expect(calls.runTask).not.toHaveBeenCalled()

    await expect(confirmAndRunNode(derivedId, { initiator: 'user' })).resolves.toBe('started')

    expect(calls.runTask).toHaveBeenCalledTimes(1)
    expect(calls.runTask.mock.calls[0]?.[1]).toMatchObject({ extras: { nodeId: derivedId } })
    expect(nodeOf(derivedId).runs).toHaveLength(1)
    expect(nodeOf(derivedId)).toMatchObject({ status: 'success', result: { url: LOCAL_URL } })
    expect(nodeOf(source).runs ?? []).toHaveLength(0)
  })

  it('「已备好」只在派生后、点 ↑ 之前成立：派生后是 true，点 ↑ 之后变 false；「+」新建的空节点从来不是', async () => {
    const source = addSource()
    const derivedId = derivedIdOf(await derive(source, hostWith()))
    expect(isDerivedPromptReady(nodeOf(derivedId))).toBe(true)
    const blank = store().addNode({ kind: 'image', prompt: '', select: false })
    expect(isDerivedPromptReady(nodeOf(blank.id))).toBe(false)

    await confirmAndRunNode(derivedId, { initiator: 'user' })

    expect(isDerivedPromptReady(nodeOf(derivedId))).toBe(false)
  })

  it('一个撤销点：⌘Z 一下，新节点和它的入边一起没了；源节点还在', async () => {
    const source = addSource()

    const derivedId = derivedIdOf(await derive(source, hostWith()))
    expect(store().nodes.some((node) => node.id === derivedId)).toBe(true)

    store().undo()

    expect(store().nodes.some((node) => node.id === derivedId)).toBe(false)
    expect(store().edges.some((edge) => edge.target === derivedId)).toBe(false)
    expect(store().nodes.some((node) => node.id === source)).toBe(true)
  })
})

describe('一键派生 —— 点不了的时候一个节点都不建', () => {
  it.each([
    ['效果库里缺这一条', { resolveEffectPrompt: async () => null }, 'missing-effect'],
    ['没有能改图的模型', { editModelOptions: [] }, 'no-image-model'],
    ['放大要「放大」档的模型，目录里没有', { editModelOptions: [MODEL] }, 'no-upscale-model'],
  ] as const)('%s', async (_label, over, reason) => {
    const source = addSource()
    const host = hostWith(over)

    const outcome = await derive(source, host, reason === 'no-upscale-model' ? 'upscale' : 'multi-angle-grid')

    expect(outcome).toEqual({ status: 'blocked', reason })
    expect(calls.runTask).not.toHaveBeenCalled()
    expect(store().nodes).toHaveLength(1)
    expect(store().edges).toHaveLength(0)
  })

  it('源节点不见了 / 不是一张出过图的图片：不建、不发', async () => {
    const host = hostWith()
    expect(await derive('ghost', host)).toEqual({ status: 'blocked', reason: 'source-missing' })
    for (const source of [addSource({ kind: 'text', withResult: false }), addSource({ withResult: false })]) {
      expect(await derive(source, host)).toEqual({ status: 'blocked', reason: 'source-not-referenceable' })
    }
    expect(calls.runTask).not.toHaveBeenCalled()
    expect(store().nodes).toHaveLength(2)
  })
})
