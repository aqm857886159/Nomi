/**
 * 「这条 wire 是同步返回结果，还是提交任务之后要去轮询」——**这是每家上游各自的契约事实，
 * 不是 `kind` 的常量。**
 *
 * 2026-08-30 的音频那次把这条边界划在了「音频字节 vs JSON 任务」这一层（合同
 * docs/fixes/2026-08-30-synchronous-audio-certification-boundary.root-cause.json），
 * 于是同一句报错 `pending task but the adapter has no query operation` 在 09-11 从图片那边
 * 原样回来了：`newapiTransportFor(kind)` 按 kind 发配方，图片那格从来没有 query，任何把图片
 * 做成「提交 → 轮询」的中转必错。类根因因此扩到**全部媒体类型**：
 *
 *   声明交付形状的是**契约**，不是 kind；声明成异步就**必须**同时交出
 *   ① 查询端点（query + statusMapping）和 ② 一份「任务不要了怎么办」的处置声明。
 *
 * ② 为什么不是「必须有 cancel 端点」：new-api 的公开契约（doc.newapi.pro / newapi.ai，见
 * newapiTransport.ts 文件头的 R5 核对记录）只给了 create 与 query，**没有**取消端点。编一个出来
 * 违反 R5/R31。所以处置是个二选一的显式声明：有取消端点就用它，没有就必须 `poll-to-completion`
 * ——**唯独不许「丢」**。丢掉一个已受理的任务正是 09-11 那次「钱花了、任务还在跑、我们转身就走」。
 */
import type { HttpOperation } from "./types";

export type TransportDelivery = "synchronous" | "asynchronous";

/** 一个已受理的异步任务不要了的时候怎么办。两种都行，**没有第三种叫「丢掉」**。 */
export type TransportAbandonDisposition =
  | { via: "cancel-operation"; cancel: HttpOperation }
  | { via: "poll-to-completion" };

export type TransportDeliveryContract = {
  delivery: TransportDelivery;
  /** `delivery === "asynchronous"` 时必填。 */
  abandon?: TransportAbandonDisposition;
};

export type DeliveryShapedMode = {
  delivery?: TransportDelivery;
  query?: HttpOperation | null;
  statusMapping?: Record<string, string[]> | null;
  abandon?: TransportAbandonDisposition | null;
};

/**
 * 没有显式声明时按**已有事实**推断（存量说明卡、AI 编译出来的卡都还没有这个字段）：
 * 带 query 的就是异步。推断只用于向后兼容，新写的配方一律显式声明。
 */
export function resolveModeDelivery(mode: DeliveryShapedMode): TransportDelivery {
  return mode.delivery || (mode.query ? "asynchronous" : "synchronous");
}

/**
 * 这条模式的交付声明自洽吗。返回人可读的缺陷短语（供自检拼进结构化原因），自洽则返回 null。
 * **纯函数、零网络**——这一类缺陷本来就该在花一分钱之前被发现。
 */
export function modeDeliveryDefect(mode: DeliveryShapedMode): string | null {
  if (resolveModeDelivery(mode) === "synchronous") {
    return mode.delivery === "synchronous" && mode.query
      ? "declares synchronous delivery but also carries a query operation"
      : null;
  }
  if (!mode.query?.method || !mode.query?.path) {
    return "declares asynchronous delivery but has no query operation";
  }
  if (!mode.statusMapping || Object.keys(mode.statusMapping).length === 0) {
    return "declares asynchronous delivery but has no status mapping";
  }
  return null;
}

/**
 * 传输配方层的同一条不变量（比模式层多管一件事：异步必须声明任务处置）。
 * 在模块加载时调用 = 任何人新加一份按 kind 硬写同步的配方，进程起不来（R28 防线建在最早那层）。
 */
export function assertTransportDeliveryContract(label: string, contract: TransportDeliveryContract & DeliveryShapedMode): void {
  const defect = modeDeliveryDefect({ ...contract, delivery: contract.delivery });
  if (defect) throw new Error(`Transport contract ${label} ${defect}`);
  if (contract.delivery === "asynchronous" && !contract.abandon) {
    throw new Error(`Transport contract ${label} declares asynchronous delivery but no abandon disposition (cancel operation or poll-to-completion)`);
  }
}
