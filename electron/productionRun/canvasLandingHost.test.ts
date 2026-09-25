import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createCanvasLandingHost } from './canvasLandingHost'
import type { MaterializeShotsWirePayload } from './multiShotCanvasLanding'
import type { ProductionJob, ProductionRun } from './productionRunTypes'

// 画布跟着 Run 走（2026-09-25）：Run 每一次耐久变化之后，已经落在画布上的节点都要跟上它的真实状态。
// 以前只有「出片」那一下会投递到画布；「生成中」由渲染层另轮询一份 Run 快照另画一套，
// 两份真相各判各的——供应商早出片了，节点还在转。

const NOW = '2026-09-25T00:00:00.000Z'

function job(status: ProductionJob['status']): ProductionJob {
  return {
    jobId: 'job-s1', stageId: 'generate', status, attempt: 1, provider: 'apimart', model: 'kling-v3', idempotencyKey: 'k',
    metadata: { shotId: 's1' }, nodeId: 'node-1', createdAt: NOW, updatedAt: NOW,
  }
}

function run(jobs: ProductionJob[], nodeId: string | null = 'node-1'): ProductionRun {
  const candidate = { candidateId: 's1', revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'kling-v3', mode: 'text_to_video', prompt: '巨龙攻击村子', parameters: {}, references: [] }
  return {
    schemaVersion: 1, runId: 'run-1', projectId: 'proj-1', revision: jobs.length, status: 'running', stageId: 'generate',
    playbook: { name: 'generation.single-shot', version: '1.0.0' }, origin: { host: 'nomi' },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 0, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 1 },
    planVersion: 1, snapshotCursor: 0, stages: [], gates: [], jobs, artifacts: [],
    generationPlan: {
      operationId: 'run-1', state: 'submitted', candidate,
      shots: [{ shotId: 's1', candidate, updatedAt: NOW, ...(nodeId ? { nodeId } : {}) }],
      updatedAt: NOW,
    },
    createdAt: NOW, updatedAt: NOW,
  }
}

function harness(initial: ProductionRun, options: { open?: boolean } = {}) {
  let current = initial
  const payloads: MaterializeShotsWirePayload[] = []
  const requestRenderer = vi.fn(async (_op: string, payload: unknown) => {
    payloads.push(payload as MaterializeShotsWirePayload)
    return { bindings: [] }
  })
  const host = createCanvasLandingHost({
    readRun: () => current,
    command: vi.fn(async () => undefined),
    requestRenderer,
    resolveProjectRoot: () => null,
    isProjectOpen: () => options.open ?? true,
  })
  return {
    host, payloads, requestRenderer,
    /** Run 在仓库里变了（仓库 execute 的事件旁路随后把它交给跟随者）。 */
    change(next: ProductionRun) { current = next; host.followRunChange(next) },
  }
}

describe('canvasLandingHost.followRunChange', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('供应商受理之后，已经落在画布上的节点收到「生成中」；只动已有节点，不建节点', async () => {
    const h = harness(run([job('polling')]))
    h.change(run([job('polling')]))
    await vi.runAllTimersAsync()
    expect(h.requestRenderer).toHaveBeenCalledTimes(1)
    expect(h.payloads[0].existingOnly).toBe(true)
    expect(h.payloads[0].shots[0].generation).toMatchObject({ state: 'running', runRecordId: 'production-job-s1' })
  })

  it('同一个状态反复变化（又轮询了一次）不打扰渲染层；状态真的变了（失败）才再投一次', async () => {
    const h = harness(run([job('polling')]))
    h.change(run([job('polling')]))
    await vi.runAllTimersAsync()
    h.change({ ...run([job('polling')]), revision: 9 })
    await vi.runAllTimersAsync()
    expect(h.requestRenderer).toHaveBeenCalledTimes(1)
    h.change(run([{ ...job('needs_attention'), errorCode: 'provider_task_failed', errorMessage: '供应商拒绝了这次生成' }]))
    await vi.runAllTimersAsync()
    expect(h.requestRenderer).toHaveBeenCalledTimes(2)
    expect(h.payloads[1].shots[0].generation).toMatchObject({ state: 'failed', message: '供应商拒绝了这次生成' })
  })

  it('同一拍里的多次变化并成一次投影', async () => {
    const h = harness(run([job('submitting')]))
    h.change(run([job('submitting')]))
    h.change(run([job('provider_accepted')]))
    h.change(run([job('polling')]))
    await vi.runAllTimersAsync()
    expect(h.requestRenderer).toHaveBeenCalledTimes(1)
  })

  it('还没落到画布上的 Run（没有节点绑定）/ 项目没开着：跟随者什么都不做（建节点归确认即落与打开补齐）', async () => {
    const unbound = harness(run([job('polling')], null))
    unbound.change(run([job('polling')], null))
    const closed = harness(run([job('polling')]), { open: false })
    closed.change(run([job('polling')]))
    await vi.runAllTimersAsync()
    expect(unbound.requestRenderer).not.toHaveBeenCalled()
    expect(closed.requestRenderer).not.toHaveBeenCalled()
  })

  it('同一个 Run 的落地逐个排队：前一次没回来，后一次不开始（并发的两次都会看见「节点还没建」然后各建一份）', async () => {
    vi.useRealTimers()
    let release: (() => void) | undefined
    let inFlight = 0
    let maxInFlight = 0
    const requestRenderer = vi.fn(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise<void>((resolve) => { release = resolve })
      inFlight -= 1
      return { bindings: [] }
    })
    const host = createCanvasLandingHost({
      readRun: () => run([job('polling')]), command: vi.fn(async () => undefined), requestRenderer,
      resolveProjectRoot: () => null, isProjectOpen: () => true,
    })
    const first = host.landCanvasBestEffort('proj-1', 'run-1')
    const second = host.landCanvasBestEffort('proj-1', 'run-1')
    await vi.waitFor(() => expect(requestRenderer).toHaveBeenCalledTimes(1))
    release!()
    await vi.waitFor(() => expect(requestRenderer).toHaveBeenCalledTimes(2))
    release!()
    await Promise.all([first, second])
    expect(maxInFlight).toBe(1)
  })
})
