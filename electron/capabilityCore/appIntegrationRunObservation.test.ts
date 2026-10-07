import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createRunObservationDrivers } from './appIntegrationRunObservation'
import type { ProductionRun } from '../productionRun/productionRunTypes'

// 2026-09-25 用户报「Agent 付费卡生成的视频早就出好了，节点一直转圈」。复现到的机制之一：
// 单镜观察者的观察窗（NOMI_POLL_TIMEOUT_MS，默认 300s）一过就静静退出，没有人再去问供应商；
// 一段要跑好几分钟的视频在供应商那边早就出片了，Run 还停在 polling。多镜那一半早就会「歇一歇再问」，
// 单镜这一半没有——同一条规则只写了一半。

const HORIZON_MS = 5_000

function pollingRun(status: 'polling' | 'ready' = 'polling'): ProductionRun {
  return {
    schemaVersion: 1, runId: 'run-1', projectId: 'proj-1', revision: 3, status: 'running', stageId: 'generate',
    playbook: { name: 'generation.single-shot', version: '1.0.0' }, origin: { host: 'nomi' },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 0, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 1 },
    planVersion: 1, snapshotCursor: 0, stages: [], gates: [], artifacts: [],
    jobs: [{ jobId: 'job-1', stageId: 'generate', status, attempt: 1, provider: 'apimart', model: 'kling-v3', idempotencyKey: 'k', providerTaskId: 'task-1', createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z' }],
    createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z',
  }
}

describe('single-shot observation outlives the provider', () => {
  const previousHorizon = process.env.NOMI_POLL_TIMEOUT_MS
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv("NOMI_POLL_TIMEOUT_MS", String(HORIZON_MS))
  })
  afterEach(() => {
    vi.useRealTimers()
    if (previousHorizon === undefined) vi.stubEnv("NOMI_POLL_TIMEOUT_MS", undefined)
    else vi.stubEnv("NOMI_POLL_TIMEOUT_MS", previousHorizon)
  })

  function setup() {
    let providerDone = false
    let current = pollingRun()
    const submission = {
      start: vi.fn(),
      poll: vi.fn(async () => ({ operationId: 'run-1', runId: 'run-1', jobId: 'job-1', providerTaskId: 'task-1', providerStatus: providerDone ? 'completed' : 'processing', nextAction: providerDone ? 'materialize' as const : 'poll' as const })),
      materialize: vi.fn(async () => {
        current = pollingRun('ready')
        return { operationId: 'run-1', runId: 'run-1', jobId: 'job-1', providerTaskId: 'task-1', artifactId: 'art-1', contentHash: 'h', nextAction: 'completed' as const }
      }),
      resume: vi.fn(),
    }
    const drivers = createRunObservationDrivers({
      repository: { read: () => current, execute: vi.fn(() => { throw new Error('not under test') }) } as never,
      buildSchedulerForRun: () => null,
    })
    return { submission, drivers, finishAtProvider: () => { providerDone = true }, settleElsewhere: () => { current = pollingRun('ready') } }
  }

  it('观察窗到了供应商还没给结论 → 歇一会儿接着问；供应商一出片就物化（只查不交，绝不再 start）', async () => {
    const { submission, drivers, finishAtProvider } = setup()
    drivers.observeSingleShotRun(submission as never, 'proj-1', 'run-1')
    await vi.advanceTimersByTimeAsync(HORIZON_MS + 1_000)
    const pollsInFirstWindow = submission.poll.mock.calls.length
    expect(pollsInFirstWindow).toBeGreaterThan(0)
    expect(submission.materialize).not.toHaveBeenCalled()

    finishAtProvider() // 供应商那边出片了——在第一次观察窗之后
    await vi.advanceTimersByTimeAsync(60_000)
    expect(submission.poll.mock.calls.length).toBeGreaterThan(pollsInFirstWindow)
    expect(submission.materialize).toHaveBeenCalledTimes(1)
    expect(submission.start).not.toHaveBeenCalled()
    drivers.stop()
  })

  it('Run 已经没有在等供应商的任务（别处已经落了结论）→ 不再去问', async () => {
    const { submission, drivers, settleElsewhere } = setup()
    drivers.observeSingleShotRun(submission as never, 'proj-1', 'run-1')
    await vi.advanceTimersByTimeAsync(HORIZON_MS + 1_000)
    const polls = submission.poll.mock.calls.length
    settleElsewhere()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(submission.poll.mock.calls.length).toBe(polls)
    drivers.stop()
  })

  it('核重启 / 替换（stop）：还没触发的「再问一次」一并作废', async () => {
    const { submission, drivers } = setup()
    drivers.observeSingleShotRun(submission as never, 'proj-1', 'run-1')
    await vi.advanceTimersByTimeAsync(HORIZON_MS + 1_000)
    const polls = submission.poll.mock.calls.length
    drivers.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(submission.poll.mock.calls.length).toBe(polls)
  })
})

