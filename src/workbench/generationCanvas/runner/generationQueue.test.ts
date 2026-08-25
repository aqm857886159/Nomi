// 队列外化后的三条不变量（方案 docs/plan/2026-08-02-task-center-queue.md）：
//   ① 取消排队中的条目 = **零 vendor 调用**（这是「取消不产生费用」的唯一凭据，不能靠嘴说）
//   ② 连续失败 3 个 → 队列暂停，剩下的不再提交；「上游连带失败」不该触发误停
//   ③ batchId 不传时行为与接队列前完全一致（退化路径，回滚保险）
//
// 各处 assetUploadConsent:'not-needed'（F16b 起必填）：本文件测的是队列机制，节点都不带本地素材，
// 压根不碰公共临时托管——'not-needed' 就是这批节点的诚实答案，不是为了过类型随手填的占位。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runGenerationNodesBatch, runGenerationNodesByPlan } from './generationRunController'
import { QUEUE_BRAKE_THRESHOLD, useGenerationQueueStore } from './generationQueueStore'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { setCanvasEventSinkForTests } from '../events/canvasEventEmitter'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'
import { resetModelHealthMemory } from './modelHealthMemory'
import type { DependencyWavePlan } from './dependencyWaves'
import type { GenerationNodeResult } from '../model/generationCanvasTypes'

vi.mock('../../api/taskApi', () => ({
  mintSpendGrant: vi.fn(async () => 'grant-test'),
}))

function fakeResult(id: string): GenerationNodeResult {
  return { id, type: 'image', url: `https://example.com/${id}.png`, createdAt: Date.now() } as unknown as GenerationNodeResult
}

function addImageNodes(count: number): string[] {
  const store = useGenerationCanvasStore.getState()
  return Array.from({ length: count }, (_, index) => store.addNode({ kind: 'image', prompt: `镜头 ${index + 1}` }).id)
}

function planOf(waves: string[][]): DependencyWavePlan {
  return { waves, blocked: [], edgesUsed: [] } as unknown as DependencyWavePlan
}

