// 「生成全部」确认卡逐项勾选的行为（走真实 confirmAndRunPlan / buildDependencyWaves，只替换边界：付费卡、出价 IPC、真正派发）：
//   未生成的默认勾、已生成的默认不勾、生成中的锁住；去掉的那一项不进执行计划、不开出价、不派发。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { PlanRow } from '../../shared/PlanRows'
import { runGenerationNodesByPlan } from '../runner/generationRunWaves'

const mocks = vi.hoisted(() => ({
  confirmGenerationSpend: vi.fn(),
  consentCanvasShots: vi.fn(async (input: { shots: Array<{ runRecordId: string }> }) => input.shots.map((shot) => `canvas-${shot.runRecordId}`)),
  nodes: [] as GenerationCanvasNode[],
  edges: [] as GenerationCanvasEdge[],
}))

vi.mock('../../../ui/toast', () => ({ toast: vi.fn(), useToastStore: { getState: () => ({ push: vi.fn(), remove: vi.fn() }) } }))
vi.mock('../../api/taskApi', () => ({ consentCanvasShots: mocks.consentCanvasShots, withdrawCanvasShots: vi.fn() }))
vi.mock('../spend/spendConfirm', () => ({
  confirmGenerationSpend: mocks.confirmGenerationSpend,
  describeGenerationCost: vi.fn(() => ''),
  generationCostContextForNodes: vi.fn(() => ({})),
}))
vi.mock('../store/generationCanvasStore', () => ({ useGenerationCanvasStore: { getState: () => ({ nodes: mocks.nodes, edges: mocks.edges }) } }))
vi.mock('../runner/generationRunController', () => ({
  spendCostKind: vi.fn(() => 'image'),
  spendCostKindForNodes: vi.fn(() => 'image'),
  paidNodeLedger: vi.fn(() => 'run'),
}))
vi.mock('../runner/catalogTaskResolve', () => ({ selectedVendor: vi.fn(() => 'relay'), selectedModelKey: vi.fn(() => 'image-model') }))
vi.mock('../runner/generationRunWaves', () => ({ runGenerationNodesByPlan: vi.fn(async () => ({ totalCount: 0, successes: [], failures: [] })) }))

const node = (id: string, status: GenerationCanvasNode['status'], title = id): GenerationCanvasNode =>
  ({ id, kind: 'image', title, position: { x: 0, y: 0 }, status, categoryId: 'shots' }) as GenerationCanvasNode

let harness: ProjectSessionTestHarness
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.nodes = [node('fresh-1', 'idle'), node('fresh-2', 'idle'), node('failed', 'error'), node('done', 'success'), node('busy', 'running')]
  mocks.edges = []
  harness = createProjectSessionTestHarness()
  await harness.open('project-a')
})
afterEach(() => harness.dispose())

type ConfirmOpts = { planRows?: readonly PlanRow[]; onPlanToggle?: (row: PlanRow, checked: boolean) => void }

/** 打开确认卡后，用户去掉 / 勾上几项，再点「确认」。返回卡上看到的行。 */
function userEdits(untick: readonly string[] = [], tick: readonly string[] = []): { seen: () => readonly PlanRow[] } {
  let rows: readonly PlanRow[] = []
  mocks.confirmGenerationSpend.mockImplementation(async (_nodes: unknown, opts: ConfirmOpts) => {
    rows = opts.planRows ?? []
    for (const row of rows) {
      if (untick.includes(row.id!)) opts.onPlanToggle?.(row, false)
      if (tick.includes(row.id!)) opts.onPlanToggle?.(row, true)
    }
    return true
  })
  return { seen: () => rows }
}

const dispatchedIds = (): string[] => vi.mocked(runGenerationNodesByPlan).mock.calls.flatMap(([plan]) => plan.waves.flat())
const consentedIds = (): string[] => mocks.consentCanvasShots.mock.calls.flatMap(([input]) => (input as { shots: Array<{ nodeId: string }> }).shots.map((shot) => shot.nodeId))
const allIds = (): string[] => mocks.nodes.map((candidate) => candidate.id)