// 2026-09-29 用户实见「暂停后还一直在转」：多镜批次急停后停在 pausing，而踢调度器的那一步把 pausing 也跳过了——
// 没人盯着在跑的那一镜收尾，也就没人把它落成 paused，「继续剩余」永远按不动。
describe('batch scheduler kicks', () => {
  function batchRun(status: ProductionRun['status']): ProductionRun {
    return {
      ...pollingRun(),
      status,
      generationPlan: { operationId: 'run-1', state: 'submitted', candidate: { candidateId: 'c1', revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'v', mode: 'i2v', prompt: '', parameters: {}, references: [] }, shots: [{ shotId: 's1', candidate: { candidateId: 's1', revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'v', mode: 'i2v', prompt: '', parameters: {}, references: [] }, updatedAt: '2026-09-29T00:00:00.000Z' }], updatedAt: '2026-09-29T00:00:00.000Z' },
    }
  }

  function drivers(current: () => ProductionRun) {
    const drives: Array<() => void> = []
    const runToQuiescence = vi.fn(() => new Promise<{ progress: { total: number; completed: number; inFlight: number; pending: number }; checkpoint: { status: 'not_required'; readyAnchorJobIds: string[] }; quiescent: boolean }>((resolve) => {
      drives.push(() => resolve({ progress: { total: 1, completed: 0, inFlight: 0, pending: 1 }, checkpoint: { status: 'not_required', readyAnchorJobIds: [] }, quiescent: true }))
    }))
    const built = createRunObservationDrivers({
      repository: { read: () => current(), execute: vi.fn() } as never,
      buildSchedulerForRun: () => ({ runToQuiescence }) as never,
    })
    return { built, runToQuiescence, finishDrive: () => drives.shift()?.() }
  }

  it('急停中（pausing）的批次照样被驱动：在跑的那一镜收尾后才能落到 paused', () => {
    const { built, runToQuiescence } = drivers(() => batchRun('pausing'))
    built.kickSchedulerForRun('proj-1', 'run-1')
    expect(runToQuiescence).toHaveBeenCalledTimes(1)
    built.stop()
  })

  it.each(['paused', 'completed', 'cancelled'] as const)('%s 的批次不自动续', (status) => {
    const { built, runToQuiescence } = drivers(() => batchRun(status))
    built.kickSchedulerForRun('proj-1', 'run-1')
    expect(runToQuiescence).not.toHaveBeenCalled()
    built.stop()
  })

  it('一趟驱动在跑时又被踢（例如用户点了继续）：这一趟收尾后补踢一次，不丢这一下', async () => {
    const { built, runToQuiescence, finishDrive } = drivers(() => batchRun('running'))
    built.kickSchedulerForRun('proj-1', 'run-1')
    built.kickSchedulerForRun('proj-1', 'run-1')
    expect(runToQuiescence, '同一时刻只跑一趟').toHaveBeenCalledTimes(1)
    finishDrive()
    await vi.waitFor(() => expect(runToQuiescence).toHaveBeenCalledTimes(2))
    finishDrive()
    built.stop()
  })
})
