// 能力核 · 「一个确认面绑一个 authority key」的并发绑定。
//
// 同一服务端 challenge 的并发确认共享一个 in-flight promise，让客户端超时、重连或重复调用
// 不会铸出第二张提示或 nonce。这个绑定只合并「正在问」的那一次；它不签发授权、不记住结果，
// 不建立项目级会话信任，也不能把一次确认扩张到另一笔付费操作。
//
// 「这一笔批过没有、用掉没有」只有主进程的生成门主人知道（runOwnedGenerationGateAuthority）：
// 这里从前把「确认成功」留在内存里，同一条连接再问就直接放行——收据已经花掉了它也照放（2026-11-20 收进一个家）。

/**
 * 建一个按 key 去重的确认绑定器。每条 MCP 连接/协议实例各持一个（闭包生命周期，连接断即亡）。
 *
 * 语义：同一个 key 上有确认在飞 → 后来者**排队**等同一个 promise，不另开一个确认面。
 * 这一次问完（不论答了什么、出没出错）就摘掉记录；下一次再来由主进程判还要不要问人。
 */
export function createConfirmationBinding<T>() {
  const inFlight = new Map<string, Promise<T>>();
  let anonymousKeySequence = 0;

  return {
    /**
     * 在 key 上跑一次确认；同 key 并发时共享同一个 in-flight promise。
     * key 为空串 → 生成一个本次调用专属的匿名 key。空 projectId 没有可共享的身份，但任何请求
     * 都仍要进入账本；绝不能把空 key 当成「跳过并发绑定」的逃生口。
     */
    async run(key: string, task: () => Promise<T>): Promise<T> {
      const bindingKey = key || `__anonymous__:${(anonymousKeySequence += 1)}`;
      const existing = inFlight.get(bindingKey);
      if (existing) return existing;
      const pending = task();
      inFlight.set(bindingKey, pending);
      try {
        return await pending;
      } finally {
        inFlight.delete(bindingKey);
      }
    },

    /** 仅供测试/诊断。 */
    size(): number {
      return inFlight.size;
    },
  };
}
