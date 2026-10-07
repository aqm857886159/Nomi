/**
 * 把一个「已提交、还在路上」的任务查到终态——**主进程里唯一一份**「提交之后怎么等」。
 *
 * 接模型试跑（`tryModel`）问它（`generateOnProject` 那一族由收敛第 0 步整体删除，删完它就是唯一一份）：
 * 任务已经被供应商收下 = 钱已经花了，所以这里
 *   · 查询失败一律免费重试，绝不冒泡（一次网络抖动不能终止已付费任务）；
 *   · 到点 / 持续查不通只是**告诉调用方「没等到」**，由调用方决定怎么说——不在这里编造失败。
 *     （超时 ≠ 上游失败：任务多半仍在供应商侧运行。）
 * 它从不重发提交，所以也不可能重复扣费。
 */
import { isTerminalTaskStatus } from '../shared/taskStatus'
import type { FetchTaskResultFn } from './core'

type TaskResultLike = Awaited<ReturnType<FetchTaskResultFn>>['result']

/** 查结果连续失败多久才放弃（与渲染层 catalogTaskActions 的 POLL_FAILURE_GRACE_MS 配对，改一处必改另一处）。 */
export const POLL_FAILURE_GRACE_MS = 45_000

export type PollEnded = 'terminal' | 'timeout' | 'poll_failed'

export type PollOutcome = {
  /** 最后一次拿到的结果（`ended !== 'terminal'` 时仍是非终态，id 即任务号）。 */
  result: TaskResultLike
  ended: PollEnded
  /** 到点 / 放弃时已等了多久（毫秒）。 */
  waitedMs: number
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function pollTaskToTerminal(input: {
  initial: TaskResultLike
  fetch: FetchTaskResultFn
  vendor: string
  taskKind: string
  prompt: string
  modelKey: string
  timeoutMs: number
  intervalMs: number
}): Promise<PollOutcome> {
  let result = input.initial
  const startedAt = Date.now()
  let failureStreakStartedAt: number | null = null
  while (result.status && !isTerminalTaskStatus(result.status)) {
    if (Date.now() - startedAt >= input.timeoutMs) {
      return { result, ended: 'timeout', waitedMs: Date.now() - startedAt }
    }
    // 睡眠也不越过预算：最后一次间隔被截短，保证总等待不超过 timeoutMs。
    await sleep(Math.min(input.intervalMs, Math.max(0, input.timeoutMs - (Date.now() - startedAt))))
    try {
      // 每一次查询自己也有截止时间（剩余预算）：否则一次卡住的查询能把总等待拖过上限。
      // 卡住 = 这次查询不通（同下面的 catch：免费重试 / 到点放弃），绝不当成任务失败。
      const remaining = Math.max(0, input.timeoutMs - (Date.now() - startedAt))
      let budgetTimer: ReturnType<typeof setTimeout> | undefined
      const polled = await Promise.race([
        input.fetch({
          taskId: result.id || '',
          vendor: input.vendor,
          taskKind: input.taskKind,
          prompt: input.prompt,
          modelKey: input.modelKey,
        }),
        new Promise<never>((_resolve, reject) => {
          budgetTimer = setTimeout(() => reject(new Error('poll_attempt_budget_exhausted')), remaining)
        }),
      ]).finally(() => clearTimeout(budgetTimer))
      result = polled.result
      failureStreakStartedAt = null
    } catch {
      const now = Date.now()
      if (failureStreakStartedAt == null) failureStreakStartedAt = now
      if (now - failureStreakStartedAt > POLL_FAILURE_GRACE_MS) {
        return { result, ended: 'poll_failed', waitedMs: now - startedAt }
      }
    }
  }
  return { result, ended: 'terminal', waitedMs: Date.now() - startedAt }
}
