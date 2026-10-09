/**
 * `nomi_read target=task`：按任务号只读地查一个已提交的异步任务。
 *
 * 真路径：真 `dispatch('task.read')` → 真 `readTask` → 真 `runtime.fetchTaskResult` → loopback 假异步供应商。
 * 任务由真 `tryModel` 提交（等不到终态 → still_processing → 拿到任务号），与 AI 的真实用法一致。
 * 全程数「供应商收到几次提交」：读任务绝不能让它再增加。
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ipcMain: { on: () => undefined, handle: () => undefined, removeHandler: () => undefined },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`enc:${value}`, "utf8"),
      decryptString: (buffer: Buffer) => buffer.toString("utf8").replace(/^enc:/, ""),
    },
  };
});

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

type Read = {
  taskId: string; state: string; message: string; nextAction: string;
  assets?: Array<{ type: string; url: string }>; providerMessage?: string;
};

describe("nomi_read target=task", () => {
  let server: http.Server;
  let origin: string;
  let root: string;
  let vendorKey = "";
  let submits = 0;
  let getCount = 0;
  let jobCounter = 0;
  /** 假供应商里每个 job 现在的样子；测试直接改它来推进「供应商那边的进度」。 */
  const jobs = new Map<string, Record<string, unknown>>();
  const ctx = { origin: { host: "claude" } } as never;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-read-task-"));
    server = http.createServer((request, response) => {
      const url = String(request.url);
      if (url === "/art.png") {
        response.writeHead(200, { "content-type": "image/png" });
        response.end(PNG);
        return;
      }
      if (request.method === "POST" && url === "/v1/jobs") {
        request.on("data", () => undefined);
        request.on("end", () => {
          submits += 1;
          const id = `job-${++jobCounter}`;
          jobs.set(id, { id, status: "queued" });
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ id, status: "queued" }));
        });
        return;
      }
      const match = /^\/jobs\/([\w-]+)$/.exec(url);
      if (request.method === "GET" && match) {
        getCount += 1;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(jobs.get(match[1]!) ?? { id: match[1], status: "queued" }));
        return;
      }
      response.writeHead(404).end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;


  });

  beforeEach(async () => {
    vi.stubEnv("NOMI_SETTINGS_DIR", root);
    const { dispatch } = await import("./dispatcher");
    const docs = "https://docs.example-readtask.com/api";
    const submitted = await dispatch("model.onboarding.setup", {
      action: "submit_declaration",
      name: "Example ReadTask",
      declaration: JSON.stringify({
        provider: { baseUrl: origin, authType: "bearer", authHeader: "Authorization", authScheme: "Relay" },
        sources: [{ url: docs, evidence: "POST /v1/jobs returns id+status; GET /jobs/{id}" }],
        assetIngestion: { strategy: "none", sourceUrl: docs },
        models: [{
          modelKey: "readtask-paint",
          labelZh: "ReadTask Paint",
          kind: "image",
          modes: [{
            taskKind: "text_to_image",
            delivery: "asynchronous",
            create: {
              method: "POST", path: "/v1/jobs", body: { prompt: "{{request.prompt}}" },
              response_mapping: { task_id: "id", status: "status" },
              provider_meta_mapping: { task_id: "id" },
            },
            query: {
              method: "GET", path: "/jobs/{{providerMeta.task_id}}",
              response_mapping: { task_id: "id", status: "status", image_url: "image.url", error_message: "detail" },
            },
            statusMapping: { succeeded: ["completed"], running: ["in_progress"], failed: ["failed"] },
            sourceUrls: [docs],
          }],
        }],
      }),
    }, ctx) as { ok: boolean; vendorKey: string };
    expect(submitted.ok, JSON.stringify(submitted)).toBe(true);
    vendorKey = submitted.vendorKey;
    const keyed = await dispatch("model.onboarding.setup", { action: "set_key", vendorKey, apiKey: "relay-test-key" }, ctx) as { ok: boolean };
    expect(keyed.ok).toBe(true);
  });

  afterAll(async () => {
    vi.stubEnv("NOMI_SETTINGS_DIR", undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** 真 tryModel 提交一单，等不到终态 → 返回任务号。 */
  async function submitPending(): Promise<string> {
    const { tryModel } = await import("./modelOnboarding/tryModel");
    const { runTask, fetchTaskResult } = await import("../runtime");
    const tried = await tryModel({
      runTask, fetchTaskResult, pollIntervalMs: 10, pollTimeoutMs: 200,
      approvalPolicy: () => ({ mode: "project", spend: "confirm" }),
    }, { vendorKey, modelKey: "readtask-paint", prompt: "apple" }) as { code?: string; taskId?: string; nextAction?: string };
    expect(tried.code).toBe("still_processing");
    expect(tried.nextAction).toContain(`nomi_read target=task taskId=${tried.taskId}`);
    expect(tried.nextAction).not.toMatch(/console/i);
    return tried.taskId!;
  }

  async function readTaskId(taskId: string): Promise<Read> {
    const { dispatch } = await import("./dispatcher");
    const { fetchTaskResult } = await import("../runtime");
    return dispatch("task.read", { taskId }, { origin: { host: "claude" }, fetchTaskResult } as never) as Promise<Read>;
  }

  it("nomi_read 的 task 目标在目录里：target=task 解析到 task.read，taskId 原样递下去", async () => {
    const { MCP_TOOL_CATALOG, READ_TARGETS } = await import("./mcpToolCatalog");
    expect(READ_TARGETS).toContain("task");
    const read = MCP_TOOL_CATALOG.find((tool) => tool.name === "nomi_read")! as unknown as {
      resolveMethod: (a: unknown) => string; build: (a: unknown) => unknown; annotations: { readOnlyHint: boolean };
    };
    expect(read.resolveMethod({ target: "task" })).toBe("task.read");
    expect(read.build({ target: "task", taskId: "job-9" })).toEqual({ taskId: "job-9" });
    expect(read.annotations.readOnlyHint).toBe(true);
  });

  it("没传 taskId：明确要求任务号（400），不去查", async () => {
    const { dispatch } = await import("./dispatcher");
    await expect(dispatch("task.read", {}, ctx)).rejects.toMatchObject({ httpStatus: 400 });
  });

  it("查询中：排队 / 处理中如实说，说明已收费、不是失败，且没有重新提交", async () => {
    const id = await submitPending();
    submits = 0;
    const queued = await readTaskId(id);
    expect(queued.state).toBe("queued");
    expect(queued.message).toMatch(/not a failure/i);
    expect(queued.nextAction).toMatch(/do not call nomi_try_model again/i);
    jobs.set(id, { id, status: "in_progress" });
    const running = await readTaskId(id);
    expect(running.state).toBe("processing");
    expect(submits).toBe(0);
  });

  it("成功：返回产物；再问一次结果一致（不会变成「不再跟踪」）；没有重新提交", async () => {
    const id = await submitPending();
    submits = 0;
    jobs.set(id, { id, status: "completed", image: { url: `${origin}/art.png` } });
    const done = await readTaskId(id);
    expect(done.state, JSON.stringify(done)).toBe("succeeded");
    expect(done.assets?.length ?? 0).toBeGreaterThan(0);
    const again = await readTaskId(id);
    expect(again).toEqual(done);
    expect(submits).toBe(0);
  });

  it("失败：带供应商原话，且指引是「只有用户同意再花钱才重试」", async () => {
    const id = await submitPending();
    submits = 0;
    jobs.set(id, { id, status: "failed", detail: "content policy rejected the prompt" });
    const failed = await readTaskId(id);
    expect(failed.state).toBe("failed");
    expect(failed.providerMessage).toContain("content policy rejected the prompt");
    expect(failed.nextAction).toMatch(/only if the user agrees/i);
    expect(submits).toBe(0);
  });

  it("不认识的任务号：明说不认识，不报失败，也不去问供应商", async () => {
    submits = 0;
    const before = getCount;
    const out = await readTaskId("never-heard-of-it");
    expect(out.state).toBe("unknown_task");
    expect(out.message).toMatch(/does not recognize/i);
    expect(out.message).not.toMatch(/did not produce/i);
    expect(getCount).toBe(before);
    expect(submits).toBe(0);
  });

  it("同一进程里追踪被清掉（过期 / 被别处取走）：说 Nomi 已不在跟踪，建议去供应商后台，不建议重提交", async () => {
    const id = await submitPending();
    submits = 0;
    const { taskCache } = await import("../tasks/taskCache");
    // 与 TTL 过期 / LRU 驱逐同一个结果：工作缓存里没有它了，但账本记得它被受理过。
    taskCache.delete(id);
    const out = await readTaskId(id);
    expect(out.state).toBe("not_tracked");
    expect(out.message).toMatch(/no longer tracking/i);
    expect(out.nextAction).toMatch(/do not submit it again/i);
    expect(out.nextAction).toMatch(/console/i);
    expect(submits).toBe(0);
  });

  it("Nomi 重启后（模块全部重新加载，进程内任务缓存与账本一起丢）：说真话，给出下一步，不重提交", async () => {
    const id = await submitPending();
    submits = 0;
    vi.resetModules();
    const out = await readTaskId(id);
    expect(out.state).toBe("unknown_task");
    expect(out.message).toMatch(/restarted/i);
    expect(out.message).toMatch(/no longer tracking/i);
    expect(out.nextAction).toMatch(/do not submit it again/i);
    expect(out.nextAction).toMatch(/provider's own console/i);
    expect(submits).toBe(0);
  });

  it("供应商查询卡死：在预算内返回 query_failed，说明任务不受影响、别重提交", async () => {
    const { readTask } = await import("./readTask");
    const out = await readTask({ fetchTaskResult: () => new Promise<never>(() => undefined), queryBudgetMs: 50 }, { taskId: "job-hang" });
    expect(out.state).toBe("query_failed");
    expect(out.nextAction).toMatch(/do not submit/i);
  });

  it("读任务的代码里没有提交入口：readTask.ts 不导入也不调用 runTask", () => {
    const source = fs.readFileSync(path.join(__dirname, "readTask.ts"), "utf8");
    expect(source).not.toMatch(/import[^;]*\brunTask\b|\brunTask\s*\(/);
  });
});
