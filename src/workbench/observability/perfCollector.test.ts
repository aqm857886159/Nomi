import { describe, expect, it, vi } from 'vitest'
import { isPerfSummaryProps, type PerfSummaryProps } from '../../../electron/shared/contracts/perfTelemetry'
import { STALL_REPORT_MAX_FRAMES, STALL_SCENE_POLL_MS, type StallReport } from '../../../electron/shared/contracts/stallTimeline'
import { createPerfCollector, type PerfCollectorEnv } from './perfCollector'

type Feed = (entries: PerformanceEntry[]) => void
function harness(opts: { supported?: Array<'event' | 'long-animation-frame'>; cores?: number; memory?: number } = {}) {
  const supported = opts.supported ?? ['event', 'long-animation-frame']
  let clock = 0
  const feeds: Record<string, Feed> = {}
  const created: string[] = []
  const disconnect = vi.fn()
  const sent: PerfSummaryProps[] = []
  let hidden: (() => void) | null = null
  const ticks = new Map<number, () => void>()
  const stalls: StallReport[] = []
  const env: PerfCollectorEnv = {
    createObserver(type, onEntries) {
      created.push(type)
      if (!supported.includes(type)) return null
      feeds[type] = onEntries
      return { observe: vi.fn(), disconnect }
    },
    now: () => clock,
    hardwareConcurrency: opts.cores ?? 8,
    deviceMemory: opts.memory ?? 8,
    onHidden(listener) { hidden = listener; return () => { hidden = null } },
    setInterval(callback, ms) { ticks.set(ms, callback); return () => { ticks.delete(ms) } },
    whenIdle: (callback) => callback(),
    send: (props) => { sent.push(props) },
    epochOf: (performanceTime) => 1_700_000_000_000 + performanceTime,
    sendStall: (report) => { stalls.push(report) },
  }
  const collector = createPerfCollector(env)
  const interaction = (id: number, duration: number): PerformanceEntry => ({ interactionId: id, duration, name: 'click', entryType: 'event', startTime: 0 } as unknown as PerformanceEntry)
  const frame = (duration: number): PerformanceEntry => ({ duration, name: 'long-animation-frame', entryType: 'long-animation-frame', startTime: 0 } as unknown as PerformanceEntry)
  return { collector, feeds, created, disconnect, sent, stalls, advance: (ms: number) => { clock += ms }, hide: () => hidden?.(), tick: () => ticks.get(30 * 60_000)?.(), stallTick: () => ticks.get(STALL_SCENE_POLL_MS)?.(), interaction, frame, isHiddenBound: () => hidden !== null }
}

describe('perfCollector：观察者只注册一次、不泄漏', () => {
  it('start 多次只注册两个观察者（Event Timing + LoAF）；换场景源不重复注册；stop 全部断开', () => {
    const h = harness()
    h.collector.start()
    h.collector.start()
    h.collector.setScene(() => ({ page: 'generation', nodes: 1, imageNodes: 0, generating: false }))
    h.collector.setScene(() => ({ page: 'preview', nodes: 1, imageNodes: 0, generating: false }))
    h.collector.setScene(null)
    expect(h.created).toEqual(['event', 'long-animation-frame'])
    expect(h.isHiddenBound()).toBe(true)
    h.collector.stop()
    expect(h.disconnect).toHaveBeenCalledTimes(2)
    expect(h.isHiddenBound()).toBe(false)
  })
})

describe('perfCollector：汇总', () => {
  it('同一次交互取最长的一条（INP 口径），p75 / p95 / 长帧 / 场景 / 设备一起分桶', () => {
    const h = harness({ cores: 12, memory: 4 })
    h.collector.start()
    h.collector.setScene(() => ({ page: 'generation', nodes: 150, imageNodes: 30, generating: true }))
    h.feeds['event']!([h.interaction(1, 40), h.interaction(1, 120), h.interaction(2, 60), h.interaction(3, 250), h.interaction(4, 700), h.interaction(0, 9999)])
    h.feeds['long-animation-frame']!([h.frame(80), h.frame(300)])
    h.advance(10 * 60_000)
    const snapshot = h.collector.snapshot()!
    expect(isPerfSummaryProps(snapshot)).toBe(true)
    expect(snapshot).toEqual({
      interactionP75: '200-500', interactionP95: 'gt-500', longFramesPerMin: '1-3', longestFrame: '250-1000', observedMinutes: '5-30',
      page: 'generation', nodes: '101-300', imageNodes: '21-100', generating: true, cpuCores: '9-16', memoryGb: '4',
    })
  })

  it('没有场景源 = 在项目库', () => {
    const h = harness()
    h.collector.start()
    expect(h.collector.snapshot()).toMatchObject({ page: 'library', nodes: '0', generating: false, interactionP75: 'none', longestFrame: 'none', longFramesPerMin: '0' })
  })

  it('两个标准接口缺一个就不出汇总（不能把「没法测」说成「0 次长帧」）', () => {
    const h = harness({ supported: ['event'] })
    h.collector.start()
    expect(h.collector.snapshot()).toBeNull()
    h.advance(10 * 60_000)
    h.collector.flush()
    expect(h.sent).toEqual([])
  })
})

