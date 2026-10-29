// 中立的在途 IPC 请求登记（补预览、视频拆解、本地素材导入共用）：停止的四个来源汇成同一个 signal，停下回 null、不算失败。
// 补预览一路传到 ffmpeg 的整链在 electron/assets/previewRequests.test.ts，导入转码的整链（真 ffmpeg、真退出）在
// electron/assets/importTranscodeLifecycle.integration.test.ts；这里只钉登记本身的契约。
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createIpcRequestRegistry } from "./ipcRequestRegistry";

class FakeSender extends EventEmitter {
  destroyed = false;
  constructor(readonly id: number) { super(); }
  isDestroyed(): boolean { return this.destroyed; }
  destroy(): void { this.destroyed = true; this.emit("destroyed"); }
}

/** 一件一直跑到被撤的活：撤了就照叶子的样子抛错（错误本身不是「失败」）。 */
function untilAborted(seen: AbortSignal[]) {
  return (signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
    seen.push(signal);
    signal.addEventListener("abort", () => reject(new Error("child killed")), { once: true });
  });
}

describe("在途 IPC 请求登记", () => {
  it("同一个窗口按请求号撤得动；别的窗口、陌生请求号撤不动；撤了回 null", async () => {
    const registry = createIpcRequestRegistry();
    const seen: AbortSignal[] = [];
    const pending = registry.run(new FakeSender(1), "r1", undefined, untilAborted(seen));
    expect(registry.inflightCount()).toBe(1);
    expect(registry.cancel(2, "r1")).toBe(false);
    expect(registry.cancel(1, "other")).toBe(false);
    expect(registry.cancel(1, "")).toBe(false);
    expect(seen[0]?.aborted).toBe(false);
    expect(registry.cancel(1, "r1")).toBe(true);
    expect(seen[0]?.aborted).toBe(true);
    await expect(pending).resolves.toBeNull();
    expect(registry.inflightCount()).toBe(0);
    expect(registry.cancel(1, "r1")).toBe(false);
  });

  it("登记在第一个 await 之前：干活那一层还在准备时到达的取消也生效", async () => {
    const registry = createIpcRequestRegistry();
    let received: AbortSignal | undefined;
    const pending = registry.run(new FakeSender(1), "r1", undefined, async (signal) => {
      await Promise.resolve();
      received = signal;
      signal.throwIfAborted();
      return "ran";
    });
    expect(registry.cancel(1, "r1")).toBe(true);
    await expect(pending).resolves.toBeNull();
    expect(received?.aborted).toBe(true);
  });

  it("发起窗口销毁即撤；一开始就销毁的窗口直接给已撤的 signal", async () => {
    const registry = createIpcRequestRegistry();
    const sender = new FakeSender(1);
    const seen: AbortSignal[] = [];
    const pending = registry.run(sender, "r1", undefined, untilAborted(seen));
    sender.destroy();
    await expect(pending).resolves.toBeNull();
    expect(sender.listenerCount("destroyed")).toBe(0);

    const gone = new FakeSender(2);
    gone.destroyed = true;
    let initiallyAborted: boolean | undefined;
    await expect(registry.run(gone, "r2", undefined, async (signal) => { initiallyAborted = signal.aborted; signal.throwIfAborted(); return "ran"; })).resolves.toBeNull();
    expect(initiallyAborted).toBe(true);
  });

  it("项目上下文失效（复核抛错）即撤", async () => {
    const registry = createIpcRequestRegistry({ pollMs: 5 });
    let current = true;
    const seen: AbortSignal[] = [];
    const pending = registry.run(new FakeSender(1), "r1", () => { if (!current) throw new Error("project_binding_stale"); }, untilAborted(seen));
    expect(seen[0]?.aborted).toBe(false);
    current = false;
    await expect(pending).resolves.toBeNull();
  });

  it("没被撤的失败照原样抛出：停下才回 null，真失败不被吞", async () => {
    const registry = createIpcRequestRegistry();
    await expect(registry.run(new FakeSender(1), "r1", undefined, async () => { throw new Error("ffmpeg exited 1"); })).rejects.toThrow("ffmpeg exited 1");
    expect(registry.inflightCount()).toBe(0);
  });

  it("同一个窗口同一个请求号再来一次：先撤掉上一次", async () => {
    const registry = createIpcRequestRegistry();
    const seen: AbortSignal[] = [];
    const first = registry.run(new FakeSender(1), "r1", undefined, untilAborted(seen));
    const second = registry.run(new FakeSender(1), "r1", undefined, untilAborted(seen));
    await expect(first).resolves.toBeNull();
    expect(seen[1]?.aborted).toBe(false);
    expect(registry.cancel(1, "r1")).toBe(true);
    await expect(second).resolves.toBeNull();
  });

  it("退出收摊：drain 立刻撤掉全部在跑的（含没带请求号的），兑现时返回件数", async () => {
    const registry = createIpcRequestRegistry();
    const seen: AbortSignal[] = [];
    const keyed = registry.run(new FakeSender(1), "r1", undefined, untilAborted(seen));
    const anonymous = registry.run(new FakeSender(2), "", undefined, untilAborted(seen));
    const drained = registry.drain();
    // 中止是同步生效的：还没 await drain，signal 就已经撤了（只要立刻中止的调用方可以不等它）。
    expect(seen.every((signal) => signal.aborted)).toBe(true);
    expect(await drained).toBe(2);
    await expect(Promise.all([keyed, anonymous])).resolves.toEqual([null, null]);
    expect(registry.inflightCount()).toBe(0);
    expect(await registry.drain()).toBe(0);
  });

  it("drain 要等每一件连收尾都做完才兑现（子进程没了、半成品和临时目录删了都在收尾里）", async () => {
    const registry = createIpcRequestRegistry();
    const cleaned: number[] = [];
    const startRequest = (id: number) => registry.run(new FakeSender(id), "", undefined, async (signal) => {
      try {
        await new Promise((_resolve, reject) => { signal.addEventListener("abort", () => reject(new Error("child killed")), { once: true }); });
      } finally {
        // 收尾本身也要时间（删半成品、删临时目录都是异步 I/O）。
        await new Promise((resolve) => setImmediate(resolve));
        cleaned.push(id);
      }
    });
    const requests = [startRequest(3), startRequest(4)];
    let drained = false;
    const draining = registry.drain().then((count) => { drained = true; return count; });
    await Promise.resolve();
    expect(drained).toBe(false);
    expect(await draining).toBe(2);
    expect(cleaned.sort((a, b) => a - b)).toEqual([3, 4]);
    expect(registry.inflightCount()).toBe(0);
    await expect(Promise.all(requests)).resolves.toEqual([null, null]);
  });

  it("drain 之后不再接新请求：run 直接回 null，work 一行不调（退出开始后不起新的子进程）", async () => {
    const registry = createIpcRequestRegistry();
    const seen: AbortSignal[] = [];
    const running = registry.run(new FakeSender(1), "r1", undefined, untilAborted(seen));
    const draining = registry.drain();
    // 前一件还没收完尾的时候来的新请求，和收完之后来的，都一样。
    let started = 0;
    const late = () => registry.run(new FakeSender(2), "", undefined, async () => { started += 1; return "ran"; });
    await expect(late()).resolves.toBeNull();
    expect(await draining).toBe(1);
    await expect(running).resolves.toBeNull();
    await expect(late()).resolves.toBeNull();
    expect(started).toBe(0);
    expect(registry.inflightCount()).toBe(0);
  });

  it("不带请求号的请求（导入）：发起窗口销毁即撤，回 null，不留在途也不留监听", async () => {
    const registry = createIpcRequestRegistry();
    const sender = new FakeSender(1);
    const seen: AbortSignal[] = [];
    const pending = registry.run(sender, "", undefined, untilAborted(seen));
    expect(registry.inflightCount()).toBe(1);
    sender.destroy();
    await expect(pending).resolves.toBeNull();
    expect(seen[0]?.aborted).toBe(true);
    expect(registry.inflightCount()).toBe(0);
    expect(sender.listenerCount("destroyed")).toBe(0);
  });

  it("不带请求号的请求（导入）：项目会话失效（复核抛错）即撤，回 null", async () => {
    const registry = createIpcRequestRegistry({ pollMs: 5 });
    let current = true;
    const seen: AbortSignal[] = [];
    const pending = registry.run(new FakeSender(1), "", () => { if (!current) throw new Error("project_binding_stale"); }, untilAborted(seen));
    expect(seen[0]?.aborted).toBe(false);
    current = false;
    await expect(pending).resolves.toBeNull();
    expect(seen[0]?.aborted).toBe(true);
    expect(registry.inflightCount()).toBe(0);
  });

  it("不带请求号的请求互不相撤：同一个窗口同时来两件，各有各的 signal，后来的不撤先来的", async () => {
    const registry = createIpcRequestRegistry();
    const sender = new FakeSender(1);
    const seen: AbortSignal[] = [];
    const first = registry.run(sender, "", undefined, untilAborted(seen));
    const second = registry.run(sender, "", undefined, untilAborted(seen));
    expect(registry.inflightCount()).toBe(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen.map((signal) => signal.aborted)).toEqual([false, false]);
    expect(await registry.drain()).toBe(2);
    await expect(Promise.all([first, second])).resolves.toEqual([null, null]);
  });
});
