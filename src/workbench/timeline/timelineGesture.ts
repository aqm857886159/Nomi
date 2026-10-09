// 时间轴 / 剪辑节点里「一次按住指针的手势」的生命周期——唯一一份。
//
// 为什么收在这里：片段移动、裁剪手柄、拖播放头在 5 个地方各写了一遍「capture + window 监听 + 收尾」，
// 写全的只有 ClipNodeTimeline 的两处；TimelineClip 只摘了 pointerup（系统打断后卡在拖动态、监听泄漏），
// ClipNodeTimeline 的 scrub 没处理 blur / lostpointercapture / Esc。同一类事，补法各不相同，
// 下一处新手势抄哪一份就是掷硬币。现在只有一种收尾语义：
//   · 松手（pointerup）        → 提交（onCommit）
//   · 其它一切终止             → 回到拖之前（onCancel）：pointercancel、窗口失焦 blur、
//                                 丢失 pointer capture、页面隐藏、Esc、组件卸载
//   · 两种情况之后都只调一次 onEnd，用来清 React 状态
//
// 为什么不用 @use-gesture/react：它把 pointercancel 当成普通松手（走 pointerUp → 提交半截拖动），
// 不处理 blur / lostpointercapture / Esc；时间轴的编辑是「松手才落盘、打断必须回滚」，
// 要把这三格补齐、再把 cancel 与 release 分开，包装层不比这里短。评估记录见
// docs/plan/2026-10-09-clip-gesture-ownership.md「现成库评估」。
// 打断监听复用画布已有的租约（canvasDraggingFlag.beginCanvasDragging，active:false 不升旗），
// 不另写第二套 blur / pointercancel / lostpointercapture / visibilitychange 监听。
import React from 'react'
import { CANVAS_DRAGGING_OWNER, beginCanvasDragging } from '../generationCanvas/components/canvasDraggingFlag'
import { useWorkbenchStore } from '../workbenchStore'

export type PointerSessionEndReason = 'release' | 'interrupted' | 'escape' | 'dispose'

export type PointerSessionInput = {
  /** 触发手势的 pointerdown（React 合成事件或原生事件都行）。 */
  event: { pointerId: number; currentTarget: EventTarget | null }
  onMove?: (event: PointerEvent) => void
  /** 只有松手会走到这里。 */
  onCommit?: (event: PointerEvent) => void
  /** 除松手外的所有终止：状态必须回到按下之前。 */
  onCancel?: (reason: Exclude<PointerSessionEndReason, 'release'>) => void
  /** 两条路径之后各调一次；用来清 React 状态与监听外的临时量。 */
  onEnd?: () => void
}

export type PointerSession = {
  readonly active: boolean
  /** 外部主动收尾（例如宿主节点被删）。等同于被打断。 */
  cancel: (reason?: Exclude<PointerSessionEndReason, 'release'>) => void
}

export function beginPointerSession(input: PointerSessionInput): PointerSession {
  const { pointerId } = input.event
  const target = input.event.currentTarget instanceof Element ? input.event.currentTarget : null
  let finished = false

  try { target?.setPointerCapture(pointerId) } catch { /* 元素已离开文档：没有 capture 也能靠 window 监听收尾 */ }

  const lease = beginCanvasDragging(target, CANVAS_DRAGGING_OWNER.timelineGesture, {
    pointerId,
    active: false,
    onCancel: () => finish('interrupted', null),
  })

  const handleMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId || finished) return
    input.onMove?.(event)
  }
  const handleUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    finish('release', event)
  }
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    finish('escape', null)
  }

  function finish(reason: PointerSessionEndReason, upEvent: PointerEvent | null): void {
    if (finished) return
    finished = true
    window.removeEventListener('pointermove', handleMove)
    window.removeEventListener('pointerup', handleUp)
    window.removeEventListener('keydown', handleKeyDown, true)
    lease.release()
    try { if (target?.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId) } catch { /* 已丢失 */ }
    try {
      if (reason === 'release' && upEvent) input.onCommit?.(upEvent)
      else if (reason !== 'release') input.onCancel?.(reason)
    } finally {
      input.onEnd?.()
    }
  }

  window.addEventListener('pointermove', handleMove)
  window.addEventListener('pointerup', handleUp)
  window.addEventListener('keydown', handleKeyDown, true)

  return {
    get active() { return !finished },
    cancel: (reason = 'interrupted') => finish(reason, null),
  }
}

/**
 * 组件持有手势的方式：开始时登记，卸载时（片段被删、面板关闭）把没结束的手势按「被打断」收掉。
 * 同一个组件同一时刻只会有一个活动手势，新手势开始会先收掉旧的。
 */
export function usePointerSession(): (input: PointerSessionInput) => PointerSession {
  const activeRef = React.useRef<PointerSession | null>(null)
  React.useEffect(() => () => {
    activeRef.current?.cancel('dispose')
    activeRef.current = null
  }, [])
  return React.useCallback((input) => {
    activeRef.current?.cancel('interrupted')
    const session = beginPointerSession(input)
    activeRef.current = session
    return session
  }, [])
}

/**
 * 工作台时间轴（全局轨道）的编辑是「首次真动才压撤销栈、拖动中实时写 store、松手 commit」。
 * 被打断时撤销栈顶就是按下之前的那一帧，弹回去 = 回到拖之前，不留半截拖动（也不留 redo）。
 * `captured` 为 false（还没真动过）时什么都不能弹——否则会撤掉用户上一个无关的编辑。
 */
export function revertCapturedTimelineEdit(captured: boolean): void {
  if (!captured) return
  useWorkbenchStore.getState().cancelTimelineGesture()
}
