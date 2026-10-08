// 待决出价进对话投影（2026-10-05）：账本一变就重读、同一宏任务合并成一次、空闲时一次都不读。
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProductionRun } from '../productionRun/productionRunTypes'
import type { PendingSpendRead } from '../shared/contracts/pendingSpendConfirm'

const bus = vi.hoisted(() => ({
  runs: new Set<(run: unknown) => void>(),
  lifecycle: new Set<() => void>(),
  read: { current: (() => ({ surface: 'ready', rows: [] })) as (projectId: string) => unknown },
  reads: 0,
}))

vi.mock('../productionRun/productionRunRuntime', () => ({
  subscribeProductionRunChanges: (listener: (run: unknown) => void) => { bus.runs.add(listener); return () => bus.runs.delete(listener) },
}))
vi.mock('../capabilityCore/residentSurfaceLifecycle', () => ({
  readPendingSpend: (projectId: string) => { bus.reads += 1; return bus.read.current(projectId) },
  subscribeResidentSurfaceLifecycle: (listener: () => void) => { bus.lifecycle.add(listener); return () => bus.lifecycle.delete(listener) },
}))

import { createDesktopLaneSpend } from './laneDesktopSpend'

const run = (overrides: Partial<{ projectId: string; runId: string; host: string }> = {}) => ({
  projectId: overrides.projectId ?? 'project-1', runId: overrides.runId ?? 'op-1', origin: { host: overrides.host ?? 'nomi' },
}) as unknown as ProductionRun
const emitRun = (value: ProductionRun) => { for (const listener of [...bus.runs]) listener(value) }
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

afterEach(() => {
  bus.runs.clear(); bus.lifecycle.clear(); bus.reads = 0
  bus.read.current = () => ({ surface: 'ready', rows: [] })
})

describe('laneDesktopSpend：推，不拉', () => {
  it('投影每次发布都来取，但只在变了之后才真的重读', () => {
    const spend = createDesktopLaneSpend('project-1', () => undefined)
    expect(spend.resolve()).toEqual({ surface: 'ready', rows: [] })
    spend.resolve(); spend.resolve()
    expect(bus.reads, '空闲时不读：轮询时代是每 1.5 秒把每个 Run 读一遍').toBe(1)
    spend.dispose()
  })

  it('Agent 出价的 Run 一口气变 10 次 → 只推一次、只重读一次', async () => {
    const refresh = vi.fn()
    const spend = createDesktopLaneSpend('project-1', refresh)
    spend.resolve()
    for (let index = 0; index < 10; index += 1) emitRun(run())
    await tick()
    expect(refresh).toHaveBeenCalledTimes(1)
    spend.resolve()
    expect(bus.reads).toBe(2)
    spend.dispose()
  })

  it('别的项目、画布那台的 Run（出不了这张卡）不惊动投影', async () => {
    const refresh = vi.fn()
    const spend = createDesktopLaneSpend('project-1', refresh)
    spend.resolve()
    emitRun(run({ projectId: 'project-2' }))
    emitRun(run({ host: 'canvas', runId: 'canvas-1' }))
    await tick()
    expect(refresh).not.toHaveBeenCalled()
    spend.dispose()
  })

  it('卡上此刻那一笔所在的 Run 变了，不管它盖的是什么章都重读（它可能正是让卡关掉的那一下）', async () => {
    const shown = { surface: 'ready', rows: [{ runId: 'run-x', operationId: 'run-x' }] } as unknown as PendingSpendRead
    bus.read.current = () => shown
    const refresh = vi.fn()
    const spend = createDesktopLaneSpend('project-1', refresh)
    spend.resolve()
    emitRun(run({ host: 'external', runId: 'run-x' }))
    await tick()
    expect(refresh).toHaveBeenCalledTimes(1)
    spend.dispose()
  })

  it('常驻生成面换相推一次；策略切换不再重解释旧卡', async () => {
    const refresh = vi.fn()
    const spend = createDesktopLaneSpend('project-1', refresh)
    spend.resolve()
    for (const listener of [...bus.lifecycle]) listener()
    await tick()
    expect(refresh).toHaveBeenCalledTimes(1)
    spend.dispose()
  })

  it('关掉之后不再推，订阅全部退掉', async () => {
    const refresh = vi.fn()
    const spend = createDesktopLaneSpend('project-1', refresh)
    emitRun(run())
    spend.dispose()
    await tick()
    expect(refresh).not.toHaveBeenCalled()
    expect([bus.runs.size, bus.lifecycle.size]).toEqual([0, 0])
  })
})
