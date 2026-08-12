// 端到端接线回归：**没有 query op** 的任务（同步模型 / 无 mapping 的 fallback 提交）一旦被受理进
// 轮询，必须立刻拿到诚实的终态失败，而不是每轮都回 queued 让渲染层空转到硬超时。
//
// 与 unrecognizedTaskStatusQuery.test.ts 同源同风格（那份钉「未登记动词」，这份钉「无 query op」——
// 同一个病根「兜底语义默认乐观」的两条路径）：只把 HTTP 边界（executeProfileOperation）换成桩，
// 归一/缓存/受理全用真的。接线错了（比如判定写在渲染层、或缓存没清）纯规则测试发现不了。
import { beforeEach, describe, expect, it, vi } from "vitest";

const executeProfileOperation = vi.fn();

vi.mock("../runtime", async () => {
  const actual = await vi.importActual<typeof import("../runtime")>("../runtime");
  return {
    ...actual,
    // 唯一的桩：真打 HTTP 的那一步。本文件的用例**都不该碰到它**（没有 query 可发），
    // 故它同时也是断言对象：被调用 = 接线错了。
    executeProfileOperation: (...args: unknown[]) => executeProfileOperation(...args),
  };
});

// 第二个（也是唯一另一个）边界桩：catalog 的磁盘读。真 readCatalog() 首次调用会**落盘**
// （落 electron 桩给的按进程临时 userData 目录 —— 从前桩的 getPath() 返回 ""，那会写进
// 仓库根目录，见 settings/settingsRoot.test.ts 钉的绝对路径不变量）。桩掉是为了不让本
// 用例依赖磁盘状态：这里只有「create 已带产物」那条分支会读它（取 vendor 提示给 SSRF
// 白名单），返回空 vendors 即可。
vi.mock("../catalog/catalogStore", async () => {
  const actual = await vi.importActual<typeof import("../catalog/catalogStore")>("../catalog/catalogStore");
  return { ...actual, readCatalog: () => ({ vendors: [], models: [], mappings: [] }) };
});

/** 同步图像 mapping：只有 create，没有 query（与 newapiTransport.newapiTransportFor("image") 同形）。 */
const SYNC_IMAGE_MAPPING = {
  name: "relay image",
  enabled: true,
  create: { method: "POST", path: "/v1/images/generations", response_mapping: { image_url: "data[*].url" } },
};

/**
 * 受理一个「已经在轮询中」的任务。raw = create 当时的响应；mapping 省略即模拟 runtime.ts:505
 * 那条无 mapping 的 fallback 受理。
 */
async function seedPendingTask(taskId: string, raw: unknown, mapping?: unknown) {
  const { admitTask, taskCache } = await import("../runtime");
  taskCache.delete(taskId);
  admitTask(taskId, {
    vendor: "relay",
    request: { kind: "text_to_image", prompt: "a cat", extras: { modelKey: "relay-image" } },
    raw,
    ...(mapping ? { mapping: mapping as never } : {}),
    model: { modelKey: "relay-image", kind: "image" } as never,
    wantedKind: "image",
  });
}

describe("无 query op 的任务：轮询立刻拿到诚实终态，不再永远转圈", () => {
  beforeEach(() => {
    executeProfileOperation.mockReset();
  });

  it("同步模型 create 没出图 → 第一次轮询就 failed，并说清「没有查询接口」", async () => {
    const { fetchTaskResult } = await import("./taskResultQuery");
    // 中转对 /v1/images/generations 回了 200 但 data 是空的：无产物、无状态动词、无 error 字段
    // → resolveTaskStatus 归成 queued 且 unrecognizedStatus 为空（未登记动词那条修复**够不着**这里）。
    await seedPendingTask("task-sync-empty", { created: 1, data: [] }, SYNC_IMAGE_MAPPING);

    const polled = await fetchTaskResult({ taskId: "task-sync-empty" });

    // 病根回归：这里过去恒为 queued —— 用户看到的就是转圈转到 2min 硬超时。
    expect(polled.result.status).toBe("failed");
    expect(polled.result.error).toContain("查询结果");
    // 没有 query 可发，就不该打任何上游请求。
    expect(executeProfileOperation).not.toHaveBeenCalled();
  });

  it("上游把真因写在 create 响应里（中转常见）→ 原话带到用户眼前，不再被丢掉", async () => {
    const { fetchTaskResult } = await import("./taskResultQuery");
    await seedPendingTask("task-sync-reason", { message: "no available channel" }, SYNC_IMAGE_MAPPING);

    const polled = await fetchTaskResult({ taskId: "task-sync-reason" });

    expect(polled.result.status).toBe("failed");
    expect(polled.result.error).toContain("no available channel");
  });

  it("无 mapping 的 fallback 受理（runtime.ts:505）同样终态——它注定永远查不出结果", async () => {
    const { fetchTaskResult } = await import("./taskResultQuery");
    // fallback 正是在 extractAssetUrl 为空时才受理的，故轮询再算一次必然还是空。
    await seedPendingTask("task-fallback", { id: "up-1", state: "??" });

    const polled = await fetchTaskResult({ taskId: "task-fallback" });

    expect(polled.result.status).toBe("failed");
    expect(executeProfileOperation).not.toHaveBeenCalled();
  });

  it("终态即清缓存：再查一次是「追踪已丢失」，绝不会退回 queued 继续转圈", async () => {
    const { fetchTaskResult } = await import("./taskResultQuery");
    await seedPendingTask("task-sync-once", { created: 1, data: [] }, SYNC_IMAGE_MAPPING);

    expect((await fetchTaskResult({ taskId: "task-sync-once" })).result.status).toBe("failed");
    // 关键不是这句文案，而是**没有任何一条路径**能让它再变回非终态。
    const again = await fetchTaskResult({ taskId: "task-sync-once" });
    expect(again.result.status).toBe("failed");
  });

  it("非回归：create 已带产物的同步模型照旧成功（这条分支不能被上面的判定误杀）", async () => {
    const { fetchTaskResult } = await import("./taskResultQuery");
    // 不给 projectId → 走 unlocalizedTaskAsset，不碰磁盘本地化。
    await seedPendingTask(
      "task-sync-asset",
      { data: [{ url: "https://cdn.example.com/out.png" }] },
      SYNC_IMAGE_MAPPING,
    );

    const polled = await fetchTaskResult({ taskId: "task-sync-asset" });

    expect(polled.result.status).toBe("succeeded");
    expect(polled.result.assets).toHaveLength(1);
    expect(polled.result.assets[0].url).toBe("https://cdn.example.com/out.png");
  });
});
