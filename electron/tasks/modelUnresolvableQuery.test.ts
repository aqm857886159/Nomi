// 端到端接线回归：轮询进行中模型被下架/凭证失效（findExecutableModel 抛错）必须落
// 诚实失败终态——裸抛会被渲染层当可恢复轮询错误空转 45s 后落「可找回」，错误既不
// 指向根因也不会自愈（模型不可执行是永久条件）。与 unrecognizedTaskStatusQuery.test.ts
// 同源同风格：只桩 HTTP 边界与模型解析，归一/缓存/受理全用真的。
import { beforeEach, describe, expect, it, vi } from "vitest";

const executeProfileOperation = vi.fn();
const findExecutableModel = vi.hoisted(() =>
  vi.fn((_vendorKey: string, _modelKey: string, _kind?: string) => ({
    vendor: { key: "acme", baseUrlHint: "https://acme.test" },
    model: { modelKey: "acme-video", kind: "video" },
    apiKey: "k",
  })),
);

vi.mock("../runtime", async () => {
  const actual = await vi.importActual<typeof import("../runtime")>("../runtime");
  return {
    ...actual,
    executeProfileOperation: (...args: unknown[]) => executeProfileOperation(...args),
    findExecutableModel: (vendorKey: string, modelKey: string, kind?: string) => findExecutableModel(vendorKey, modelKey, kind),
  };
});

const VIDEO_MAPPING = {
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
    mapping: VIDEO_MAPPING as never,
    model: { modelKey: "acme-video", kind: "video" } as never,
    providerMeta: { task_id: taskId, query_id: taskId },
    wantedKind: "video",
  });
}

describe("轮询中模型不可执行 → 诚实失败", () => {
  beforeEach(() => {
    executeProfileOperation.mockReset();
    findExecutableModel.mockReset();
    findExecutableModel.mockImplementation((_vendorKey: string, _modelKey: string, _kind?: string) => ({
      vendor: { key: "acme", baseUrlHint: "https://acme.test" },
      model: { modelKey: "acme-video", kind: "video" },
      apiKey: "k",
    }));
  });

  it("findExecutableModel 抛错 → failed 终态 + 指向根因的文案，不裸抛成可恢复轮询", async () => {
    const { fetchTaskResult } = await import("./taskResultQuery");
    await seedPendingTask("task-model-gone");
    findExecutableModel.mockImplementation(() => {
      throw new Error("model acme-video is not executable");
    });

    const polled = await fetchTaskResult({ taskId: "task-model-gone" });

    // 修复前：这里 reject（裸 Error 冒泡），渲染层当可恢复错误空转 45s 后落「可找回」。
    expect(polled.result.status).toBe("failed");
    expect(polled.result.error).toContain("模型当前不可执行");
    expect(executeProfileOperation).not.toHaveBeenCalled();
  });
});