describe('perfCollector：发送节奏（一个窗口一条，不是每次交互一条）', () => {
  it('窗口不足一分钟不发；够了在隐藏时发一条并清窗口；紧接着再隐藏不重复发', () => {
    const h = harness()
    h.collector.start()
    h.feeds['event']!([h.interaction(1, 300)])
    h.advance(30_000)
    h.hide()
    expect(h.sent).toHaveLength(0)
    h.advance(5 * 60_000)
    h.hide()
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]!.interactionP75).toBe('200-500')
    h.hide()
    h.hide()
    expect(h.sent).toHaveLength(1)
    // 清窗后新的窗口从零开始。
    h.advance(2 * 60_000)
    h.hide()
    expect(h.sent).toHaveLength(2)
    expect(h.sent[1]!.interactionP75).toBe('none')
  })

  it('一直开着不关：定时器到点汇总一条', () => {
    const h = harness()
    h.collector.start()
    h.advance(30 * 60_000)
    h.tick()
    expect(h.sent).toHaveLength(1)
  })

  it('交互记录有上限（内存不随使用时长增长）', () => {
    const h = harness()
    h.collector.start()
    h.feeds['event']!(Array.from({ length: 5000 }, (_, i) => h.interaction(i + 1, 10)))
    h.feeds['event']!([h.interaction(9999, 900)])
    h.advance(5 * 60_000)
    expect(h.collector.snapshot()!.interactionP95).toBe('lt-100')
  })
})

describe('perfCollector：卡顿时间线（≥200ms 长帧批量单向报给主进程）', () => {
  const scene = { page: 'generation' as const, nodes: 150, imageNodes: 30, generating: true }

  it('不加新观察者：仍只有 Event Timing + LoAF 两个', () => {
    const h = harness()
    h.collector.start()
    expect(h.created).toEqual(['event', 'long-animation-frame'])
  })

  it('第一次轮询发场景；场景没变且没有长帧就不发', () => {
    const h = harness()
    h.collector.start()
    h.collector.setScene(() => scene)
    h.stallTick()
    expect(h.stalls).toEqual([{ scene: { page: 'generation', nodes: '101-300', generating: true } }])
    h.stallTick()
    h.stallTick()
    expect(h.stalls).toHaveLength(1)
    h.collector.setScene(() => ({ ...scene, generating: false }))
    h.stallTick()
    expect(h.stalls).toHaveLength(2)
    expect(h.stalls[1]).toEqual({ scene: { page: 'generation', nodes: '101-300', generating: false } })
  })

  it('长帧门槛 200ms，带观察那一刻的场景和墙钟时刻；批量最多每 30 秒一批', () => {
    const h = harness()
    h.collector.start()
    h.collector.setScene(() => scene)
    h.stallTick()
    h.feeds['long-animation-frame']!([h.frame(120), h.frame(199), h.frame(260)])
    h.stallTick()
    expect(h.stalls).toHaveLength(2)
    expect(h.stalls[1]!.longFrames).toEqual([{ endedAtMs: 1_700_000_000_260, ms: 260, scene: { page: 'generation', nodes: '101-300', generating: true } }])
    h.feeds['long-animation-frame']!([h.frame(500)])
    h.advance(10_000)
    h.stallTick()
    expect(h.stalls).toHaveLength(2) // 距上一批不足 30 秒，先攒着
    h.advance(21_000)
    h.stallTick()
    expect(h.stalls).toHaveLength(3)
    expect(h.stalls[2]!.longFrames).toHaveLength(1)
  })

  it('一批最多 20 条，留最长的；页面隐藏时立刻发（不丢最后一批）', () => {
    const h = harness()
    h.collector.start()
    h.stallTick()
    h.feeds['long-animation-frame']!(Array.from({ length: 60 }, (_, i) => h.frame(200 + i)))
    h.advance(1000)
    h.hide()
    const batch = h.stalls.at(-1)!.longFrames!
    expect(batch).toHaveLength(STALL_REPORT_MAX_FRAMES)
    expect(Math.min(...batch.map((item) => item.ms))).toBeGreaterThanOrEqual(240)
  })

  it('汇总口径不变：长帧计数仍是 >50ms 的全部，不受 200ms 门槛影响', () => {
    const h = harness()
    h.collector.start()
    h.feeds['long-animation-frame']!([h.frame(80), h.frame(300)])
    h.advance(10 * 60_000)
    expect(h.collector.snapshot()).toMatchObject({ longFramesPerMin: '1-3', longestFrame: '250-1000' })
  })
})
