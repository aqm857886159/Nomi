// S6-3 CI 不变量(§6.3 ⑤):「任意批准重放 → reconciliation 必 ok」。
// 任意合法计划(节点数/kind/标题/提示词/边随机)经 applyProposalBatch 落地后,
// 执行后态与批准的 effectiveArgs 对账必须零偏差——有偏差即管线在静默改写用户批准的东西。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { applyProposalBatch } from './proposalTxn'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { clearHistory } from '../events/canvasPatchHistory'
import { setCanvasEventSinkForTests } from '../events/canvasEventEmitter'

beforeEach(() => {
  setCanvasEventSinkForTests(() => {})
})

afterEach(() => {
  setCanvasEventSinkForTests(null)
})

const kindArb = fc.constantFrom('image', 'video', 'character', 'scene')
// 标题/提示词:任意可打印串(含空串——空标题走「镜头 N」兜底白名单)。
const textArb = fc.string({ maxLength: 40 })

const planArb = fc
  .integer({ min: 1, max: 6 })
  .chain((count) => {
    const clientIds = Array.from({ length: count }, (_, i) => `c${i + 1}`)
    const nodesArb = fc.tuple(
      ...clientIds.map((clientId) =>
        fc.record({
          clientId: fc.constant(clientId),
          kind: kindArb,
          title: textArb,
          prompt: textArb,
        }),
      ),
    )
    // 边:在 clientId 间随机取非自环对(connect 对自环静默 no-op,合法计划不含它)。
    const edgesArb = count < 2
      ? fc.constant([] as { sourceClientId: string; targetClientId: string }[])
      : fc.array(
          fc
            .tuple(fc.nat({ max: count - 1 }), fc.nat({ max: count - 1 }))
            .filter(([a, b]) => a !== b)
            .map(([a, b]) => ({ sourceClientId: clientIds[a], targetClientId: clientIds[b] })),
          { maxLength: 8 },
        )
    return fc.record({ nodes: nodesArb, edges: edgesArb })
  })

describe('S6-3 property:任意批准重放 → reconciliation 必 ok', () => {
  it('随机计划批量落地后对账零偏差', async () => {
    await fc.assert(
      fc.asyncProperty(planArb, async (plan) => {
        useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
        clearHistory()
        const steps = [
          {
            toolCallId: 'tc-create',
            toolName: 'create_canvas_nodes',
            effectiveArgs: { summary: 'property', nodes: plan.nodes },
          },
          ...(plan.edges.length
            ? [{ toolCallId: 'tc-connect', toolName: 'connect_canvas_edges', effectiveArgs: { edges: plan.edges } }]
            : []),
        ]
        const outcome = await applyProposalBatch(steps)
        expect(outcome.status).toBe('committed')
        if (outcome.status === 'committed') {
          expect(outcome.reconciliation.deviations).toEqual([])
          expect(outcome.reconciliation.ok).toBe(true)
        }
      }),
      { numRuns: 60 },
    )
  })
})
