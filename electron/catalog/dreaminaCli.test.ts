/**
 * Tests for dreaminaCli.ts — 代理剥离 + 网络超时重试。
 *
 * 在 import dreaminaCli 之前 mock node:child_process 的 spawn，
 * 这样 dreaminaCli.ts 的顶部 import 会拿到 mock。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// 先 mock child_process，再 import dreaminaCli（顶部 import 会吃到 mock）。
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runDreaminaCli, resolveDreaminaBin } from "./dreaminaCli";

const mockSpawn = spawn as ReturnType<typeof vi.fn>;

/** 造一个假的 child_process，指定退出码、输出文本和延迟。 */
function makeFakeChild(code: number, stdout = "", stderr = "", delayMs = 0): ReturnType<typeof spawn> {
  const child = new EventEmitter() as ReturnType<typeof spawn>;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  const doClose = () => {
    child.stdout.push(stdout);
    child.stderr.push(stderr);
    child.stdout.push(null);
    child.stderr.push(null);
    child.emit("close", code);
  };
  if (delayMs > 0) {
    setTimeout(doClose, delayMs);
  } else {
    setImmediate(doClose);
  }
  return child;
}

describe("dreaminaCli", () => {
  beforeEach(() => {
    mockSpawn.mockClear();
    mockSpawn.mockImplementation(() => makeFakeChild(0, '{"submit_id":"u-1","gen_status":"querying"}', ""));
  });

  // ── 代理剥离（问题2） ──

  it("代理环境变量不传入 dreamina CLI spawn", async () => {
    process.env.HTTPS_PROXY = "http://127.0.0.1:7897";
    process.env.HTTP_PROXY = "http://127.0.0.1:1111";

    try {
      await runDreaminaCli(["text2video", "--prompt=test"], { timeoutMs: 5000 });
    } catch { /* 解析可能 fail，不关心结果 */ }

    const spawnCall = mockSpawn.mock.calls[0];
    expect(spawnCall).toBeDefined();
    const env = spawnCall[1]?.env as Record<string, string | undefined>;
    expect(env.HTTPS_PROXY).toBeUndefined();
    expect(env.HTTP_PROXY).toBeUndefined();
    expect(env.https_proxy).toBeUndefined();
    expect(env.http_proxy).toBeUndefined();
    expect(env.ALL_PROXY).toBeUndefined();
    expect(env.all_proxy).toBeUndefined();
  });

  it("代理变量大小写变体全部被剥离", async () => {
    const saved: Record<string, string | undefined> = {};
    const keys = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"];
    keys.forEach((k) => {
      saved[k] = process.env[k];
      process.env[k] = `http://proxy-${k}:7890`;
    });

    try {
      await runDreaminaCli(["text2video"], { timeoutMs: 5000 });
    } catch { /* 不关心结果 */ }

    const env = mockSpawn.mock.calls[0]?.[1]?.env as Record<string, string | undefined>;
    keys.forEach((k) => {
      expect(env[k]).toBeUndefined();
    });

    keys.forEach((k) => {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    });
  });

  it("非代理环境变量保留（如 PATH）", async () => {
    process.env.PATH = "/usr/bin:/bin";

    try {
      await runDreaminaCli(["text2video"], { timeoutMs: 5000 });
    } catch { /* 不关心结果 */ }

    const env = mockSpawn.mock.calls[0]?.[1]?.env as Record<string, string | undefined>;
    expect(env.PATH).toBeDefined();
    expect(env.PATH).toContain("/usr/bin");
  });

  // ── 网络超时重试（问题1） ──

  it("网络超时结果（resolve 但 code=-1 + stderr 含超时）自动重试 1 次后成功", async () => {
    let callCount = 0;
    mockSpawn.mockImplementation(() => {
      callCount++;
      if (callCount < 2) {
        // 模拟 Go 层 context deadline exceeded：exit=-1, stderr 含超时
        return makeFakeChild(-1, "", "context deadline exceeded");
      }
      return makeFakeChild(0, '{"submit_id":"u-retry","gen_status":"success"}', "");
    });

    const result = await runDreaminaCli(["text2video"], { timeoutMs: 5000 });
    expect(callCount).toBe(2);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("u-retry");
  });

  it("spawn 抛网络超时错误自动重试", async () => {
    let callCount = 0;
    mockSpawn.mockImplementation(() => {
      callCount++;
      const child = new EventEmitter() as ReturnType<typeof spawn>;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = vi.fn();
      if (callCount < 2) {
        // 首次抛错（模拟 spawn 错误 = 网络层面问题）
        setImmediate(() => child.emit("error", new Error("ECONNREFUSED")));
      } else {
        setImmediate(() => {
          child.stdout.push('{"ok":true}');
          child.stdout.push(null);
          child.stderr.push(null);
          child.emit("close", 0);
        });
      }
      return child;
    });

    const result = await runDreaminaCli(["text2video"], { timeoutMs: 5000 });
    expect(callCount).toBe(2);
    expect(result.code).toBe(0);
  });

  it("重试间指数退避（至少 500ms 间隔）", async () => {
    let callCount = 0;
    const timestamps: number[] = [];
    mockSpawn.mockImplementation(() => {
      callCount++;
      timestamps.push(Date.now());
      if (callCount < 2) {
        return makeFakeChild(-1, "", "context deadline exceeded");
      }
      return makeFakeChild(0, '{"submit_id":"ok"}', "");
    });

    await runDreaminaCli(["text2video"], { timeoutMs: 5000 });
    expect(callCount).toBe(2);
    // 指数退避: 500 * 2^0 = 500ms
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(450);
  });

  // ── 不重试的场景 ──

  it("业务错误（非会员被拒）不重试，直接返回结果", async () => {
    let callCount = 0;
    mockSpawn.mockImplementation(() => {
      callCount++;
      return makeFakeChild(1, "", "current account is not maestro vip");
    });

    await expect(runDreaminaCli(["text2video"], { timeoutMs: 5000 })).rejects.toThrow(/会员/);
    expect(callCount).toBe(1);
  });

  it("CLI 未安装时不重试，直接抛错", async () => {
    const original = resolveDreaminaBin;
    vi.mocked(resolveDreaminaBin).mockReturnValueOnce("");
    await expect(runDreaminaCli(["text2video"], { timeoutMs: 5000 })).rejects.toThrow(/未找到即梦 CLI/);
    vi.mocked(resolveDreaminaBin).mockImplementation(original);
  });

  it("CLI 超时（timer reject）默认重试 1 次", async () => {
    let callCount = 0;
    // spawn 正常，但 setTimeout 比 stderr 先到 → timer reject
    mockSpawn.mockImplementation(() => {
      callCount++;
      const child = new EventEmitter() as ReturnType<typeof spawn>;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = vi.fn();
      setImmediate(() => {
        // 在 timer 触发后（5ms）才关 child，模拟慢响应
        setTimeout(() => {
          child.stdout.push('{"submit_id":"ok"}');
          child.stdout.push(null);
          child.stderr.push(null);
          child.emit("close", 0);
        }, 200);
      });
      return child;
    });

    // 用极短 timeout 确保 timer 先触发
    await expect(runDreaminaCli(["text2video"], { timeoutMs: 10 })).rejects.toThrow(/超时/);
    expect(callCount).toBe(2); // 首次超时 + 1 次重试
  });

  it("maxRetries=0 时不重试", async () => {
    let callCount = 0;
    mockSpawn.mockImplementation(() => {
      callCount++;
      return makeFakeChild(-1, "", "context deadline exceeded");
    });

    const result = await runDreaminaCli(["text2video"], { timeoutMs: 2000, retries: 0 });
    expect(callCount).toBe(1);
    expect(result.code).toBe(-1);
    expect(result.stderr).toContain("deadline");
  });

  it("网络超时耗尽所有重试后返回最后一次结果", async () => {
    let callCount = 0;
    mockSpawn.mockImplementation(() => {
      callCount++;
      return makeFakeChild(-1, "", "ETIMEDOUT");
    });

    const result = await runDreaminaCli(["text2video"], { timeoutMs: 1000, retries: 1 });
    expect(callCount).toBe(2);
    expect(result.code).toBe(-1);
    expect(result.stderr).toContain("ETIMEDOUT");
  });
});
