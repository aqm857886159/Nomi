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
    process.env.NOMI_POLL_TIMEOUT_MS = String(HORIZON_MS)
  })
  afterEach(() => {
    vi.useRealTimers()
    if (previousHorizon === undefined) delete process.env.NOMI_POLL_TIMEOUT_MS
    else process.env.NOMI_POLL_TIMEOUT_MS = previousHorizon
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
