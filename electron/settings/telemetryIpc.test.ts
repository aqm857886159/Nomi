// 渲染层交来的事件里只有主进程说了算的那几格（2026-11-13）：modelClass、主进程停顿两格。
// 渲染层自己填了也一律被覆盖；vendorKey 只用来算种类，不进事件。
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getVersion: () => '0.25.0', getPath: () => '/unused', whenReady: () => Promise.resolve() }, ipcMain: { handle: vi.fn() }, powerMonitor: undefined }))
vi.mock('../ipcSenderGuard', () => ({ assertTrustedSender: vi.fn(), assertTrustedFireAndForget: vi.fn() }))
import { withMainProcessFacts } from './telemetryIpc'
import { createStallMonitor, installStallMonitor, resetStallMonitorForTests, STALL_SAMPLE_INTERVAL_MS, STALL_STARTUP_GRACE_MS } from '../diagnostics/stallMonitor'
import { createStallTimeline } from '../diagnostics/stallTimeline'
import { isTelemetryProps } from '../telemetry/telemetryEvents'

afterEach(() => resetStallMonitorForTests())

const generation = { capability: 'image', durationBucket: '1-5s', result: 'success', mode: 'text', submitDuration: '1-5s', waitDuration: 'none', upstreamStatus: 'ok' }
const perf = { interactionP75: '100-200', interactionP95: '200-500', longFramesPerMin: '1-3', longestFrame: '100-250', observedMinutes: '5-30', page: 'generation', nodes: '21-100', imageNodes: '1-20', generating: true, cpuCores: '9-16', memoryGb: '8plus' }

describe('主进程补格', () => {
  it('generation.completed：按 vendorKey 归种类；vendorKey 本身不进事件；渲染层填的种类被覆盖', () => {
    const own = withMainProcessFacts('generation.completed', { ...generation, modelClass: 'builtin' }, 'my-relay-at-corp') as Record<string, unknown>
    expect(own.modelClass).toBe('custom')
    expect(JSON.stringify(own)).not.toContain('my-relay')
    expect(isTelemetryProps(own, 'generation.completed')).toBe(true)
    expect((withMainProcessFacts('generation.completed', generation, undefined) as Record<string, unknown>).modelClass).toBe('custom')
    expect((withMainProcessFacts('generation.completed', generation, 42) as Record<string, unknown>).modelClass).toBe('custom')
  })

  it('perf 汇总：监视器没装 → unknown（不冒充 0）；渲染层填的值被覆盖', () => {
    const props = withMainProcessFacts('perf.session.summary', { ...perf, mainStallMax: 'gt-5000', mainStallCount: 'gt-10' }, undefined) as Record<string, unknown>
    expect(props).toMatchObject({ mainStallMax: 'unknown', mainStallCount: 'unknown' })
    expect(isTelemetryProps(props, 'perf.session.summary')).toBe(true)
  })

  it('perf 汇总：监视器在跑 → 取这一窗的分档，取完归零', () => {
    const timer: { tick: (() => void) | null } = { tick: null }
    let clock = 1_000_000
    const histogram = { max: 0, enable: () => undefined, disable: () => undefined, reset: () => { histogram.max = 0 } }
    const monitor = createStallMonitor({ timeline: createStallTimeline({ append: () => undefined, now: () => clock }), now: () => clock, createHistogram: () => histogram, setInterval: (cb) => { timer.tick = cb; return 1 }, clearInterval: () => undefined })
    installStallMonitor({ monitor, env: {} })
    clock += STALL_STARTUP_GRACE_MS + 1; timer.tick?.()
    for (const ms of [300, 1500]) { histogram.max = (ms + STALL_SAMPLE_INTERVAL_MS / 2) * 1e6; clock += 10_000; timer.tick?.() }
    const first = withMainProcessFacts('perf.session.summary', perf, undefined) as Record<string, unknown>
    expect(first).toMatchObject({ mainStallMax: '1000-5000', mainStallCount: '1-3' })
    expect(isTelemetryProps(first, 'perf.session.summary')).toBe(true)
    const second = withMainProcessFacts('perf.session.summary', perf, undefined) as Record<string, unknown>
    expect(second).toMatchObject({ mainStallMax: 'none', mainStallCount: '0' })
  })

  it('别的事件原样过；不是对象的 props 原样交给校验去拒', () => {
    const update = { action: 'check', result: 'success' }
    expect(withMainProcessFacts('update.action', update, 'apimart')).toBe(update)
    expect(withMainProcessFacts('generation.completed', null, 'v')).toBeNull()
    expect(withMainProcessFacts('generation.completed', 'x', 'v')).toBe('x')
  })
})
