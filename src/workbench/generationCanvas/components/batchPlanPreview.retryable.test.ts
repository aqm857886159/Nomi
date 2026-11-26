// 批量跑完的失败汇总：「重试失败的 N 个」只数能直接重跑的那几张。结果不明（可能已扣钱）的不在里面——
// 它们各自的节点上有「再发一次」那张卡；一张能直接重跑的都没有时，动作是去任务中心看。正文仍数全部失败。
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import { runPlanWithToasts } from './batchPlanPreview'
import { planCanvasGenerationScope } from '../runner/generationScopeFacts'
import { runGenerationNodesByPlan } from '../runner/generationRunWaves'
import { withProjectAction, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'

const mocks = vi.hoisted(() => ({
  toastPush: vi.fn(),
  nodes: [] as GenerationCanvasNode[],
  edges: [] as GenerationCanvasEdge[],
}))
vi.mock('../../../ui/toast', () => ({ toast: vi.fn(), useToastStore: { getState: () => ({ push: mocks.toastPush }) } }))
vi.mock('../../api/taskApi', () => ({
  canvasOpenRuns: vi.fn(async () => []),
  consentCanvasShots: vi.fn(async (input: { shots: Array<{ runRecordId: string }> }) => input.shots.map((shot) => `canvas-${shot.runRecordId}`)),
  withdrawCanvasShots: vi.fn(),
}))
vi.mock('../spend/spendConfirm', () => ({
  spendCostKind: vi.fn(() => 'image'),
  spendCostKindForNodes: vi.fn(() => 'image'),
  generationNodeLedger: vi.fn(() => 'run'),
  confirmGenerationSpend: vi.fn(async () => true),
  describeGenerationCost: vi.fn(() => '1 image'),
  generationCostContextForNodes: vi.fn(() => ({ vendorKey: 'v', modelKey: 'm', etaStats: [] })),
  withGenerationEtaStats: vi.fn(async (context: object) => context),
}))
vi.mock('../store/generationCanvasStore', () => ({ useGenerationCanvasStore: { getState: () => ({ nodes: mocks.nodes, edges: mocks.edges }) } }))
vi.mock('../agent/shotVerifyStore', () => ({ verifyShotsAndReport: vi.fn() }))
vi.mock('../runner/catalogTaskResolve', () => ({ selectedVendor: vi.fn(() => 'relay'), selectedModelKey: vi.fn(() => 'image-model') }))
vi.mock('../runner/generationRunWaves', () => ({ runGenerationNodesByPlan: vi.fn() }))

const UNKNOWN = 'NOMI_ERR::submission-unknown::The provider did not confirm this submission'
const node = (id: string): GenerationCanvasNode => ({ id, kind: 'image', title: id, position: { x: 0, y: 0 } }) as GenerationCanvasNode

let projectSession: ProjectSessionTestHarness
const openProject = (): ProjectExecutionContext => withProjectAction((project) => project)!
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.nodes = [node('a'), node('b')]
  projectSession = createProjectSessionTestHarness()
  await projectSession.open('project-a')
})
afterEach(() => { projectSession.dispose() })

async function finishWith(failures: Array<{ nodeId: string; message: string }>) {
  vi.mocked(runGenerationNodesByPlan).mockResolvedValueOnce({
    totalCount: failures.length, skipped: [], successes: [],
    failures: failures.map(({ nodeId, message }) => ({ nodeId, error: new Error(message) })),
  })
  await runPlanWithToasts(planCanvasGenerationScope('group', failures.map(f => f.nodeId), { nodes: mocks.nodes, edges: mocks.edges }), { project: openProject() })
  return mocks.toastPush.mock.calls.at(-1)![0] as { message: string; actionLabel: string; onAction: () => unknown }
}

it('U1：一张结果不明 + 一张普通失败 → 正文数 2，「重试」只数 1，点了只重跑普通那张', async () => {
  const toast = await finishWith([{ nodeId: 'a', message: UNKNOWN }, { nodeId: 'b', message: '500 Internal Server Error' }])
  expect(toast.message).toBe(i18n.t('generationCommon.batchPlan.failed', { count: 2, tail: '' }))
  expect(toast.actionLabel).toBe(i18n.t('generationCommon.batchPlan.retryFailed', { count: 1 }))
  vi.mocked(runGenerationNodesByPlan).mockResolvedValueOnce({ totalCount: 1, skipped: [], successes: [], failures: [] })
  await toast.onAction()
  await vi.waitFor(() => expect(runGenerationNodesByPlan).toHaveBeenCalledTimes(2))
  expect(vi.mocked(runGenerationNodesByPlan).mock.calls[1][0].waves.flat()).toEqual(['b'])
})

it('U1：全是结果不明 → 没有「重试」，动作是去任务中心', async () => {
  const toast = await finishWith([{ nodeId: 'a', message: UNKNOWN }, { nodeId: 'b', message: UNKNOWN }])
  expect(toast.message).toBe(i18n.t('generationCommon.batchPlan.failed', { count: 2, tail: '' }))
  expect(toast.actionLabel).toBe(i18n.t('taskCenter.title'))
})
