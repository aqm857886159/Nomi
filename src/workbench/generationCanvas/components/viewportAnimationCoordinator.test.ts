import { describe, expect, it, vi } from 'vitest'
import { createViewportAnimationCoordinator } from './viewportAnimationCoordinator'

function createFrameHarness() {
  let nextId = 1
  const frames = new Map<number, FrameRequestCallback>()
  return {
    frames,
    requestFrame(callback: FrameRequestCallback) {
      const id = nextId
      nextId += 1
      frames.set(id, callback)
      return id
    },
    cancelFrame(id: number) {
      frames.delete(id)
    },
  }
}

describe('viewport animation coordinator ownership', () => {
  it('keeps only the reentrant latest animation when cancelling the previous owner', () => {
    const frameHarness = createFrameHarness()
    const firstSettled = vi.fn()
    const reentrantSettled = vi.fn()
    const outerSettled = vi.fn()
    const coordinator = createViewportAnimationCoordinator({
      ...frameHarness,
      readViewport: () => ({ zoom: 1, offset: { x: 0, y: 0 } }),
      writeViewport: vi.fn(),
    })

    coordinator.animateTo(1, { x: 0, y: 20 }, 160, (outcome) => {
      firstSettled(outcome)
      coordinator.animateTo(1, { x: 0, y: 40 }, 160, reentrantSettled)
    })
    const firstFrame = [...frameHarness.frames.keys()]
    expect(firstFrame).toHaveLength(1)

    coordinator.animateTo(1, { x: 0, y: 60 }, 160, outerSettled)

    expect(firstSettled).toHaveBeenCalledExactlyOnceWith('cancelled')
    expect(outerSettled).not.toHaveBeenCalled()
    expect(frameHarness.frames).toHaveLength(1)

    expect(coordinator.takeOwnershipAndCancel()).toBe(true)
    expect(frameHarness.frames).toHaveLength(0)
    expect(reentrantSettled).toHaveBeenCalledExactlyOnceWith('cancelled')
  })

  it.each(['direct transform', 'scheduled offset'])('%s yields to an animation reentered from cancellation', () => {
    const frameHarness = createFrameHarness()
    const directWrite = vi.fn()
    const reentrantSettled = vi.fn()
    const coordinator = createViewportAnimationCoordinator({
      ...frameHarness,
      readViewport: () => ({ zoom: 1, offset: { x: 0, y: 0 } }),
      writeViewport: vi.fn(),
    })

    coordinator.animateTo(1, { x: 0, y: 20 }, 160, () => {
      coordinator.animateTo(1, { x: 0, y: 40 }, 160, reentrantSettled)
    })

    if (coordinator.takeOwnershipAndCancel()) directWrite()

    expect(directWrite).not.toHaveBeenCalled()
    expect(frameHarness.frames).toHaveLength(1)
    expect(coordinator.takeOwnershipAndCancel()).toBe(true)
    expect(reentrantSettled).toHaveBeenCalledExactlyOnceWith('cancelled')
    expect(frameHarness.frames).toHaveLength(0)
  })

  it('keeps the reentrant replacement animation owned when the cancelled callback throws', () => {
    const frameHarness = createFrameHarness()
    const replacementSettled = vi.fn()
    const outerSettled = vi.fn()
    const reportSettlementError = vi.fn()
    const settlementError = new Error('legacy viewport settlement failed')
    const coordinator = createViewportAnimationCoordinator({
      ...frameHarness,
      readViewport: () => ({ zoom: 1, offset: { x: 0, y: 0 } }),
      writeViewport: vi.fn(),
      reportSettlementError,
    })

    coordinator.animateTo(1, { x: 0, y: 20 }, 160, () => {
      coordinator.animateTo(1, { x: 0, y: 40 }, 160, replacementSettled)
      throw settlementError
    })

    expect(() => coordinator.animateTo(1, { x: 0, y: 60 }, 160, outerSettled)).not.toThrow()
    expect(outerSettled).not.toHaveBeenCalled()
    expect(frameHarness.frames).toHaveLength(1)

    expect(coordinator.takeOwnershipAndCancel()).toBe(true)
    expect(replacementSettled).toHaveBeenCalledExactlyOnceWith('cancelled')
    expect(reportSettlementError).toHaveBeenCalledExactlyOnceWith(settlementError)
    expect(frameHarness.frames).toHaveLength(0)
  })

  it.each(['direct transform', 'scheduled offset'])('%s survives a throwing cancellation callback', () => {
    const frameHarness = createFrameHarness()
    const commandWrite = vi.fn()
    const reportSettlementError = vi.fn()
    const settlementError = new Error('legacy viewport settlement failed')
    const coordinator = createViewportAnimationCoordinator({
      ...frameHarness,
      readViewport: () => ({ zoom: 1, offset: { x: 0, y: 0 } }),
      writeViewport: vi.fn(),
      reportSettlementError,
    })

    coordinator.animateTo(1, { x: 0, y: 20 }, 160, () => {
      throw settlementError
    })

    expect(() => {
      if (coordinator.takeOwnershipAndCancel()) commandWrite()
    }).not.toThrow()
    expect(commandWrite).toHaveBeenCalledOnce()
    expect(reportSettlementError).toHaveBeenCalledExactlyOnceWith(settlementError)
    expect(frameHarness.frames).toHaveLength(0)
  })
})

describe('viewport animation coordinator disposal', () => {
  // 从已删的 useCanvasViewportGestures.strictMode.test.ts 搬来的那条不变量（2026-09-11 回填①）：
  // 旧测试用 StrictMode reconciler 探针断「最终卸载时在飞的动画被取消并结算 cancelled」，
  // 但它探的是旧手势内核那个死岛。机制本身没死——今天的 owner 是
  // reactFlow/useReactFlowViewportAnimation 的 effect 清理，它调的就是这里的 dispose()。
  // 判据搬到机制所在的这一层：跟 React 版本、跟哪个 hook 持有它都无关。
  it('cancels the in-flight frame and settles cancelled exactly once', () => {
    const frameHarness = createFrameHarness()
    const settled = vi.fn()
    const coordinator = createViewportAnimationCoordinator({
      requestFrame: frameHarness.requestFrame,
      cancelFrame: frameHarness.cancelFrame,
      readViewport: () => ({ zoom: 1, offset: { x: 0, y: 0 } }),
      writeViewport: () => {},
    })

    coordinator.animateTo(2, { x: 100, y: 120 }, 160, settled)
    expect(frameHarness.frames.size).toBe(1)

    coordinator.dispose()

    expect(frameHarness.frames.size, '在飞的那一帧必须被取消，否则卸载后还会写视口').toBe(0)
    expect(settled).toHaveBeenCalledExactlyOnceWith('cancelled')

    // 重复 dispose（StrictMode 会重放 effect 清理）不许再结算一次。
    coordinator.dispose()
    expect(settled).toHaveBeenCalledTimes(1)
    // 卸载之后来的命令一律拒收，不再申请新帧。
    expect(coordinator.animateTo(3, { x: 0, y: 0 }, 160)).toBe(false)
    expect(frameHarness.frames.size).toBe(0)
  })
})
