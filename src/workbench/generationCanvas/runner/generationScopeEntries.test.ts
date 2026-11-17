// 五个入口对拍：同一张画布、同一组事实，「生成这一组」在每个入口给出同一种结论——生成中 / 可找回的谁都不发，能发的谁都发。
// 每个入口都走它真实的函数，只替换付费边界（确认卡、真正派发）；任务中心「重试失败」是组件里的一行调用，这里照那一行问。
// 修复前：组生成卡把可找回的行列成可勾（已经付过钱、再付一次），分镜批量的参考卡也会列进来；交接与分镜表各自判一遍。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { GenerationScopePlan } from '../../../../electron/shared/agentCapabilities/generationShotScope'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useGenerationQueueStore } from './generationQueueStore'
import { runGroupGenerate } from '../components/groupGenerate'
import { startGenerationFromComposer } from '../nodes/composerRun'
import { useBatchPlanPreviewStore } from '../components/batchPlanPreview'
import { planCanvasGenerationScope } from './generationScopeFacts'
import { deriveNodeRowExec, deriveStoryboardBatch } from '../../creation/storyboard/exec/storyboardRowStatus'
import { handOverPrecheck } from '../../production/handOverPrecheck'

const captured = vi.hoisted(() => ({ plans: [] as GenerationScopePlan[] }))
vi.mock('../components/batchPlanPreview', async (original) => ({
  ...await original<typeof import('../components/batchPlanPreview')>(),
  // 付费边界：确认卡不弹、不派发，只记下入口交过来的规划。
  confirmAndRunPlan: vi.fn(async (plan: GenerationScopePlan) => { captured.plans.push(plan); return 'declined' }),
}))
vi.mock('./generationRunController', async (original) => ({
  ...await original<typeof import('./generationRunController')>(),
  // 单发的付费边界：只跑「先补参考」那一步（它决定这一组有谁），不开单张卡。
  confirmAndRunNode: vi.fn(async (_id: string, opts: { prepareDependencies?: () => boolean }) => { opts.prepareDependencies?.(); return 'declined' }),
}))

const node = (id: string, patch: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode =>
  ({ id, kind: 'image', title: id, prompt: `${id} prompt`, position: { x: 0, y: 0 }, categoryId: 'shots', status: 'idle', ...patch }) as GenerationCanvasNode
const result = (id: string) => ({ id: `r-${id}`, type: 'image' as const, url: `nomi-local://asset/${id}.png`, createdAt: 1 })

// 同一组事实：没生成的、生成中的、可找回的（已付费、结果待取回）。
const FACTS = () => [
  node('ready'),
  node('running', { status: 'running', runs: [{ id: 'run-running', status: 'running', startedAt: 1 }] as never }),
  node('recoverable', { status: 'recoverable', runs: [{ id: 'run-recoverable', status: 'recoverable', startedAt: 1 }] as never }),
]
const IDS = ['ready', 'running', 'recoverable']

function seed(nodes: GenerationCanvasNode[], edges: GenerationCanvasEdge[] = []) {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes, edges, groups: [], selectedNodeIds: [] })
  // 重装时没在本窗口路上的「生成中」会被收成空闲（防幽灵转圈）；这里要的是此刻真在生成的那一个。
  if (nodes.some((value) => value.id === 'running')) useGenerationCanvasStore.getState().setNodeStatus('running', 'running')
}
const sendable = (plan: GenerationScopePlan) => new Set(plan.rows.filter((row) => row.state === 'checked' || row.state === 'unchecked').map((row) => row.id))
const lastPlan = () => captured.plans.at(-1)!

beforeEach(() => {
  captured.plans.length = 0
  useGenerationQueueStore.setState({ entries: [], batches: {} })
  useBatchPlanPreviewStore.setState({ plan: null })
})
afterEach(() => vi.clearAllMocks())

describe('五个入口对同一组事实给同一种结论', () => {
  it('① 画布「生成整组」：能发的进卡、可勾；生成中 / 可找回的灰着、勾不上', () => {
    seed(FACTS())
    expect(runGroupGenerate(IDS)).toBe('started')
    const plan = lastPlan()
    expect([...sendable(plan)]).toEqual(['ready'])
    expect(plan.rows.filter((row) => row.state === 'disabled').map((row) => [row.id, row.reason])).toEqual([['running', 'generating'], ['recoverable', 'recoverable']])
  })

  it('② 浮框单发（先补参考）：没出图的上游里，只补能发的；生成中 / 可找回的上游不重发、本镜等它', async () => {
    const shot = node('shot')
    seed([...FACTS(), shot], IDS.map((id) => ({ id: `${id}->shot`, source: id, target: 'shot', mode: 'reference' }) as GenerationCanvasEdge))
    await startGenerationFromComposer(shot, false)
    const plan = useBatchPlanPreviewStore.getState().plan!
    expect(plan.members).toEqual(['ready', 'shot'])
    expect(plan.rows.filter((row) => row.state === 'disabled').map((row) => [row.id, row.reason])).toEqual([['running', 'generating'], ['recoverable', 'recoverable']])
    expect(plan.waves).toEqual([['ready']])
    expect(plan.blocked).toMatchObject([{ nodeId: 'shot', reason: 'missing-upstream' }])
  })

  it('③ 分镜表「批量生成」：能发的进批，生成中 / 可找回的各进自己的排除桶', () => {
    seed(FACTS())
    const rows = useGenerationCanvasStore.getState().nodes.map((value) => ({ shot: { id: value.id } as never, exec: deriveNodeRowExec(value) }))
    const batch = deriveStoryboardBatch(rows)
    expect(batch.runnable.map((row) => (row.shot as { id: string }).id)).toEqual(['ready'])
    expect(batch.excluded).toMatchObject({ generating: 1, recoverable: 1 })
  })

  it('③b 分镜表「批量生成」= 生成未生成的：已出图的镜头不进批，算已完成（意图格照分镜今天的样子）', () => {
    seed([node('ready'), node('done', { status: 'success', result: result('done') })])
    const rows = useGenerationCanvasStore.getState().nodes.map((value) => ({ shot: { id: value.id } as never, exec: deriveNodeRowExec(value) }))
    const batch = deriveStoryboardBatch(rows)
    expect(batch.runnable.map((row) => (row.shot as { id: string }).id)).toEqual(['ready'])
    expect(batch.doneCount).toBe(1)
  })

  it('④ 画布助手「交给画布」：生成中 / 可找回的不发，各带自己的原因码；能发的不因范围被拦', () => {
    seed(FACTS())
    const failures = handOverPrecheck(IDS, useGenerationCanvasStore.getState())
    expect(failures.get('running')).toEqual({ kind: 'not_sent', code: 'node_generation_in_flight' })
    expect(failures.get('recoverable')).toEqual({ kind: 'not_sent', code: 'node_needs_reconcile' })
    expect(['node_generation_in_flight', 'node_needs_reconcile']).not.toContain(failures.get('ready')?.code)
  })

  it('⑤ 任务中心「重试失败」：只重试失败的；同一时刻已在生成 / 可找回的不重付', () => {
    seed([node('failed', { status: 'error', error: 'boom' }), ...FACTS().slice(1), node('done', { status: 'success', result: result('done') })])
    const plan = planCanvasGenerationScope('retry-failed', ['failed', 'running', 'recoverable', 'done'], useGenerationCanvasStore.getState())
    expect(plan.members).toEqual(['failed'])
    expect(plan.rows.find((row) => row.id === 'done')?.state).toBe('excluded')
    expect(plan.rows.filter((row) => row.state === 'disabled').map((row) => row.id)).toEqual(['running', 'recoverable'])
  })
})
