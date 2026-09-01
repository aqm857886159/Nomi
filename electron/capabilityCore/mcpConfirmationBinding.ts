// 能力核 · 「一个确认面绑一个 authority key」的并发绑定。
//
// 同一服务端 challenge 的并发确认共享一个 in-flight promise，让客户端超时、重连或重复调用
// 不会铸出第二张提示或 nonce。这个绑定只复用同一 challenge 的确认结果；它不签发授权，
// 不建立项目级会话信任，也不能把一次确认扩张到另一笔付费操作。

/**
 * 建一个按 key 去重的确认绑定器。每条 MCP 连接/协议实例各持一个（闭包生命周期，连接断即亡）。
 *
 * 语义：同一个 key 上有确认在飞 → 后来者**排队**等同一个 promise，不另开一个确认面。
 * 结果为「未确认」（decline / 超时 / 异常）→ 摘掉记录，下次重新问（否则一次 decline 会永久毒化这个 key）。
   * 结果为「已确认」→ 保留到 authority 完成 durable consumption 后显式 release。
 */
export function createConfirmationBinding<T>(options: {
  /** 拿到结果后判断「这次算确认成功吗」——决定要不要保留 in-flight 记录。 */
  isConfirmed: (result: T) => boolean;
}) {
  const inFlight = new Map<string, Promise<T>>();
  let anonymousKeySequence = 0;

  return {
    /**
     * 在 key 上跑一次确认；同 key 并发时共享同一个 in-flight promise。
     * key 为空串 → 生成一个本次调用专属的匿名 key。空 projectId 没有可共享的身份，但任何请求
     * 都仍要进入账本；绝不能把空 key 当成「跳过并发绑定」的逃生口。
     */
    async run(key: string, task: () => Promise<T>): Promise<T> {
      const isAnonymous = !key;
      const bindingKey = isAnonymous ? `__anonymous__:${(anonymousKeySequence += 1)}` : key;
      const existing = inFlight.get(bindingKey);
      if (existing) return existing;
      const pending = task();
      inFlight.set(bindingKey, pending);
      try {
        const result = await pending;
        // 未确认 → 摘记录，下次重新问（一次 decline 不该永久堵死这个 key）。
        // 匿名 key 没有后续请求可安全复用，确认/拒绝后都摘掉，避免匿名条目泄漏。
        if (isAnonymous || !options.isConfirmed(result)) inFlight.delete(bindingKey);
        return result;
      } catch (error) {
        inFlight.delete(bindingKey);
        throw error;
      }
    },

    /** authority 已 durable consume 这次确认后，摘掉 in-flight 记录。 */
    release(key: string): void {
      if (key) inFlight.delete(key);
    },

    /** 仅供测试/诊断。 */
    size(): number {
      return inFlight.size;
    },
  };
}
