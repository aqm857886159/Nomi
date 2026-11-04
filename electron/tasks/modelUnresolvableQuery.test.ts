// 端到端接线回归：轮询进行中模型被关 / 凭证没了（findExecutableModel 抛错）：这一次根本没问过供应商，开回来就能查。
// 结果带判别码，有 Run 的查询方和 AI 读任务据此不把它当结论；没有 Run 的旧路径照旧读 failed 和指向根因的那句话。
// 与 unrecognizedTaskStatusQuery.test.ts 同源同风格：只桩 HTTP 边界与模型解析，归一/缓存/受理全用真的。
import { beforeEach, describe, expect, it, vi } from "vitest";

import { admitTask, taskCache } from "../runtime";
import { isLocalQueryBlockedRaw } from "./taskAdmission";
import { fetchTaskResult } from "./taskResultQuery";

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

describe("轮询中模型不可执行 → 本机查不了", () => {
  beforeEach(() => {
    executeProfileOperation.mockReset();
    findExecutableModel.mockReset();
    findExecutableModel.mockImplementation((_vendorKey: string, _modelKey: string, _kind?: string) => ({
      vendor: { key: "acme", baseUrlHint: "https://acme.test" },
      model: { modelKey: "acme-video", kind: "video" },
      apiKey: "k",
    }));
  });

  it("findExecutableModel 抛错 → 带判别码 + 指向根因的文案，没问供应商，不裸抛", async () => {
    await seedPendingTask("task-model-gone");
    findExecutableModel.mockImplementation(() => {
      throw new Error("model acme-video is not executable");
    });

    const polled = await fetchTaskResult({ taskId: "task-model-gone" });

    expect(polled.result.status).toBe("failed");
    expect(polled.result.error).toContain("模型当前不可执行");
    expect(polled.result.raw).toEqual({ code: "model_unresolvable", taskId: "task-model-gone" });
    expect(isLocalQueryBlockedRaw(polled.result.raw)).toBe(true);
    expect(executeProfileOperation).not.toHaveBeenCalled();
  });
});
