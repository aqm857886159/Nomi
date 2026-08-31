// S6b 受理语义验收:确认前零网络调用(gate ask 流程保证,此处锁 gate 决策);
// approved nodeIds ≡ requested(受理回执只含请求里解析出的真实节点)。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyCanvasToolCall } from './applyCanvasToolCall'
import { evaluateGate } from './gate'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { setCanvasEventSinkForTests } from '../events/canvasEventEmitter'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'

beforeEach(() => {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  __resetCanvasUndoJournalForTests()
  setCanvasEventSinkForTests(() => {})
})

afterEach(() => {
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
})
