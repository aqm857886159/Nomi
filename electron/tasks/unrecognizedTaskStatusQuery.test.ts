// 端到端接线回归：上游一直返回未登记动词 → 轮询先容忍、最终判失败并报出原始动词。
//
// 与 unrecognizedTaskStatus.test.ts（纯规则）互补：那份钉规则，这份钉**接线**——
// 真的 resolveTaskStatus + 真的 buildProfileTaskResult + 真的 taskCache/admitTask 跨轮询状态，
// 只把 HTTP 边界（executeProfileOperation）与模型解析换成桩。接线错了（比如 streak 没回写进
// 缓存）纯规则测试是发现不了的，而那正是这个修复最容易悄悄失效的地方。
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const executeProfileOperation = vi.fn();

vi.mock("../runtime", async () => {
  const actual = await vi.importActual<typeof import("../runtime")>("../runtime");
  return {
    ...actual,
    // 只换掉真打 HTTP 的那一步与要读 catalog 的模型解析；归一/缓存/受理全用真的。
    executeProfileOperation: (...args: unknown[]) => executeProfileOperation(...args),
    findExecutableModel: () => ({
      vendor: { key: "acme", baseUrlHint: "https://acme.test" },
      model: { modelKey: "acme-video", kind: "video" },
      apiKey: "k",
    }),
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

/** 上游每次都回同一个未登记动词。 */
function respondWith(status: string) {
  executeProfileOperation.mockResolvedValue({ response: { status }, request: {} });
}

describe("未登记动词的端到端轮询行为", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    executeProfileOperation.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("上游一直回 failure：先当排队继续轮询，够久之后判失败并报出 \"failure\"", async () => {
    const { fetchTaskResult } = await import("./taskResultQuery");
    vi.setSystemTime(new Date("2026-08-11T00:00:00Z"));
    await seedPendingTask("task-failure");
    respondWith("failure");

    // 前几轮：不误杀，仍是非终态（这正是「容忍未登记的进行中动词」要保住的行为）。
    const first = await fetchTaskResult({ taskId: "task-failure" });
    expect(first.result.status).toBe("queued");

    // 推进到超过 4 次 + 120s 宽限。**到终态即停**（真实轮询循环就是这么做的；继续查会命中
    // 终态时已 delete 的缓存，拿到的是「追踪已丢失」而非本次判定结果）。
    let last = first;
    let polls = 0;
    for (let i = 1; i <= 8 && last.result.status !== "failed"; i += 1) {
      vi.setSystemTime(new Date(Date.parse("2026-08-11T00:00:00Z") + i * 40_000));
      last = await fetchTaskResult({ taskId: "task-failure" });
      polls = i;
    }
    // 判死不能来得太早：至少熬过宽限期（这里 4 轮 × 40s = 160s > 120s）。
    expect(polls).toBeGreaterThanOrEqual(3);

    // 病根回归：这里过去永远是 queued —— 任务在用户眼里就是永远转圈。
    expect(last.result.status).toBe("failed");
    // 错误信息必须如实带上上游原话，用户能拿去平台核对，我们能据此补进 statusMapping。
    expect(last.result.error).toContain("failure");
  });

  it("认得的动词照常走，不受影响（processing 一直是 running，不会被判死）", async () => {
    const { fetchTaskResult } = await import("./taskResultQuery");
    vi.setSystemTime(new Date("2026-08-11T01:00:00Z"));
    await seedPendingTask("task-running");
    respondWith("processing");

    let last = await fetchTaskResult({ taskId: "task-running" });
    for (let i = 1; i <= 6; i += 1) {
      vi.setSystemTime(new Date(Date.parse("2026-08-11T01:00:00Z") + i * 60_000));
      last = await fetchTaskResult({ taskId: "task-running" });
    }
    expect(last.result.status).toBe("running");
    expect(last.result.error).toBeUndefined();
  });

  it("未知动词中途变回认得的动词 → 连击清零，不再判死", async () => {
    const { fetchTaskResult } = await import("./taskResultQuery");
    const base = Date.parse("2026-08-11T02:00:00Z");
    vi.setSystemTime(new Date(base));
    await seedPendingTask("task-recovers");

    // 未登记但其实表示「进行中」的动词，熬到快判死之前（3 轮 / 80s，两条件都还没同时满足）。
    respondWith("cooking");
    for (let i = 0; i <= 2; i += 1) {
      vi.setSystemTime(new Date(base + i * 40_000));
      expect((await fetchTaskResult({ taskId: "task-recovers" })).result.status).toBe("queued");
    }
    respondWith("processing"); // 认得 → 清零
    vi.setSystemTime(new Date(base + 3 * 40_000));
    expect((await fetchTaskResult({ taskId: "task-recovers" })).result.status).toBe("running");

    // 清零后再来未知动词：时钟从这里重新起算，故即便总时长早已超过宽限期也不该立刻判死。
    respondWith("cooking");
    for (let i = 4; i <= 6; i += 1) {
      vi.setSystemTime(new Date(base + i * 40_000));
      expect((await fetchTaskResult({ taskId: "task-recovers" })).result.status).toBe("queued");
    }
  });

  it("完成状态后执行独立 result operation，并且只物化 result 返回的资产", async () => {
    const { admitTask, taskCache } = await import("../runtime");
    const { fetchTaskResult } = await import("./taskResultQuery");
    const taskId = "task-three-stage";
    taskCache.delete(taskId);
    admitTask(taskId, {
      vendor: "acme",
      request: { kind: "text_to_video", prompt: "a cat", extras: { modelKey: "acme-video" } },
      raw: {},
      mapping: {
        ...VIDEO_MAPPING,
        result: {
          method: "GET",
          path: "/v1/video/{{providerMeta.task_id}}",
          response_mapping: { video_url: "video.url" },
        },
      } as never,
      model: { modelKey: "acme-video", kind: "video" } as never,
      providerMeta: { task_id: taskId, query_id: taskId },
      wantedKind: "video",
    });
    executeProfileOperation
      .mockResolvedValueOnce({ response: { status: "COMPLETED" }, request: {} })
      .mockResolvedValueOnce({ response: { video: { url: "https://cdn.test/out.mp4" } }, request: {} });

    const terminal = await fetchTaskResult({ taskId });

    expect(terminal.result).toMatchObject({
      status: "succeeded",
      assets: [{ type: "video", url: "https://cdn.test/out.mp4" }],
    });
    expect(executeProfileOperation.mock.calls.map(([input]) => input.stage)).toEqual(["query", "result"]);
    expect(taskCache.get(taskId)).toBeUndefined();
  });
});
