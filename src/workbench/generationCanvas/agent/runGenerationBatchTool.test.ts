// S6b 受理语义验收:确认前零网络调用(gate ask 流程保证,此处锁 gate 决策);
// approved nodeIds ≡ requested(受理回执只含请求里解析出的真实节点)。
import { setImmediate } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const deps = vi.hoisted(() => ({ grant: vi.fn(), consent: vi.fn(), dispatch: vi.fn(), toast: vi.fn() }))
vi.mock('../../api/taskApi', () => ({ mintSpendGrant: deps.grant }))
vi.mock('../runner/generationRunController', () => ({ resolveAutonomousUploadConsent: deps.consent }))
vi.mock('../components/batchPlanPreview', () => ({ runPlanWithToasts: deps.dispatch }))
vi.mock('../../../ui/toast', () => ({ toast: deps.toast }))
import { applyCanvasToolCall } from './applyCanvasToolCall'
import { evaluateGate } from './gate'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { setCanvasEventSinkForTests } from '../events/canvasEventEmitter'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'
import { setDesktopActiveProjectId } from '../../../desktop/activeProject'
import { useCanvasTurnStore } from './canvasTurnController'

function openProject(projectId: string) {
  setDesktopActiveProjectId(projectId)
  useCanvasTurnStore.getState().abandon()
  useGenerationCanvasStore.getState().restoreSnapshot({
    nodes: [{ id: 'same-id', kind: 'image', title: projectId, prompt: projectId, position: { x: 0, y: 0 } }],
    edges: [], groups: [],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  deps.grant.mockResolvedValue('grant-A')
  deps.consent.mockResolvedValue('not-needed')
  deps.dispatch.mockResolvedValue(undefined)
  setDesktopActiveProjectId('project-A')
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  __resetCanvasUndoJournalForTests()
  setCanvasEventSinkForTests(() => {})
})

afterEach(() => {
  useCanvasTurnStore.getState().abandon()
  setDesktopActiveProjectId(null)
  setCanvasEventSinkForTests(null)
})

describe('run_generation_batch — S6b 受理语义', () => {
  it('gate:costy 必问(writes:false 也不许直通 allow)', () => {
    expect(evaluateGate({ kind: 'tool-call', toolName: 'run_generation_batch', args: { nodeIds: ['n1'] } })).toEqual({
      outcome: 'ask',
    })
  })

  it('gate:批量含锁住节点 → deny(重新生成会覆盖已锁结果)', () => {
    const decision = evaluateGate(
      { kind: 'tool-call', toolName: 'run_generation_batch', args: { nodeIds: ['real-1'] } },
      { lockedNodes: new Map([['real-1', '定妆卡']]) },
    )
    expect(decision.outcome).toBe('deny')
    if (decision.outcome === 'deny') expect(decision.reason).toContain('定妆卡')
  })

  it('受理回执:acceptedNodeIds ≡ 请求中真实存在的节点,一个不多', async () => {
    const a = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'A', prompt: 'a' })
    const b = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'B', prompt: 'b' })
    const receipt = (await applyCanvasToolCall('run_generation_batch', {
      nodeIds: [a.id, b.id, 'ghost-404'],
    })) as { accepted: boolean; acceptedNodeIds: string[]; waves: number; blocked: unknown[] }
    expect(receipt.accepted).toBe(true)
    expect([...receipt.acceptedNodeIds].sort()).toEqual([a.id, b.id].sort())
    expect(receipt.waves).toBeGreaterThanOrEqual(1)
  })

  it('依赖波次:被引用的参考排前波(显示的≡执行的)', async () => {
    const ref = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: '参考', prompt: 'r' })
    const shot = useGenerationCanvasStore.getState().addNode({ kind: 'video', title: '镜头', prompt: 's' })
    useGenerationCanvasStore.getState().connectNodes(ref.id, shot.id)
    const receipt = (await applyCanvasToolCall('run_generation_batch', {
      nodeIds: [shot.id, ref.id],
    })) as { acceptedNodeIds: string[]; waves: number }
    expect(receipt.waves).toBe(2)
    expect(receipt.acceptedNodeIds[0]).toBe(ref.id)
  })

  it('全部不存在 → 抛 node_not_found(gate 之外的执行层兜底)', async () => {
    await expect(applyCanvasToolCall('run_generation_batch', { nodeIds: ['ghost-1'] })).rejects.toThrow('node_not_found')
  })

  it('switching projects while the grant is pending cannot hand the old accepted node ID to the new project', async () => {
    let release!: (grantId: string) => void
    deps.grant.mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve }))
    openProject('project-A')
    const turn = useCanvasTurnStore.getState().begin()
    const receipt = await applyCanvasToolCall('run_generation_batch', { nodeIds: ['same-id'] }, undefined, turn.canWrite)
    expect(receipt).toMatchObject({ accepted: true, acceptedNodeIds: ['same-id'] })
    expect(deps.grant).toHaveBeenCalledExactlyOnceWith(['same-id'])
    openProject('project-B')
    expect(turn.canWrite()).toBe(false)
    release('grant-A')
    // The fire-and-forget continuation only awaits the controlled promises.
    // An event-loop checkpoint drains it; no elapsed-time polling is involved.
    await setImmediate()
    expect(deps.dispatch).not.toHaveBeenCalled()
    expect(deps.consent).not.toHaveBeenCalled()
    expect(useGenerationCanvasStore.getState().nodes[0].title).toBe('project-B')
  })

  it('switching projects during upload-consent resolution cannot dispatch against colliding new-project IDs', async () => {
    let release!: (consent: 'allow') => void
    deps.consent.mockImplementationOnce(() => new Promise<'allow'>((resolve) => { release = resolve }))
    openProject('project-A')
    const turn = useCanvasTurnStore.getState().begin()
    await applyCanvasToolCall('run_generation_batch', { nodeIds: ['same-id'] }, undefined, turn.canWrite)
    expect(deps.consent).toHaveBeenCalledExactlyOnceWith('same-id')
    openProject('project-B')
    release('allow')
    await setImmediate()
    expect(deps.dispatch).not.toHaveBeenCalled()
    expect(useGenerationCanvasStore.getState().nodes[0].title).toBe('project-B')
  })

  it('normal Agent finish still dispatches an already-approved same-project batch with its original grant', async () => {
    let release!: (grantId: string) => void
    deps.grant.mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve }))
    openProject('project-A')
    const turn = useCanvasTurnStore.getState().begin()
    await applyCanvasToolCall('run_generation_batch', { nodeIds: ['same-id'] }, undefined, turn.canWrite)
    useCanvasTurnStore.getState().finish(turn.id)
    expect(turn.canWrite()).toBe(false)
    release('grant-A')
    await setImmediate()
    expect(deps.dispatch).toHaveBeenCalledExactlyOnceWith(
      { waves: [['same-id']], blocked: [], edgesUsed: [] },
      { grantId: 'grant-A', assetUploadConsent: 'not-needed' },
    )
    expect(deps.consent).toHaveBeenCalledExactlyOnceWith('same-id')
  })
})
