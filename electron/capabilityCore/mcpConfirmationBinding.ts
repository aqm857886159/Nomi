// 能力核 · 「一个确认面绑一个 key」的并发绑定（从 mcpGateConfirmation.ts 提取，两处共用）。
//
// 治的是真金 bug（审计 2026-08-25）：**两个首次付费请求可能同时进确认路径**。
// nomi_generate 的付费路只有一个项目级布尔信任（mcpSpendTrust），并发窗口 = 「第一次 elicit 发出」
// 到「trust 落账」之间——两个请求同时发现 isTrusted=false，于是双双弹确认、双双放行 = 用户看见两张卡，
// 或更糟：他点了一张，另一张的生成也跟着跑了。
//
// 为什么提取而不是新写一套（P1 不造第二套）：生成门（mcpGateConfirmation）早就有这个模式——同 challengeId
// 的并发确认共享一个 in-flight promise，让「客户端超时/重连铸不出第二张提示或 nonce」。付费路要的是同一件事，
// 只是 key 从 challengeId 换成 projectId。两处共用一份实现，语义不会各写各的、漂移开。
//
// ⚠️ 边界（别读成「一次确认放行两笔生成」）：排队者复用的是**确认结果**，不是**授权令牌**。
// 第二个请求即便因排队而免弹卡，它仍要逐笔经主进程 assertAndConsumeSpendGrant 铸/校验自己的令牌——
// 硬闸一步没少。语义是「一次确认建立一段会话信任，信任内每笔仍逐笔铸令牌」，与确认卡上写明的授权范围一致
// （见 mcpSpendTrust.spendConfirmElicit 的 scope 文案）。

/**
 * 建一个按 key 去重的确认绑定器。每条 MCP 连接/协议实例各持一个（闭包生命周期，连接断即亡）。
 *
 * 语义：同一个 key 上有确认在飞 → 后来者**排队**等同一个 promise，不另开一个确认面。
 * 结果为「未确认」（decline / 超时 / 异常）→ 摘掉记录，下次重新问（否则一次 decline 会永久毒化这个 key）。
 * 结果为「已确认」→ 由调用方决定要不要落成更长命的信任（如 spendTrust），本模块不替它记。
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

    /** 确认已落成更长命的信任后，调用方摘掉 in-flight 记录（如 spendTrust.trust 之后）。 */
    release(key: string): void {
      if (key) inFlight.delete(key);
    },

    /** 仅供测试/诊断。 */
    size(): number {
      return inFlight.size;
    },
  };
}
