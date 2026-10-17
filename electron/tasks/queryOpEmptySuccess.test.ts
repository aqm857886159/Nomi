// 端到端接线回归：mapping 只有 query op、没有 result op 的 vendor（kie/apimart 一族），
// query 回「completed 但零产物」时必须落失败终态——不能持久化 succeeded + 0 assets 的静默空成功。
//
// ensureAsyncMediaOutput 守卫过去只挂在 result-op 二跳分支上，query-op-only 的返回路径够不着
// （这正是本回归钉的洞）。与 unrecognizedTaskStatusQuery.test.ts 同源同风格：只桩 HTTP 边界
// （executeProfileOperation）与模型解析，归一/缓存/受理全用真的。
import { beforeEach, describe, expect, it, vi } from "vitest";

const executeProfileOperation = vi.fn();

vi.mock("../runtime", async () => {
  const actual = await vi.importActual<typeof import("../runtime")>("../runtime");
  return {
    ...actual,
    executeProfileOperation: (...args: unknown[]) => executeProfileOperation(...args),
    findExecutableModel: () => ({
      vendor: { key: "acme", baseUrlHint: "https://acme.test" },
      model: { modelKey: "acme-video", kind: "video" },
      apiKey: "k",
    }),
  };
});

// 有 query、**没有 result** —— 与 electron/catalog/kieImages2026.ts / apimartVendor.ts 的
// mapping 同形（result 资产直接在 query 响应里给，没有独立 result 端点）。
const QUERY_ONLY_MAPPING = {
  name: "acme video",
  enabled: true,
  create: { method: "POST", path: "/v1/video" },
  query: { method: "GET", path: "/v1/video/{{query_id}}", response_mapping: { status: "status" } },
};

async function seedPendingTask(taskId: string) {
  const { admitTask, taskCache } = await import("../runtime");
  taskCache.delete(taskId);
  admitTask(taskId, {
    vendor: "acme",
    request: { kind: "text_to_video", prompt: "a cat", extras: { modelKey: "acme-video" } },
    raw: {},
    mapping: QUERY_ONLY_MAPPING as never,
    model: { modelKey: "acme-video", kind: "video" } as never,
    providerMeta: { task_id: taskId, query_id: taskId },
    wantedKind: "video",
  });
}

describe("query-op-only vendor：COMPLETED 但零产物——不判失败、不落空成功，落「可找回」（#1213 原则 1）", () => {
  beforeEach(() => {
    executeProfileOperation.mockReset();
  });

  it("query 回 completed 无产物 → 抛 retrieval-parse（带上游原话），任务留在缓存里，下一次查到地址就成", async () => {
    const { fetchTaskResult } = await import("./taskResultQuery");
    const { taskCache } = await import("../runtime");
    await seedPendingTask("task-query-empty");
    executeProfileOperation.mockResolvedValue({ response: { status: "completed" }, request: {} });

    // 上游说成了：绝不判 failed，也不持久化 succeeded+0 assets——带阶段码抛出，渲染层落「可找回」。
    await expect(fetchTaskResult({ taskId: "task-query-empty" })).rejects.toThrow(/NOMI_ERR::retrieval-parse::[\s\S]*completed/);
    expect(taskCache.get("task-query-empty")).toBeTruthy();

    // 有的中转先报成功、后补地址：下一次查（或「重新取回」）拿到地址就正常落地。
    executeProfileOperation.mockResolvedValue({ response: { status: "completed", video_url: "https://cdn.example.com/late.mp4" }, request: {} });
    const late = await fetchTaskResult({ taskId: "task-query-empty" });
    expect(late.result.status).toBe("succeeded");
    expect(late.result.assets).toHaveLength(1);
  });

  it("非回归：query 回 completed 且带产物 → 照旧 succeeded（守卫不许误杀正常路径）", async () => {
    const { fetchTaskResult } = await import("./taskResultQuery");
    await seedPendingTask("task-query-asset");
    // 不给 projectId → 走 unlocalizedTaskAsset，不碰磁盘本地化。
    executeProfileOperation.mockResolvedValue({
      response: { status: "completed", video_url: "https://cdn.example.com/out.mp4" },
      request: {},
    });

    const polled = await fetchTaskResult({ taskId: "task-query-asset" });

    expect(polled.result.status).toBe("succeeded");
    expect(polled.result.assets).toHaveLength(1);
  });
});
