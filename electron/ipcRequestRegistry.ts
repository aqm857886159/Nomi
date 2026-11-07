/**
 * 主进程在途 IPC 长请求的停止边界（中立模块：补预览、视频拆解、本地素材导入共用这一份）。
 *
 * 2026-10-16 先长在补预览那里（electron/assets/previewRequests.ts）；2026-10-27 拆解要同一个东西，
 * 按用户拍板挪到这里，旧文件同提交删掉，不留第二份。同一天导入转码并行写了第二份（electron/assets 下导入专用的登记），
 * 按用户拍板并进这里：补上退出要「等落定」和「之后不接新请求」，导入改用这一份，那份同提交删掉。
 *
 * `ipcRenderer.invoke` 没有取消机制，AbortSignal 也过不了结构化克隆——取消只能是第二条按请求号寻址的通道。
 * 一次请求的停止由下面几个来源汇成同一个 AbortSignal，交给干活的那一层一路往下传：
 *   · 渲染层显式撤回：按「发送方:requestId」寻址，同一个窗口才能撤自己的请求；
 *   · 发起窗口销毁：sender 'destroyed'；
 *   · 项目上下文失效：发起时签发的 assertCurrent（窗口当前项目会话）按周期复核，失效即撤；
 *   · 退出：调用方把 drain 挂进 registerQuitDrain。drain 做三件事——立刻中止全部在途（含没带请求号的）；
 *     之后不再接新请求（run 直接回 null、不调 work，退出那几秒里不会再起新的子进程）；
 *     返回的 Promise 等这些请求连收尾都做完（finally 跑完：子进程没了、半成品和临时目录删了）才兑现。
 *     只要「立刻中止」就不 await 它；要等真停（例如导入转码）就 await。
 * 停下不是失败：signal 被 abort 之后，干活那一层抛出的任何错误都按「已停」收，返回 null（调用方据此不写事实）。
 * 返回值上 null 分不出「停下」和 work 自己合法地回 null；两者要分开的调用方（例如懒自愈：「本就可播」回 null，
 * 停下却要以取消收场）把结果装进箱子再交给 run，箱子是 null 才是停下。
 */
export type IpcRequestSender = {
  readonly id: number;
  isDestroyed(): boolean;
  once(event: "destroyed", listener: () => void): unknown;
  removeListener(event: "destroyed", listener: () => void): unknown;
};

export const IPC_REQUEST_CONTEXT_POLL_MS = 200;

export function createIpcRequestRegistry(options: { pollMs?: number } = {}) {
  const pollMs = options.pollMs ?? IPC_REQUEST_CONTEXT_POLL_MS;
  const inflight = new Map<string, AbortController>();
  /** 在途请求（含没带请求号的）→ 它「连收尾都做完」的那一刻：run 的 finally 跑完才兑现。 */
  const live = new Map<AbortController, Promise<void>>();
  let closing = false;
  const keyOf = (senderId: number, requestId: string) => `${senderId}:${requestId}`;

  async function run<T>(
    sender: IpcRequestSender,
    requestId: string,
    assertCurrent: (() => void) | undefined,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T | null> {
    // 退出已经开始（drain 之后）：不再接新请求，work 一行不调——否则它会在排空之后才起子进程，成为没人管的那一个。
    if (closing) return null;
    const controller = new AbortController();
    let settle: () => void = () => undefined;
    live.set(controller, new Promise<void>((resolve) => { settle = resolve; }));
    const key = requestId ? keyOf(sender.id, requestId) : "";
    if (key) {
      inflight.get(key)?.abort();
      inflight.set(key, controller);
    }
    const onDestroyed = () => controller.abort();
    sender.once("destroyed", onDestroyed);
    if (sender.isDestroyed()) controller.abort();
    const checkContext = () => {
      try { assertCurrent?.(); } catch { controller.abort(); }
    };
    checkContext();
    const timer = assertCurrent ? setInterval(checkContext, pollMs) : undefined;
    try {
      return await work(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return null;
      throw error;
    } finally {
      if (timer) clearInterval(timer);
      sender.removeListener("destroyed", onDestroyed);
      if (key && inflight.get(key) === controller) inflight.delete(key);
      live.delete(controller);
      settle();
    }
  }

  function cancel(senderId: number, requestId: string): boolean {
    const controller = requestId ? inflight.get(keyOf(senderId, requestId)) : undefined;
    controller?.abort();
    return Boolean(controller);
  }

  /**
   * 退出收摊：立刻（同步）把还在跑的全部中止，此后不再接新请求；返回的 Promise 等它们连收尾都做完才兑现，
   * 值是中止了几件。可以重复调用（第二次只会等还没落定的那几件）。
   */
  async function drain(): Promise<number> {
    closing = true;
    const pending = [...live];
    for (const [controller] of pending) controller.abort();
    await Promise.all(pending.map(([, settled]) => settled));
    return pending.length;
  }

  return { run, cancel, drain, inflightCount: () => live.size };
}

export type IpcRequestRegistry = ReturnType<typeof createIpcRequestRegistry>;
