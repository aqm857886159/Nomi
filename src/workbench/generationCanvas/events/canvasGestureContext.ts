// 画布手势环境上下文(harness S6-2)——agent 提议事务应用期间,让途经的 store action
// 发出的事件统一携带 source:'agent' + 共享 txnId/proposalId(I1 因果不变量的数据前提),
// 并抑制 action 级 undo barrier(整笔提议=一次用户意志=一个 Cmd+Z 步,§6.2 粒度裁定)。
// 纪律:只允许包同步段(fn 内禁 await)——异步段间隙用户手势可插队,环境上下文会串台。
// 独立小模块:emitter 与 undoJournal 都要读它,放任一边都会循环依赖。

export type CanvasGestureContext = {
  source: 'user' | 'agent' | 'runtime'
  txnId: string
  proposalId?: string
  /** 事务期间 action 内置的 pushUndoSnapshot 不打 barrier(事务自己在边界打一个)。 */
  suppressUndoBarriers?: boolean
}

let active: CanvasGestureContext | null = null

export function getActiveCanvasGestureContext(): CanvasGestureContext | null {
  return active
}

/** 同步包裹:fn 期间的 emitCanvasGesture/pushUndoSnapshot 读到 ctx;fn 必须无 await。 */
export function withCanvasGestureContext<T>(ctx: CanvasGestureContext, fn: () => T): T {
  const previous = active
  active = ctx
  try {
    return fn()
  } finally {
    active = previous
  }
}
