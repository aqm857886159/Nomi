import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReactTestRenderer } from '../../workbench/ai/v4/testReactRenderer'
import { FeedbackShareHost } from './FeedbackShareHost'

type CardProps = { request: Record<string, unknown>; onDone: (lingerMs: number) => void }
const seen = vi.hoisted(() => ({
  props: null as null | { request: Record<string, unknown>; onDone: (lingerMs: number) => void },
  mounted: 0,
  unmounted: 0,
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../design', () => ({
  DesignModal: ({ opened, children }: { opened?: boolean; children?: React.ReactNode }) =>
    (opened ? React.createElement('div', { 'data-modal': true }, children) : null),
}))
vi.mock('./FeedbackReportCard', () => ({
  FeedbackReportCard: (props: CardProps) => {
    seen.props = props
    React.useEffect(() => {
      seen.mounted += 1
      return () => { seen.unmounted += 1 }
    }, [])
    return React.createElement('div', { 'data-stub-card': true })
  },
}))

describe('反馈宿主定时器', () => {
  let renderer: ReturnType<typeof createReactTestRenderer>
  let handler: ((event: unknown) => void) | null = null

  const tick = () => new Promise<void>((resolve) => { setImmediate(resolve) })
  const settle = async () => {
    for (let index = 0; index < 5; index += 1) {
      await tick()
      renderer.flushPassiveEffects()
    }
  }
  const open = async (summary: string) => {
    expect(handler).not.toBeNull()
    handler!({ detail: { surface: 'generation', summary } })
    await settle()
  }

  beforeEach(async () => {
    seen.props = null
    seen.mounted = 0
    seen.unmounted = 0
    handler = null
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.stubGlobal('window', {
      setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
      clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
      addEventListener: (name: string, fn: (event: unknown) => void) => { if (name === 'nomi-open-feedback-share') handler = fn },
      removeEventListener: (name: string) => { if (name === 'nomi-open-feedback-share') handler = null },
    })
    renderer = createReactTestRenderer()
    renderer.render(React.createElement(FeedbackShareHost))
    await settle()
  })
  afterEach(() => {
    renderer.close()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('对照：卡发完请宿主收，宿主在它请的时间点把窗关掉（证明这个桩看得见「关窗」）', async () => {
    await open('only')
    expect(seen.props?.request).toMatchObject({ summary: 'only' })
    seen.props!.onDone(2200)
    await vi.advanceTimersByTimeAsync(2199)
    await settle()
    expect(seen.unmounted).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(seen.unmounted).toBe(1)
  })

  it('H1：第一张卡请 2.2 秒后收；1 秒时用户点开第二张；过了 2.2 秒线，第二张还在', async () => {
    await open('first')
    expect(seen.props?.request).toMatchObject({ summary: 'first' })
    seen.props!.onDone(2200)
    await vi.advanceTimersByTimeAsync(1000)
    await settle()
    await open('second')
    expect(seen.props?.request).toMatchObject({ summary: 'second' })
    await vi.advanceTimersByTimeAsync(1500)
    await settle()
    expect(seen.unmounted).toBe(0)
    expect(seen.props?.request).toMatchObject({ summary: 'second' })
  })

  it('H1 卸载：关闭定时器不再触发，事件监听也移除', async () => {
    await open('closing')
    seen.props!.onDone(2200)
    expect(vi.getTimerCount()).toBe(1)
    renderer.render(null)
    await settle()
    expect(handler).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    await vi.runAllTimersAsync()
    expect(seen.unmounted).toBe(1)
  })

})
