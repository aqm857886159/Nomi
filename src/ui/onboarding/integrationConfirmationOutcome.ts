/**
 * 点完「确认验证」之后该关弹层还是该留下报错——这一格的唯一判据。
 *
 * 为什么单独一个纯函数：2026-09-11 真机矩阵 §BUG-2 里，主进程已经把
 * `stage: "failed"` + `blockingReason.code` 如实写回来了，是弹层**不看返回值**、
 * 一律 `onDone()`，用户只看到「弹层关掉、跳回还没有接入生成模型」。
 * 把「看不看」变成一个可断言的函数，而不是藏在 async 回调里。
 */
export type IntegrationConfirmationOutcome = { done: true } | { done: false; reasonCode: string | null }

export function integrationConfirmationOutcome(projection: unknown): IntegrationConfirmationOutcome {
  if (!projection || typeof projection !== 'object') return { done: true }
  const record = projection as Record<string, unknown>
  if (record.stage !== 'failed') return { done: true }
  const blocking = record.blockingReason
  const code =
    blocking && typeof blocking === 'object' && typeof (blocking as Record<string, unknown>).code === 'string'
      ? String((blocking as Record<string, unknown>).code)
      : null
  return { done: false, reasonCode: code }
}
