// ×N 变体连发的付费语义（样张拍板 2026-07-29）：一次确认 N 次跑、串行、失败即停不连烧。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmAndRunNode, confirmAndRunNodeVariants, regenerateNodeInPlace, spendCostKindForNodes } from './generationRunController'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { describeGenerationCost, useSpendConfirmStore } from '../spend/spendConfirm'
import i18n from '../../../i18n'
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
  let confirmMessages: string[] = []

  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
    __resetCanvasUndoJournalForTests()
    setCanvasEventSinkForTests(() => {})
    resetModelHealthMemory()
    confirmCalls = 0
    confirmAnswer = true
    confirmMessages = []
    useSpendConfirmStore.setState({
      requestConfirm: async (request) => {
        confirmCalls += 1
        confirmMessages.push(request.message)
        return confirmAnswer
      },
    } as Partial<ReturnType<typeof useSpendConfirmStore.getState>>)
  })

  afterEach(async () => {
    setCanvasEventSinkForTests(null)
    await i18n.changeLanguage('zh-CN')
  })

  it('describes text at every confirmation entry without inventing an image count or duration', async () => {
    confirmAnswer = false
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'text', prompt: '改写这句话' })
    await confirmAndRunNode(node.id)
    await regenerateNodeInPlace(node.id)
    await confirmAndRunNodeVariants(node.id, 3)
    expect(confirmMessages).toEqual([
      '将生成 1 段文本 · 会消耗模型额度',
      '将生成 1 段文本 · 会消耗模型额度',
      '将生成 3 段文本 · 会消耗模型额度',
    ])
  })

  it('keeps text-only batches distinct from image and mixed batches', () => {
    const text = useGenerationCanvasStore.getState().addNode({ kind: 'text', prompt: '改写' })
    const image = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: '画面' })
    expect(spendCostKindForNodes([text.id])).toBe('text')
    expect(spendCostKindForNodes([text.id, image.id])).toBe('mixed')
    expect(describeGenerationCost(2, spendCostKindForNodes([text.id]))).toBe('将生成 2 段文本 · 会消耗模型额度')
    expect(describeGenerationCost(1, spendCostKindForNodes([image.id]))).toBe('将生成 1 张画面 · 预计约 1–3 分钟 · 会消耗模型额度')
  })

  it('localizes text confirmation counts in English without a made-up duration', async () => {
    await i18n.changeLanguage('en')
    confirmAnswer = false
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'text', prompt: 'Rewrite' })
    await confirmAndRunNode(node.id)
    await confirmAndRunNodeVariants(node.id, 3)
    expect(confirmMessages).toEqual([
      'Will generate 1 text result · Uses model credits',
      'Will generate 3 text results · Uses model credits',
    ])
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
