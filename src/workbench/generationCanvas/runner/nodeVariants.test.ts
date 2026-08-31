// ×N 变体连发的付费语义（样张拍板 2026-07-29）：一次确认 N 次跑、串行、失败即停不连烧。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmAndRunNodeVariants } from './generationRunController'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useSpendConfirmStore } from '../spend/spendConfirm'
import { setCanvasEventSinkForTests } from '../events/canvasEventEmitter'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'
import { resetModelHealthMemory } from './modelHealthMemory'
import type { GenerationNodeResult } from '../model/generationCanvasTypes'

vi.mock('../../api/taskApi', () => ({
  mintSpendGrant: vi.fn(async () => `grant-${Math.random().toString(36).slice(2)}`),
}))

function fakeResult(id: string): GenerationNodeResult {
  return { id, type: 'image', url: `https://example.com/${id}.png`, createdAt: Date.now() } as unknown as GenerationNodeResult
}

describe('confirmAndRunNodeVariants', () => {
  let confirmCalls = 0
  let confirmAnswer = true

  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
    __resetCanvasUndoJournalForTests()
    setCanvasEventSinkForTests(() => {})
    resetModelHealthMemory()
    confirmCalls = 0
    confirmAnswer = true
    useSpendConfirmStore.setState({
      requestConfirm: async () => {
        confirmCalls += 1
        return confirmAnswer
      },
    } as Partial<ReturnType<typeof useSpendConfirmStore.getState>>)
  })

  afterEach(() => {
    setCanvasEventSinkForTests(null)
  })

  it('一次确认 → N 次串行执行，产物堆进同一节点（最后一张为主图）', async () => {
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: '一只猫' })
    let runs = 0
    await confirmAndRunNodeVariants(node.id, 4, {
      executor: async () => {
        runs += 1
        return fakeResult(`r${runs}`)
      },
    })
    expect(confirmCalls).toBe(1)
    expect(runs).toBe(4)
    const after = useGenerationCanvasStore.getState().nodes.find((n) => n.id === node.id)
    expect(after?.result?.id).toBe('r4')
    expect(after?.status).toBe('success')
  })

  it('显式选择 3 张时恰好执行三次', async () => {
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: '三张构图' })
    let runs = 0

    await confirmAndRunNodeVariants(node.id, 3, {
      executor: async () => {
        runs += 1
        return fakeResult(`three-${runs}`)
      },
    })

    expect(confirmCalls).toBe(1)
    expect(runs).toBe(3)
  })

  it('取消确认 → 零执行零扣费', async () => {
    confirmAnswer = false
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: '一只猫' })
    let runs = 0
    await confirmAndRunNodeVariants(node.id, 4, {
      executor: async () => {
        runs += 1
        return fakeResult(`r${runs}`)
      },
    })
    expect(runs).toBe(0)
  })

  it('中途失败即停：剩余次数不再发起（不对坏通道连烧）', async () => {
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: '一只猫' })
    let runs = 0
    await confirmAndRunNodeVariants(node.id, 4, {
      retry: { maxAttempts: 1 },
      executor: async () => {
        runs += 1
        if (runs === 2) throw new Error('上游挂了')
        return fakeResult(`r${runs}`)
      },
    })
    expect(runs).toBe(2)
    const after = useGenerationCanvasStore.getState().nodes.find((n) => n.id === node.id)
    expect(after?.result?.id).toBe('r1') // 第一张成功保留
  })

  it('count 钳位：0/负数按 1 次跑', async () => {
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: '一只猫' })
    let runs = 0
    await confirmAndRunNodeVariants(node.id, 0, {
      executor: async () => {
        runs += 1
        return fakeResult(`r${runs}`)
      },
    })
    expect(runs).toBe(1)
  })
})
