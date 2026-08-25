// 能力核 · MCP 在飞请求账本（request registry）。纯逻辑、不 import electron → 可裸 node 单测。
//
// 为什么要这层：协议层此前**不知道「此刻有哪些请求在飞、各自怎么中止」**——`notifications/cancelled`
// 通知因为没有 id 在 handle() 开头就被丢掉，stdio 断连也只是退进程。后果是真金风险：客户端撤回请求或
// stdio 超时后，付费生成可能仍在后台继续跑（审计 2026-08-25 §2）。取消不是「少写一个 if」，是缺一层
// 生命周期账本；有了账本，取消、断连、超时三种「结果不再被需要」的情形才有同一个地方可挂。
//
// 规范语义（MCP spec 2025-11-25 · basic/utilities/cancellation，经 Context7 实查 R5）：
//   · 收到取消 → 停止处理、释放资源，且**不要为该请求发响应**（not send a response）。
//   · 未知 requestId / 已完成 / 畸形通知 → **忽略**（保持通知的 fire-and-forget，容忍网络竞态）。
//   · 客户端**禁止**取消 initialize。
// 「忽略」是规范明写的正确行为，不是偷懒——取消通知天然可能后到（响应已发出），报错反而制造假故障。

/** 一条在飞请求的账目。abort 句柄交给执行方（transport.invoke / elicitation / 进度心跳）挂钩。 */
type InFlightEntry = {
  controller: AbortController
}

/** 不可取消的方法（规范硬性）：initialize 是连接的地基，取消它没有明确语义。 */
const NON_CANCELLABLE_METHODS = new Set(['initialize'])

export type McpRequestRegistry = ReturnType<typeof createMcpRequestRegistry>

/**
 * 建一个在飞请求账本。每条 MCP 连接/协议实例各持一个（与 planTrust / spendTrust 同款闭包生命周期）。
 * key 用 String(id)——JSON-RPC 的 id 可以是 number 或 string，两者在账本里必须归一，否则
 * 客户端用 number 发、用 string 取消（或反过来）就会对不上。
 */
export function createMcpRequestRegistry() {
  const inFlight = new Map<string, InFlightEntry>()
  // 已取消请求的墓碑：取消后条目就从 inFlight 摘掉（释放 controller），但「这条不许回响应」这个事实
  // 必须活到执行链真正走完为止——否则 invoke 的 catch/finally 里那句 reply 会照发不误，
  // 正好违反规范的 not send a response。墓碑在 finish() 时清（执行链收尾 = 事实用完了）。
  const cancelledIds = new Map<string, AbortController>()

  return {
    /**
     * 登记一条在飞请求，返回它的 abort signal 与收尾函数。
     * 不可取消的方法（initialize）不进账本 → 返回一个永不 abort 的 signal，调用方无需分支。
     */
    begin(id: unknown, method: string): { signal: AbortSignal; finish: () => void } {
      if (NON_CANCELLABLE_METHODS.has(method)) {
        return { signal: new AbortController().signal, finish: () => {} }
      }
      const key = String(id)
      // 同 id 重复进来（客户端行为异常）→ 先收掉旧账，不静默泄漏一个 controller。
      inFlight.get(key)?.controller.abort()
      cancelledIds.delete(key) // 新一轮开始，旧墓碑作废
      const controller = new AbortController()
      inFlight.set(key, { controller })
      return {
        signal: controller.signal,
        finish: () => {
          // 只删自己这条：取消后可能已被替换，别误删后来者。
          if (inFlight.get(key)?.controller === controller) inFlight.delete(key)
          // 同 id 的新一轮请求可能已经登记；旧请求收尾不能清掉新请求的墓碑。
          if (cancelledIds.get(key) === controller) cancelledIds.delete(key)
        },
      }
    },

    /**
     * 处理一条 notifications/cancelled。未知 / 已完成 / 畸形 → 静默忽略（规范要求）。
     * 返回值只用于测试与日志，调用方不必分支。
     */
    cancel(requestId: unknown, reason?: string): boolean {
      if (!isRequestId(requestId)) return false
      const key = String(requestId)
      const entry = inFlight.get(key)
      if (!entry) return false // 未知或已完成 → 忽略（fire-and-forget，容忍竞态）
      entry.controller.abort(reason ? new Error(reason) : undefined)
      inFlight.delete(key)
      cancelledIds.set(key, entry.controller) // 立墓碑：执行链收尾前，这条一律不许回响应
      return true
    },

    /** stdio 断连 / 进程退出：中止全部在飞工作，别把付费生成留在后台跑。 */
    cancelAll(reason: string): number {
      const count = inFlight.size
      for (const [key, entry] of inFlight) {
        entry.controller.abort(new Error(reason))
        cancelledIds.set(key, entry.controller)
      }
      inFlight.clear()
      return count
    },

    /**
     * 这条请求还该不该回响应。被取消过 → false（规范：not send a response）。
     * 已 finish 掉的（正常完成）也返回 true——正常路径的 reply 就发生在 finish 之前/之时。
     */
    shouldReply(id: unknown): boolean {
      const key = String(id)
      if (cancelledIds.has(key)) return false
      return true
    },

    /** 仅供测试/诊断：当前在飞条数。 */
    size(): number {
      return inFlight.size
    },
  }
}

function isRequestId(value: unknown): value is string | number {
  return (typeof value === 'string' && value.length > 0)
    || (typeof value === 'number' && Number.isFinite(value))
}
