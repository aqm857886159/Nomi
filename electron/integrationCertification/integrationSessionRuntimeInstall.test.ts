import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const runTaskSpy = vi.fn(async (payload: unknown) => ({ payload, status: "succeeded" }));
const fetchTaskResultSpy = vi.fn(async (payload: unknown) => ({ result: { payload, status: "succeeded" } }));
const mintSpendGrantSpy = vi.fn((options: unknown) => `grant-${JSON.stringify(options)}`);

vi.mock("../runtime", () => ({
  runTask: (payload: unknown) => runTaskSpy(payload),
  fetchTaskResult: (payload: unknown) => fetchTaskResultSpy(payload),
}));
vi.mock("../spendGrant", () => ({
  mintSpendGrant: (options: unknown) => mintSpendGrantSpy(options),
}));

/**
 * BUG-2 的回归闸（2026-09-11 真机矩阵 §BUG-2 / docs/fixes/2026-09-11-comfyui-certification-wiring.root-cause.json）。
 *
 * 曾经的形状：`registerIntegrationSessionIpc()` 不传 service → `getIntegrationSessionService()`
 * 零参构造 → `runTask`/`fetchTaskResult`/`mintSpendGrant` 全是 undefined，而 `certifyComfy`
 * 照样挂上去。于是「有没有这个能力」的检查全过，真调用才在闭包第一行炸，还被 catch 洗成
 * `blockingReason.code = "certification_unavailable"`，界面一个字都不说。
 *
 * 不变量归属层：**运行时依赖必须在注册处的构造期强制提供**。这里守三件事——
 * 装配处交出的那三样确实接到真实运行时；没装过就立刻炸而不是发一个残废服务；
 * 以及**每个会用到它的主进程入口都装了**（这一条是写本修复时自己先踩到的：
 * 只装 GUI 那一处，等于把 stdio 与 CLI host 两个进程的整条接入链换成硬抛）。
 */
const repoRoot = path.resolve(__dirname, "../..");
const PROCESS_ENTRY_POINTS = [
  "electron/main.ts",
  "electron/capabilityCore/mcpStdioServer.ts",
  "electron/capabilityCore/host.ts",
];

describe("integration session runtime install", () => {
  afterEach(() => {
    runTaskSpy.mockClear();
    fetchTaskResultSpy.mockClear();
    mintSpendGrantSpy.mockClear();
  });

  it("hands the certification service the real runTask / fetchTaskResult / mintSpendGrant", async () => {
    const { integrationSessionRuntimeDependencies } = await import("./integrationSessionRuntimeInstall");
    const deps = integrationSessionRuntimeDependencies();

    await deps.runTask({ vendor: "comfyui-local", request: { kind: "text_to_image" } } as never);
    await deps.fetchTaskResult({
      taskId: "prompt-1",
      vendor: "comfyui-local",
      taskKind: "text_to_image",
      prompt: "",
      modelKey: "comfyui-txt2img",
    } as never);
    const grantId = deps.mintSpendGrant(["integration-node"], 1);

    expect(runTaskSpy).toHaveBeenCalledTimes(1);
    expect(fetchTaskResultSpy).toHaveBeenCalledTimes(1);
    expect(mintSpendGrantSpy).toHaveBeenCalledWith({ nodeIds: ["integration-node"], maxAttemptsPerNode: 1 });
    expect(grantId).toContain("grant-");
  });

  it("refuses to hand out a service that was never installed with its runtime dependencies", async () => {
    vi.resetModules();
    const fresh = await import("./integrationSession");

    expect(() => fresh.getIntegrationSessionService()).toThrow(/integration_session_service_not_installed/);
  });

  it.each(PROCESS_ENTRY_POINTS)("installs the service in the %s process entry point", (entry) => {
    // 取用口现在没装就抛，所以「哪个进程忘了装」= 那个进程整条接模型链不可用。
    // 三个入口各跑各的 bootstrap，没有共同的启动函数可以挂，只能由这条结构断言守住。
    const source = fs.readFileSync(path.join(repoRoot, entry), "utf8");

    expect(source).toContain("installIntegrationSessionRuntime()");
  });

  it("requires every certification dependency at construction time (compiler-enforced)", async () => {
    const { createRuntimeIntegrationSessionService } = await import("./integrationSession");
    const { registerIntegrationSessionIpc } = await import("./integrationSessionIpc");
    // 这一格靠 `check:test-types` 判分：下面每行都必须**编译期**红，缺依赖不许推迟到
    // certifyComfy 真被调用时才炸。ts-expect-error 没红 = 门岗自己红，等于这条闸失效被抓到。
    const compileOnly = () => {
      // @ts-expect-error 零参构造：三样运行时依赖缺一不可。
      createRuntimeIntegrationSessionService();
      // @ts-expect-error 只给一部分同理。
      createRuntimeIntegrationSessionService({ filePath: "x" });
      // @ts-expect-error 注册处不许再自己兜底解析单例：service 是必填参数。
      registerIntegrationSessionIpc();
    };

    expect(compileOnly).toBeTypeOf("function");
  });
});
