// `production.hand-over-shots` 渲染层那一半：主进程只等「哪几镜没开出同意、为什么」，不等生成。
// 这里钉住每一种「不开同意」的原因都写进回话（码一路送到卡上），开了同意的那几镜走画布批量那一条派发
// （带 production 链接、claimAdmittedByHost），派发里本镜挂在提交前的同意当场收回。
// 边界都换成替身：项目身份、同意 IPC、素材托管解析、批量派发；画布 store 与预检用真的。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const world = vi.hoisted(() => ({
  projectId: 'p1',
  current: true,
  hosting: { allowed: [] as unknown[], needsConfirmation: false, remember: false } as null | { allowed: unknown[]; needsConfirmation: boolean; remember: boolean },
  consentError: null as Error | null,
  consents: [] as Array<{ projectId: string; shots: Array<Record<string, unknown>> }>,
  withdrawals: [] as Array<{ projectId: string; runRecordIds: string[]; by: string }>,
  dispatches: [] as Array<{ waves: string[][]; options: Record<string, unknown> }>,
}))

vi.mock('../project/projectCanvasReadSurface', () => ({
  withProjectAction: (run: (project: unknown) => unknown) => run({
    binding: { projectId: world.projectId, immutableProjectUuid: 'u1', projectGeneration: 1 },
    assertCurrent: () => { if (!world.current) throw new Error('stale') },
  }),
  isProjectExecutionContextCurrent: () => world.current,
}))

vi.mock('../api/taskApi', () => ({
  consentCanvasShots: async (input: { projectId: string; shots: Array<Record<string, unknown>> }) => {
    if (world.consentError) throw world.consentError
    world.consents.push(input)
  },
  withdrawCanvasShots: (input: { projectId: string; runRecordIds: string[]; by: string }) => { world.withdrawals.push(input) },
}))

vi.mock('../generationCanvas/components/batchPlanPreview', () => ({
}))

vi.mock('../generationCanvas/runner/generationRunWaves', () => ({
  runGenerationNodesByPlan: async (plan: { waves: string[][] }, options: Record<string, unknown>) => {
    world.dispatches.push({ waves: plan.waves, options })
    return { totalCount: 0, successes: [], failures: [] }
  },
}))

import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { handOverShotsOp } from './productionHandOverShotsOp'

function shot(id: string, extra: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  return {
    id, kind: 'video', title: id, position: { x: 0, y: 0 }, prompt: '纸船顺着水沟漂走',
    meta: { modelVendor: 'apimart', modelKey: 'doubao-seedance-2.0', archetype: { id: 'seedance-2-apimart', modeId: 't2v' } },
    ...extra,
  } as GenerationCanvasNode
}

const request = (shots: Array<[string, string]>, ) => ({
  projectId: 'p1', runId: 'run-1', shots: shots.map(([shotId, nodeId]) => ({ shotId, nodeId })),
})

beforeEach(() => {
  world.projectId = 'p1'
  world.current = true
  world.hosting = { allowed: [], needsConfirmation: false, remember: false }
  world.consentError = null
  world.consents.length = 0
  world.withdrawals.length = 0
  world.dispatches.length = 0
  useGenerationCanvasStore.setState({ nodes: [shot('n1'), shot('n2'), shot('n3', { prompt: '' })], edges: [] })
})

describe('handOverShotsOp', () => {
  it('入参坏了才抛（capability_input_invalid）；预期之中的失败都写进回话', async () => {
    await expect(handOverShotsOp({ projectId: 'p1', runId: 'run-1', shots: [] })).rejects.toMatchObject({ code: 'capability_input_invalid' })
  })

  it('开同意：每一镜带 production 链接；本机判得出发不出去的不开，回原因', async () => {
    const reply = await handOverShotsOp(request([['s1', 'n1'], ['s2', 'n2'], ['s3', 'n3']]))
    expect(reply.skipped).toEqual([{ shotId: 's3', failure: { kind: 'parameter_rejected', code: 'prompt_required' } }])
    expect(world.consents).toHaveLength(1)
    expect(world.consents[0]!.shots.map((consent) => [consent.nodeId, consent.production])).toEqual([
      ['n1', { runId: 'run-1', shotId: 's1' }],
      ['n2', { runId: 'run-1', shotId: 's2' }],
    ])
    expect(world.consents[0]!.shots.every((consent) => consent.vendor === 'apimart' && consent.modelKey === 'doubao-seedance-2.0' && typeof consent.runRecordId === 'string')).toBe(true)
  })

  it('派发走画布批量那一条：依赖波次 + claimAdmittedByHost + 同一份同意的 Run 号', async () => {
    await handOverShotsOp(request([['s1', 'n1'], ['s2', 'n2']]))
    await Promise.resolve()
    expect(world.dispatches).toHaveLength(1)
    const { waves, options } = world.dispatches[0]!
    expect(waves).toEqual([['n1', 'n2']])
    expect(options.claimAdmittedByHost).toBe(true)
    const recordIds = options.canvasRunRecordIds as Map<string, string>
    expect([...recordIds.keys()]).toEqual(['n1', 'n2'])
    expect([...recordIds.values()]).toEqual(world.consents[0]!.shots.map((consent) => consent.runRecordId))
  })

  it('派发里本镜挂在提交前：这一镜的同意当场收回（by stopped，主进程按没发出去落定）；成功的不动', async () => {
    await handOverShotsOp(request([['s1', 'n1'], ['s2', 'n2']]))
    await Promise.resolve()
    const { options } = world.dispatches[0]!
    const onNodeResult = options.onNodeResult as (event: { ok: boolean; nodeId: string; error?: Error }) => void
    onNodeResult({ ok: true, nodeId: 'n1' })
    onNodeResult({ ok: false, nodeId: 'n2', error: new Error('inputs changed') })
    const recordIds = options.canvasRunRecordIds as Map<string, string>
    expect(world.withdrawals).toEqual([{ projectId: 'p1', runRecordIds: [recordIds.get('n2')], by: 'stopped' }])
  })

  it('项目不是这一个 → 全部没发出去（project_not_open），一镜都不开同意', async () => {
    world.projectId = 'p-other'
    const reply = await handOverShotsOp(request([['s1', 'n1'], ['s2', 'n2']]))
    expect(reply.skipped.map((entry) => entry.failure.code)).toEqual(['project_not_open', 'project_not_open'])
    expect(world.consents).toHaveLength(0)
  })

  it('开同意被主进程拒（出价在两步之间关了）→ 整批没发出去（canvas_consent_failed），不派发', async () => {
    world.consentError = new Error('generation_hand_over_not_found')
    const reply = await handOverShotsOp(request([['s1', 'n1'], ['s2', 'n2']]))
    expect(reply.skipped.map((entry) => entry.failure.code)).toEqual(['canvas_consent_failed', 'canvas_consent_failed'])
    expect(world.dispatches).toHaveLength(0)
  })

  it('开同意那一下里换了项目：收回刚开的同意，不派发', async () => {
    let calls = 0
    world.current = true
    const original = world.consents.push.bind(world.consents)
    world.consents.push = (...items) => { calls += 1; world.current = false; return original(...items) }
    await handOverShotsOp(request([['s1', 'n1']]))
    world.consents.push = original
    expect(calls).toBe(1)
    expect(world.withdrawals).toEqual([{ projectId: 'p1', runRecordIds: [world.consents[0]!.shots[0]!.runRecordId], by: 'stopped' }])
    expect(world.dispatches).toHaveLength(0)
  })
})