describe('生成队列外化', () => {
  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
    useGenerationQueueStore.setState({ entries: [], batches: {} })
    __resetCanvasUndoJournalForTests()
    setCanvasEventSinkForTests(() => {})
    resetModelHealthMemory()
  })

  afterEach(() => {
    setCanvasEventSinkForTests(null)
  })

  it('整批一次登记：后续波次的节点立刻可见为「排队中」，不再是 idle', async () => {
    const ids = addImageNodes(4)
    const plan = planOf([[ids[0], ids[1]], [ids[2], ids[3]]])
    let seenQueuedInSecondWave = 0
    await runGenerationNodesByPlan(plan, {
      assetUploadConsent: 'not-needed',
      concurrency: 2,
      executor: async () => {
        // 第一波跑的时候，第二波必须已经在队列里挂着「queued」——这正是用户以前看不见的那部分。
        const queued = useGenerationQueueStore.getState().entries.filter((entry) => entry.state === 'queued')
        seenQueuedInSecondWave = Math.max(seenQueuedInSecondWave, queued.length)
        return fakeResult('ok')
      },
    })
    expect(seenQueuedInSecondWave).toBeGreaterThanOrEqual(2)
  })

  it('不变量①：取消排队中的条目 → 那些节点零 vendor 调用、零扣费', async () => {
    const ids = addImageNodes(6)
    const executed: string[] = []
    const plan = planOf([ids])
    const runPromise = runGenerationNodesByPlan(plan, {
      assetUploadConsent: 'not-needed',
      concurrency: 1,
      executor: async (node) => {
        executed.push(node.id)
        // 第一个跑起来后就把剩下的全取消 —— 模拟用户「点错了，赶紧停」。
        if (executed.length === 1) {
          const batchId = useGenerationQueueStore.getState().entries[0]?.batchId
          if (batchId) useGenerationQueueStore.getState().cancelBatchRemaining(batchId)
        }
        return fakeResult(node.id)
      },
    })
    await runPromise
    // 已提交的那一个跑完；其余 5 个一次都没进 executor（= 零 vendor 调用）。
    expect(executed).toEqual([ids[0]])
    const cancelled = useGenerationQueueStore.getState().entries.filter((entry) => entry.state === 'cancelled')
    expect(cancelled).toHaveLength(5)
  })

  it('不变量②：连续失败达阈值 → 队列暂停挂起，用户选「全部取消」才收工，剩下的一次都没提交', async () => {
    const ids = addImageNodes(8)
    let attempts = 0
    const plan = planOf([ids])
    const runPromise = runGenerationNodesByPlan(plan, {
      assetUploadConsent: 'not-needed',
      concurrency: 1,
      retry: { maxAttempts: 1 },
      executor: async () => {
        attempts += 1
        // 模拟上游整体挂掉（apimart Imagen 404 那种必死场景）。
        throw new Error('上游模型不可用')
      },
    })
    // 刹车后 worker 会一直挂着等人拿主意（这正是「暂停并问我」的语义）——这里替用户点「全部取消」。
    await vi.waitFor(() => {
      const batch = Object.values(useGenerationQueueStore.getState().batches)[0]
      expect(batch?.paused).toBe(true)
    })
    const batchId = Object.values(useGenerationQueueStore.getState().batches)[0]?.id as string
    useGenerationQueueStore.getState().cancelBatchRemaining(batchId)
    await runPromise
    // 刹车前最多跑 QUEUE_BRAKE_THRESHOLD 个，绝不会把 8 个全烧完。
    expect(attempts).toBe(QUEUE_BRAKE_THRESHOLD)
    expect(useGenerationQueueStore.getState().entries.filter((entry) => entry.state === 'cancelled')).toHaveLength(
      ids.length - QUEUE_BRAKE_THRESHOLD,
    )
  })

  it('不变量②补充：上游连带失败不算进刹车（否则一个上游挂掉会误停整条队列）', () => {
    const store = useGenerationQueueStore.getState()
    const batchId = store.enqueueBatch([['a', 'b', 'c', 'd']])
    for (const nodeId of ['a', 'b', 'c']) {
      useGenerationQueueStore.getState().markSettled(batchId, nodeId, 'error', { countsTowardBrake: false })
    }
    expect(useGenerationQueueStore.getState().batches[batchId]?.paused).toBe(false)
  })

  it('不变量③：不传 batchId 时行为不变（退化路径 = 回滚保险）', async () => {
    const ids = addImageNodes(3)
    const executed: string[] = []
    const result = await runGenerationNodesBatch(ids, {
      assetUploadConsent: 'not-needed',
      concurrency: 3,
      executor: async (node) => {
        executed.push(node.id)
        return fakeResult(node.id)
      },
    })
    expect(executed).toHaveLength(3)
    expect(result.successes).toHaveLength(3)
  })

  it('一个成功即清零连续失败计数（偶发失败不该攒成刹车）', () => {
    const store = useGenerationQueueStore.getState()
    const batchId = store.enqueueBatch([['a', 'b', 'c', 'd', 'e']])
    useGenerationQueueStore.getState().markSettled(batchId, 'a', 'error')
    useGenerationQueueStore.getState().markSettled(batchId, 'b', 'error')
    useGenerationQueueStore.getState().markSettled(batchId, 'c', 'success')
    useGenerationQueueStore.getState().markSettled(batchId, 'd', 'error')
    expect(useGenerationQueueStore.getState().batches[batchId]?.paused).toBe(false)
    expect(useGenerationQueueStore.getState().batches[batchId]?.consecutiveFailures).toBe(1)
  })

  // F15：等待态不许穿红衣——unfrozen-anchor / missing-upstream 是「在等前置」，不是失败。
  describe('blocked 分「等待」与「失败」两桶', () => {
    function planWithBlocked(
      waves: string[][],
      blocked: DependencyWavePlan['blocked'],
    ): DependencyWavePlan {
      return { waves, blocked, edgesUsed: [] } as unknown as DependencyWavePlan
    }

    it('unfrozen-anchor 被拦的镜头 → 留 idle（不画红错误卡）、不进 failures', async () => {
      const [shotId] = addImageNodes(1)
      const plan = planWithBlocked([], [{ nodeId: shotId, reason: 'unfrozen-anchor', detail: '在等参考卡「便利店」定妆——在卡上点「定妆」' }])
      const result = await runGenerationNodesByPlan(plan, { assetUploadConsent: 'not-needed', executor: async () => fakeResult('x') })
      const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === shotId)
      expect(node?.status ?? 'idle').toBe('idle') // 不是 'error'——等待态去红
      expect(node?.error).toBeFalsy()
      expect(result.failures.map((f) => f.nodeId)).not.toContain(shotId) // 不进「重试失败」
    })

    it('missing-upstream 同样走等待桶（留 idle，不进 failures）', async () => {
      const [shotId] = addImageNodes(1)
      const plan = planWithBlocked([], [{ nodeId: shotId, reason: 'missing-upstream', detail: '上游「前置镜」还没有生成结果' }])
      const result = await runGenerationNodesByPlan(plan, { assetUploadConsent: 'not-needed', executor: async () => fakeResult('x') })
      const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === shotId)
      expect(node?.status ?? 'idle').toBe('idle')
      expect(result.failures.map((f) => f.nodeId)).not.toContain(shotId)
    })

    it('cycle（结构错误）仍走失败桶（红 error + 进 failures，可单独处理）', async () => {
      const [shotId] = addImageNodes(1)
      const plan = planWithBlocked([], [{ nodeId: shotId, reason: 'cycle', detail: '与其他节点构成循环引用' }])
      const result = await runGenerationNodesByPlan(plan, { assetUploadConsent: 'not-needed', executor: async () => fakeResult('x') })
      const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === shotId)
      expect(node?.status).toBe('error')
      expect(result.failures.map((f) => f.nodeId)).toContain(shotId)
    })
  })
})
