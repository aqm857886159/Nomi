import { useCallback, useEffect, useRef } from 'react'

/**
 * rAF 合帧：把高频更新合并成「每帧最多执行一次」。根治流式吐字时每个 token 都
 * `setMessages((prev) => prev.map(...))`——每秒 20–60 次克隆整个消息数组 + 全线程 reconcile
 * 导致的掉帧（创作助手此前没做合帧，而画布助手 CanvasAssistantPanel 已用同样的 rAF 思路）。
 *
 * 用 thunk 形式而非「累积文本」：流式内容是 cumulative（最新 thunk 即写全文），所以只保留
 * 最新 thunk、每帧 flush 一次即正确，且对调用方零侵入（push 一个 setState 闭包即可）。
 *
 * 终态（done/error/cancelled）落定前必须 cancel()：终态 setState 与它之前的代码同步执行、
 * 中间无 await（不让出主线程），故此后挂起的 rAF 已被 cancel，不会用过期的 streaming 文本盖掉终态。
 */
export function useRafCoalesce(): {
  push: (run: () => void) => void
  cancel: () => void
} {
  const pending = useRef<(() => void) | null>(null)
  const raf = useRef<number | null>(null)

  const flush = useCallback(() => {
    raf.current = null
    const run = pending.current
    pending.current = null
    run?.()
  }, [])

  const push = useCallback(
    (run: () => void) => {
      pending.current = run
      if (raf.current === null) raf.current = requestAnimationFrame(flush)
    },
    [flush],
  )

  const cancel = useCallback(() => {
    if (raf.current !== null) {
      cancelAnimationFrame(raf.current)
      raf.current = null
    }
    pending.current = null
  }, [])

  useEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current)
    },
    [],
  )

  return { push, cancel }
}
