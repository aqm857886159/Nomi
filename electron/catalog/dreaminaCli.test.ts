// buildDreaminaEnv 回归：即梦是国内服务，子进程必须强制直连——抹掉一切出站代理变量 + NO_PROXY=*。
// 防的是「有人日后清理 spawn env 时，把 ...process.env 原样透传回去」这种静默复发（青阳的梯子 bug 根因）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { buildDreaminaEnv, runDreaminaCli } from "./dreaminaCli";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

type FakeChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};

const mockSpawn = vi.mocked(spawn);
let envSnapshot: NodeJS.ProcessEnv;

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, snapshot);
}

function makeFakeChild(code: number, stdout = "", stderr = ""): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  setImmediate(() => {
    if (stdout) child.stdout.write(stdout);
    if (stderr) child.stderr.write(stderr);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", code);
  });
  return child;
}

function makeErrorChild(error: Error): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  setImmediate(() => child.emit("error", error));
  return child;
}

beforeEach(() => {
  envSnapshot = { ...process.env };
  mockSpawn.mockReset();
  mockSpawn.mockImplementation(() => makeFakeChild(0, '{"submit_id":"u-1","gen_status":"querying"}', "") as never);
});

afterEach(() => {
  restoreEnv(envSnapshot);
  vi.useRealTimers();
});

describe("dreamina 子进程强制直连（buildDreaminaEnv）", () => {
  const proxied: NodeJS.ProcessEnv = {
    HTTP_PROXY: "http://127.0.0.1:7897",
    http_proxy: "http://127.0.0.1:7897",
    HTTPS_PROXY: "http://127.0.0.1:7897",
    https_proxy: "http://127.0.0.1:7897",
    ALL_PROXY: "socks5://127.0.0.1:7897",
    all_proxy: "socks5://127.0.0.1:7897",
    NO_PROXY: "localhost,127.0.0.1",
    PATH: "/usr/bin:/bin",
    HOME: "/Users/tester",
  };

  it("六个出站代理变量（大小写）全被抹掉", () => {
    const env = buildDreaminaEnv(proxied);
    for (const key of ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]) {
      expect(env[key], `${key} 应被删除`).toBeUndefined();
    }
  });

  it("NO_PROXY / no_proxy 被强制成 *（兜底：代理若从别处冒出来也绕开即梦）", () => {
    const env = buildDreaminaEnv(proxied);
    expect(env.NO_PROXY).toBe("*");
    expect(env.no_proxy).toBe("*");
  });

  it("无关变量保留；原 PATH 并入且补上 ~/.local/bin 兜底目录", () => {
    const env = buildDreaminaEnv(proxied);
    expect(env.HOME).toBe("/Users/tester");        // 无关变量不动
    expect(env.PATH).toContain("/usr/bin");         // 原 PATH 保留
    expect(env.PATH?.replaceAll("\\", "/")).toContain(".local/bin"); // GUI Electron 极简 PATH 的兜底
  });

  it("不改传入对象（返回新 env，不污染 process.env）", () => {
    const snapshot = { ...proxied };
    buildDreaminaEnv(proxied);
    expect(proxied).toEqual(snapshot);
  });
});

describe("runDreaminaCli", () => {
  it("spawn 时继续使用强制直连 env", async () => {
    process.env.HTTP_PROXY = "http://127.0.0.1:7897";
    process.env.HTTPS_PROXY = "http://127.0.0.1:7897";
    process.env.ALL_PROXY = "socks5://127.0.0.1:7897";

    await runDreaminaCli(["user_credit"], { bin: "/tmp/dreamina", timeoutMs: 1000, retries: 0 });

    const options = mockSpawn.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv } | undefined;
    expect(options?.env?.HTTP_PROXY).toBeUndefined();
    expect(options?.env?.HTTPS_PROXY).toBeUndefined();
    expect(options?.env?.ALL_PROXY).toBeUndefined();
    expect(options?.env?.NO_PROXY).toBe("*");
    expect(options?.env?.PATH?.replaceAll("\\", "/")).toContain(".local/bin");
  });

  it("网络超时结果自动重试一次后返回成功结果", async () => {
    let callCount = 0;
    mockSpawn.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) return makeFakeChild(-1, "", "context deadline exceeded") as never;
      return makeFakeChild(0, '{"submit_id":"u-retry","gen_status":"success"}', "") as never;
    });

    const result = await runDreaminaCli(["text2video"], {
      bin: "/tmp/dreamina",
      timeoutMs: 1000,
      retryDelayMs: 1,
    });

    expect(callCount).toBe(2);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("u-retry");
  });

  it("retries=0 时网络超时结果不重试", async () => {
    mockSpawn.mockImplementation(() => makeFakeChild(-1, "", "ETIMEDOUT") as never);

    const result = await runDreaminaCli(["text2video"], {
      bin: "/tmp/dreamina",
      timeoutMs: 1000,
      retries: 0,
    });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ code: -1, stderr: "ETIMEDOUT" });
  });

  it("业务错误不重试，交给上层错误翻译", async () => {
    mockSpawn.mockImplementation(() => makeFakeChild(1, "", "current account is not maestro vip") as never);

    const result = await runDreaminaCli(["text2video"], {
      bin: "/tmp/dreamina",
      timeoutMs: 1000,
      retryDelayMs: 1,
    });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/maestro vip/);
  });

  it("spawn 抛出的网络超时错误会重试", async () => {
    let callCount = 0;
    mockSpawn.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) return makeErrorChild(new Error("fetch failed: ETIMEDOUT")) as never;
      return makeFakeChild(0, '{"submit_id":"ok"}', "") as never;
    });

    const result = await runDreaminaCli(["text2video"], {
      bin: "/tmp/dreamina",
      timeoutMs: 1000,
      retryDelayMs: 1,
    });

    expect(callCount).toBe(2);
    expect(result.stdout).toContain("ok");
  });
});
