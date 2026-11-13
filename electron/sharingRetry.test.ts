import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";

import { retryOnSharingViolation, renameSyncWithRetry } from "./jsonFile";
import { delaysFromTable, retryOnSharingViolationAsync, SHARING_RETRY_DELAYS_MS, SHARING_RETRY_LONG_DELAYS_MS } from "./sharingRetry";

const dirs: string[] = [];
const tmp = (): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nomi-sharing-retry-")));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const errno = (code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(`injected ${code}`), { code, ...extra });
/** 「持续 ms 毫秒的占用」：从第一次调用起 ms 毫秒内抛 code，之后放行。 */
function occupiedFor(ms: number, code: string): () => void {
  let first: number | null = null;
  return () => {
    first ??= Date.now();
    if (Date.now() - first < ms) throw errno(code);
  };
}
async function maxLoopDelayMs<T>(work: () => Promise<T>): Promise<{ value: T; maxMs: number }> {
  const histogram = monitorEventLoopDelay({ resolution: 5 });
  histogram.enable();
  try {
    const value = await work();
    return { value, maxMs: histogram.max / 1e6 };
  } finally {
    histogram.disable();
  }
}

describe("同步调用方（结构上只能同步的那几类）：持续 300ms 占用仍然最终成功，容忍没变差", () => {
  it.each(["EBUSY", "EPERM"])("retryOnSharingViolation 在 %s 持续 300ms 后成功", (code) => {
    const operation = occupiedFor(300, code);
    expect(retryOnSharingViolation(() => { operation(); return "ok"; })).toBe("ok");
  });

  it("renameSyncWithRetry 在 EPERM 持续 300ms 后成功", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "a"), "x");
    const blocked = occupiedFor(300, "EPERM");
    const rename = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { blocked(); return rename(from, to); });
    renameSyncWithRetry(path.join(dir, "a"), path.join(dir, "b"));
    expect(fs.existsSync(path.join(dir, "b"))).toBe(true);
  });
});

describe("同步助手的退避表就是 sharingRetry 的默认表（只一份）", () => {
  it("一直被占：按默认表睡 5 次、共试 6 次，抛原错误", () => {
    const sleeps: number[] = [];
    vi.spyOn(Atomics, "wait").mockImplementation((_array, _index, _value, timeout) => { sleeps.push(Number(timeout)); return "timed-out"; });
    let calls = 0;
    expect(() => retryOnSharingViolation(() => { calls += 1; throw errno("EBUSY"); })).toThrow(expect.objectContaining({ code: "EBUSY" }));
    expect(calls).toBe(6);
    expect(sleeps).toEqual([...SHARING_RETRY_DELAYS_MS]);
  });
});

describe("已在 async 函数里的调用方：同一个异步重试件，持续 300ms 占用后成功且不卡事件循环", () => {
  it.each(["EBUSY", "EPERM"])("%s 持续 300ms", async (code) => {
    const operation = occupiedFor(300, code);
    const { value, maxMs } = await maxLoopDelayMs(() => retryOnSharingViolationAsync(() => { operation(); return "ok"; }, { delayMs: delaysFromTable(SHARING_RETRY_LONG_DELAYS_MS) }));
    expect(value).toBe("ok");
    expect(maxMs).toBeLessThan(50);
  });

  it("回调返回的 Promise 被拒（异步改名）也接得住：前 2 次 EBUSY、第 3 次成功 → 成功，等的是表里前两档", async () => {
    const waits: number[] = [];
    let calls = 0;
    const value = await retryOnSharingViolationAsync(async () => {
      calls += 1;
      if (calls <= 2) throw errno("EBUSY");
      return "ok";
    }, { delayMs: delaysFromTable(SHARING_RETRY_LONG_DELAYS_MS), wait: async (ms) => { waits.push(ms); } });
    expect(value).toBe("ok");
    expect(calls).toBe(3);
    // 总等待 = 长表前两档之和（直接观测退避件请求的等待，不量墙钟）。
    expect(waits).toEqual(SHARING_RETRY_LONG_DELAYS_MS.slice(0, 2));
  });

  it("回调一直以 Promise 被拒：表用完后抛出的还是原来那个错误码", async () => {
    let calls = 0;
    await expect(retryOnSharingViolationAsync(() => { calls += 1; return Promise.reject(errno("EPERM", { syscall: "rename" })); }, {
      delayMs: delaysFromTable(SHARING_RETRY_LONG_DELAYS_MS), wait: async () => undefined,
    })).rejects.toMatchObject({ code: "EPERM", syscall: "rename" });
    expect(calls).toBe(SHARING_RETRY_LONG_DELAYS_MS.length + 1);
  });

  it("不是共享冲突的错立刻抛，预算用完如实抛最后一次的错", async () => {
    await expect(retryOnSharingViolationAsync(() => { throw errno("ENOENT"); })).rejects.toMatchObject({ code: "ENOENT" });
    let calls = 0;
    await expect(retryOnSharingViolationAsync(() => { calls += 1; throw errno("EBUSY"); }, { wait: async () => undefined })).rejects.toMatchObject({ code: "EBUSY" });
    expect(calls).toBe(6);
  });
});
