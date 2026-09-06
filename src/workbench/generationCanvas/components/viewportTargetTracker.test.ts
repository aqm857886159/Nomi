import { describe, expect, it } from 'vitest'
import { PENDING_TARGET_GRACE_MS, createViewportTargetTracker } from './viewportTargetTracker'

describe('viewportTargetTracker', () => {
  const live = { zoom: 1, offset: { x: 0, y: 0 } }

  it('没有动画在跑 → 读到的是当前实际视口', () => {
    const tracker = createViewportTargetTracker(() => live)
    expect(tracker.read()).toEqual({ zoom: 1, offset: { x: 0, y: 0 } })
  })

  it('登记后读到的是正在去的目标，而不是当前位置', () => {
    const tracker = createViewportTargetTracker(() => live)
    tracker.begin({ zoom: 1, offset: { x: -232, y: 0 } })
    expect(tracker.read()).toEqual({ zoom: 1, offset: { x: -232, y: 0 } })
  })

  it('结算自己的目标后回到当前视口', () => {
    const tracker = createViewportTargetTracker(() => live)
    const token = tracker.begin({ zoom: 1, offset: { x: -232, y: 0 } })
    tracker.settle(token)
    expect(tracker.read()).toEqual(live)
  })

  it('先来者被打断时的结算不许抹掉后来者的目标（这正是 x 位移丢失的形状）', () => {
    const tracker = createViewportTargetTracker(() => live)
    const reveal = tracker.begin({ zoom: 1, offset: { x: -232, y: 0 } })
    const composer = tracker.begin({ zoom: 1, offset: { x: -232, y: -60 } })
    tracker.settle(reveal) // 被打断的先来者结算 cancelled
    expect(tracker.read()).toEqual({ zoom: 1, offset: { x: -232, y: -60 } })
    tracker.settle(composer)
    expect(tracker.read()).toEqual(live)
  })

  it('读出来的是副本，改它不影响登记', () => {
    const tracker = createViewportTargetTracker(() => live)
    tracker.begin({ zoom: 1, offset: { x: 5, y: 5 } })
    const snapshot = tracker.read()
    snapshot.offset.x = 999
    expect(tracker.read().offset.x).toBe(5)
  })

  it('登记过期后当没有在飞的目标：React Flow 被直接写入打断时 promise 永不结算，不能永久卡住', () => {
    let clock = 1000
    const tracker = createViewportTargetTracker(() => live, () => clock)
    tracker.begin({ zoom: 1, offset: { x: -232, y: 0 } }, 200)
    clock += 200 + PENDING_TARGET_GRACE_MS
    expect(tracker.read()).toEqual({ zoom: 1, offset: { x: -232, y: 0 } })
    clock += 1
    expect(tracker.read()).toEqual(live)
  })

  it('readLastAutoTarget 记住最近一次登记的目标，结算后也不清（用来判断用户有没有自己动过）', () => {
    const tracker = createViewportTargetTracker(() => live)
    expect(tracker.readLastAutoTarget()).toBeNull()
    const token = tracker.begin({ zoom: 1, offset: { x: -232, y: -120 } }, 200)
    tracker.settle(token)
    expect(tracker.readLastAutoTarget()).toEqual({ zoom: 1, offset: { x: -232, y: -120 } })
  })
})