describe('「生成全部」确认卡逐项勾选', () => {
  it('rows: not generated ticked by default, generated unticked, generating locked', async () => {
    const { runGroupGenerate } = await import('./groupGenerate')
    const user = userEdits()
    expect(runGroupGenerate(allIds())).toBe('started')
    await vi.waitFor(() => expect(mocks.confirmGenerationSpend).toHaveBeenCalled())
    const byId = new Map(user.seen().map((row) => [row.id, row]))
    expect(byId.get('fresh-1')).toMatchObject({ checked: true, disabled: false })
    expect(byId.get('failed')).toMatchObject({ checked: true, disabled: false })
    expect(byId.get('done')).toMatchObject({ checked: false, disabled: false })
    expect(byId.get('busy')).toMatchObject({ checked: false, disabled: true })
  })

  it('an item the user unticks is in no consent, no execution plan, and no dispatch', async () => {
    const { runGroupGenerate } = await import('./groupGenerate')
    userEdits(['fresh-2'])
    runGroupGenerate(allIds())
    await vi.waitFor(() => expect(runGenerationNodesByPlan).toHaveBeenCalled())
    expect(dispatchedIds().sort()).toEqual(['failed', 'fresh-1'])
    expect(consentedIds().sort()).toEqual(['failed', 'fresh-1'])
    expect(dispatchedIds()).not.toContain('fresh-2')
    expect(consentedIds()).not.toContain('fresh-2')
  })

  it('a generated item can be ticked on purpose; a generating item is never dispatched, even if toggled', async () => {
    const { runGroupGenerate } = await import('./groupGenerate')
    userEdits([], ['done', 'busy'])
    runGroupGenerate(allIds())
    await vi.waitFor(() => expect(runGenerationNodesByPlan).toHaveBeenCalled())
    expect(dispatchedIds()).toContain('done')
    expect(dispatchedIds()).not.toContain('busy')
    expect(consentedIds()).not.toContain('busy')
  })

  it('a node that starts generating elsewhere while the card is open is not dispatched', async () => {
    const { runGroupGenerate } = await import('./groupGenerate')
    mocks.confirmGenerationSpend.mockImplementation(async () => {
      mocks.nodes = mocks.nodes.map((candidate) => (candidate.id === 'fresh-1' ? { ...candidate, status: 'running' as const } : candidate))
      return true
    })
    runGroupGenerate(allIds())
    await vi.waitFor(() => expect(runGenerationNodesByPlan).toHaveBeenCalled())
    expect(dispatchedIds()).not.toContain('fresh-1')
  })

  it('cancel = nothing consented, nothing dispatched; unticking everything = nothing dispatched either', async () => {
    const { runGroupGenerate } = await import('./groupGenerate')
    mocks.confirmGenerationSpend.mockResolvedValueOnce(false)
    runGroupGenerate(allIds())
    await vi.waitFor(() => expect(mocks.confirmGenerationSpend).toHaveBeenCalledTimes(1))
    userEdits(['fresh-1', 'fresh-2', 'failed'])
    runGroupGenerate(allIds())
    await vi.waitFor(() => expect(mocks.confirmGenerationSpend).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(mocks.consentCanvasShots).not.toHaveBeenCalled()
    expect(runGenerationNodesByPlan).not.toHaveBeenCalled()
  })

  it('clicking 「生成全部」 again while its card is open does not open a second card (no double confirm of one batch)', async () => {
    const { runGroupGenerate } = await import('./groupGenerate')
    let release: (ok: boolean) => void = () => undefined
    mocks.confirmGenerationSpend.mockImplementation(() => new Promise<boolean>((resolve) => { release = resolve }))
    runGroupGenerate(allIds())
    await vi.waitFor(() => expect(mocks.confirmGenerationSpend).toHaveBeenCalledTimes(1))
    runGroupGenerate(allIds())
    runGroupGenerate(allIds())
    expect(mocks.confirmGenerationSpend).toHaveBeenCalledTimes(1)
    release(false)
    await vi.waitFor(() => { /* batch is released once the card is answered */ runGroupGenerate(allIds()); expect(mocks.confirmGenerationSpend.mock.calls.length).toBeGreaterThanOrEqual(2) })
  })

  it('nothing to tick (everything is generating) = empty, the card never opens', async () => {
    const { runGroupGenerate } = await import('./groupGenerate')
    mocks.nodes = [node('busy', 'running')]
    expect(runGroupGenerate(['busy'])).toBe('empty')
    expect(mocks.confirmGenerationSpend).not.toHaveBeenCalled()
  })
})
