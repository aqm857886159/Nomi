import {
  createViewportAnimationSettlement,
  type ViewportAnimationSettlement,
  type ViewportAnimationSettlementErrorReporter,
  type ViewportAnimationSettlementOutcome,
} from './viewportAnimationSettlement'

type Offset = { x: number; y: number }
type Viewport = { zoom: number; offset: Offset }

type ActiveAnimation = {
  owner: number
  frame: number | null
  settlement: ViewportAnimationSettlement
}

export type ViewportAnimationCoordinator = {
  animateTo: (
    zoom: number,
    offset: Offset,
    duration?: number,
    onSettled?: (outcome: ViewportAnimationSettlementOutcome) => void,
  ) => boolean
  /** 新的 direct/scheduled 命令取得所有权并取消旧动画；若取消回调重入了更新命令则返回 false。 */
  takeOwnershipAndCancel: () => boolean
  /**
   * 此刻有没有一段动画在逐帧写视口。逐帧直写会让 React Flow 每帧都报一次「移动结束」，
   * 视口的落盘方（onMoveEnd → store）据此跳过中间帧，只在动画结算时记一次。
   */
  isAnimating: () => boolean
  dispose: () => void
}

/**
 * 所有视口动画的单一所有权调度器。
 *
 * 关键顺序：新命令先取得 generation，再 detach 旧动画，最后才触发旧 settlement。若 settlement
 * 同步重入一个更新命令，外层 generation 会失效并立即退出，不能覆盖重入命令的 rAF/settlement。
 */
export function createViewportAnimationCoordinator(input: {
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (frame: number) => void
  readViewport: () => Viewport
  writeViewport: (viewport: Viewport) => void
  prepareForAnimation?: () => void
  reportSettlementError?: ViewportAnimationSettlementErrorReporter
}): ViewportAnimationCoordinator {
  let generation = 0
  let active: ActiveAnimation | null = null
  let disposed = false

  const claimOwnership = () => {
    generation += 1
    return generation
  }

  const detachAndCancelActive = () => {
    const previous = active
    active = null
    if (!previous) return
    if (previous.frame !== null) input.cancelFrame(previous.frame)
    previous.settlement.settle('cancelled')
  }

  const takeOwnershipAndCancel = () => {
    if (disposed) return false
    const owner = claimOwnership()
    detachAndCancelActive()
    return !disposed && generation === owner
  }

  const animateTo: ViewportAnimationCoordinator['animateTo'] = (
    targetZoom,
    targetOffset,
    duration = 140,
    onSettled,
  ) => {
    if (disposed) return false
    const owner = claimOwnership()
    detachAndCancelActive()
    // 旧 settlement 可能同步重入 animate/direct command；最新调用拥有视口，外层不得继续。
    if (disposed || generation !== owner) return false

    input.prepareForAnimation?.()
    if (disposed || generation !== owner) return false

    const start = input.readViewport()
    const settlement = createViewportAnimationSettlement(onSettled, input.reportSettlementError)
    const animation: ActiveAnimation = { owner, frame: null, settlement }
    active = animation
    let startTs: number | null = null
    const ease = (t: number) => 1 - Math.pow(1 - t, 3)

    const schedule = (callback: FrameRequestCallback) => {
      const frame = input.requestFrame(callback)
      if (active !== animation || generation !== owner || disposed) {
        input.cancelFrame(frame)
        return false
      }
      animation.frame = frame
      return true
    }

    const step = (ts: number) => {
      if (active !== animation || generation !== owner || disposed) return
      animation.frame = null
      if (startTs === null) startTs = ts
      const progress = duration <= 0 ? 1 : Math.min(1, (ts - startTs) / duration)
      const e = ease(progress)
      input.writeViewport({
        zoom: start.zoom + (targetZoom - start.zoom) * e,
        offset: {
          x: start.offset.x + (targetOffset.x - start.offset.x) * e,
          y: start.offset.y + (targetOffset.y - start.offset.y) * e,
        },
      })
      if (progress < 1) {
        schedule(step)
        return
      }
      active = null
      settlement.settle('completed')
    }

    schedule(step)
    return active === animation && generation === owner
  }

  return {
    animateTo,
    takeOwnershipAndCancel,
    isAnimating: () => active !== null,
    dispose() {
      if (disposed) return
      disposed = true
      claimOwnership()
      detachAndCancelActive()
    },
  }
}
