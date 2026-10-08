/**
 * 试跑 × 异步供应商：**提交即收费，queued 不是失败**。
 *
 * 事故形状（0.23.0）：大多数视频 / 图片供应商是「提交 → 轮询」。试跑只看首次返回，
 * 首次返回是 `queued` 且没有产物，于是一律判 `provider_failed`——钱已经花了，AI 读到「失败」后
 * 照提示改卡重试，同一单被收费第二次。
 *
 * 这里起一个真的 loopback 异步供应商，走真的 `runTask` / `fetchTaskResult`（与画布同一条执行器和查询链路）。
 * 假供应商会数「收到几次提交」——重复收费在这里就是 `submits > 1`。
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

describe("nomi_try_model 遇到异步供应商", () => {
  let server: http.Server;
  let origin: string;
  let root: string;
  let vendorKey = "";
  /** 假供应商收到的提交次数（>1 = 重复收费）。 */
  let submits = 0;
  /** 每个 job 被查询的次数。 */
  const polls = new Map<string, number>();

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-try-async-"));
    vi.stubEnv("NOMI_SETTINGS_DIR", root);
    server = http.createServer((request, response) => {
      const url = String(request.url);
      if (url === "/art.png") {
        response.writeHead(200, { "content-type": "image/png" });
        response.end(PNG);
        return;
      }
      if (request.method === "POST" && url === "/v1/jobs") {
        let body = "";
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", () => {
          submits += 1;
          const prompt = String((JSON.parse(body || "{}") as { prompt?: unknown }).prompt || "");
          const id = prompt.includes("fail") ? "job-fail" : prompt.includes("slow") ? "job-slow" : "job-ok";
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ id, status: "queued" }));
        });
        return;
      }
      const match = /^\/jobs\/([\w-]+)$/.exec(url);
      if (request.method === "GET" && match) {
        const id = match[1]!;
        const n = (polls.get(id) || 0) + 1;
        polls.set(id, n);
        response.writeHead(200, { "content-type": "application/json" });
        if (id === "job-ok") {
          response.end(JSON.stringify(n < 3 ? { id, status: "in_progress" } : { id, status: "completed", image: { url: `${origin}/art.png` } }));
        } else if (id === "job-fail") {
          response.end(JSON.stringify(n < 2 ? { id, status: "queued" } : { id, status: "failed", detail: "content policy rejected the prompt" }));
        } else {
          response.end(JSON.stringify({ id, status: "in_progress" }));
        }
        return;
      }
      response.writeHead(404).end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const { dispatch } = await import("../dispatcher");
    const docs = "https://docs.example-async.com/api";
    const ctx = { origin: { host: "claude" } } as never;
    const submitted = await dispatch("model.onboarding.setup", {
      action: "submit_declaration",
      name: "Example Async",
      declaration: JSON.stringify({
        provider: { baseUrl: origin, authType: "bearer", authHeader: "Authorization", authScheme: "Relay" },
        sources: [{ url: docs, evidence: "POST /v1/jobs returns id+status; GET /jobs/{id}" }],
        assetIngestion: { strategy: "none", sourceUrl: docs },
        models: [{
          modelKey: "async-paint",
          labelZh: "Async Paint",
          kind: "image",
          modes: [{
            taskKind: "text_to_image",
            delivery: "asynchronous",
            create: {
              method: "POST",
              path: "/v1/jobs",
              body: { prompt: "{{request.prompt}}" },
              response_mapping: { task_id: "id", status: "status" },
              provider_meta_mapping: { task_id: "id" },
            },
            query: {
              method: "GET",
              path: "/jobs/{{providerMeta.task_id}}",
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

  beforeEach(() => {
    vi.stubEnv("NOMI_SETTINGS_DIR", root);
  });

  afterAll(async () => {
    vi.stubEnv("NOMI_SETTINGS_DIR", undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function run(prompt: string, withFetch = true, pollTimeoutMs = 5_000) {
    const { tryModel } = await import("./tryModel");
    const { runTask, fetchTaskResult } = await import("../../runtime");
    submits = 0;
    return tryModel({
      runTask,
      ...(withFetch ? { fetchTaskResult } : {}),
      pollIntervalMs: 20,
      pollTimeoutMs,
      // 档位代答：不需要 Nomi 窗口；钱闸照走同一个函数。
      approvalPolicy: () => ({ mode: "project", spend: "confirm" }),
    }, { vendorKey, modelKey: "async-paint", prompt }) as Promise<Record<string, unknown> & { code?: string; ok?: boolean; taskId?: string; nextAction?: string; message?: string; state?: { assets: unknown[] } }>;
  }

  it("提交返回 queued、查几次后才出图：试跑成功，且只提交了一次", async () => {
    const tried = await run("ok apple");
    expect(tried.ok, JSON.stringify(tried)).toBe(true);
    expect(tried.state?.assets.length ?? 0).toBeGreaterThan(0);
    expect(submits).toBe(1);
    expect(polls.get("job-ok")).toBeGreaterThanOrEqual(3);
  });

  it("等到供应商明确失败：报 provider_failed，带供应商原话", async () => {
    const tried = await run("fail apple");
    expect(tried.ok).toBe(false);
    expect(tried.code).toBe("provider_failed");
    expect(JSON.stringify(tried)).toContain("content policy rejected the prompt");
    expect(submits).toBe(1);
  });

  it("等不到终态：如实说「仍在处理」，绝不报 provider_failed，且明说不要重试", async () => {
    const tried = await run("slow apple", true, 150);
    expect(tried.ok).toBe(false);
    expect(tried.code).toBe("still_processing");
    expect(tried.code).not.toBe("provider_failed");
    expect(tried.taskId).toBe("job-slow");
    expect(tried.nextAction).toMatch(/do not retry/i);
    expect(tried.message).toMatch(/not a failure/i);
    expect(submits).toBe(1);
  });

  it("宿主没给查询函数时同样不判失败（不能因为少一个依赖就把已收费的单子说成失败）", async () => {
    const tried = await run("ok apple", false);
    expect(tried.ok).toBe(false);
    expect(tried.code).toBe("still_processing");
    expect(tried.nextAction).toMatch(/do not retry/i);
    expect(submits).toBe(1);
  });
});

describe("试跑等待上限", () => {
  it("上限不超过 40 秒；假时钟下等不到终态就在上限内放弃（不真等）", async () => {
    const { TRY_MODEL_WAIT_BUDGET_MS } = await import("./tryModel");
    const { pollTaskToTerminal } = await import("../pollTaskToTerminal");
    expect(TRY_MODEL_WAIT_BUDGET_MS).toBeLessThanOrEqual(40_000);
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(async () => ({ result: { id: "job-x", status: "running", assets: [] } }));
      const pending = pollTaskToTerminal({
        initial: { id: "job-x", status: "queued", assets: [] },
        fetch: fetch as never, vendor: "v", taskKind: "text_to_image", prompt: "p", modelKey: "m",
        timeoutMs: TRY_MODEL_WAIT_BUDGET_MS, intervalMs: 3000,
      });
      await vi.advanceTimersByTimeAsync(TRY_MODEL_WAIT_BUDGET_MS + 3000);
      const out = await pending;
      expect(out.ended).toBe("timeout");
      expect(out.result.id).toBe("job-x");
      expect(out.waitedMs).toBeLessThanOrEqual(TRY_MODEL_WAIT_BUDGET_MS + 3000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("单次查询卡死也不拖过上限：卡 60 秒的查询在 40 秒预算处被截断，按到点返回（假时钟）", async () => {
    const { TRY_MODEL_WAIT_BUDGET_MS } = await import("./tryModel");
    const { pollTaskToTerminal } = await import("../pollTaskToTerminal");
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(() => new Promise<never>(() => undefined));
      let settledAt = -1;
      const started = Date.now();
      const pending = pollTaskToTerminal({
        initial: { id: "job-hang", status: "queued", assets: [] },
        fetch: fetch as never, vendor: "v", taskKind: "text_to_image", prompt: "p", modelKey: "m",
        timeoutMs: TRY_MODEL_WAIT_BUDGET_MS, intervalMs: 1500,
      }).then((out) => { settledAt = Date.now() - started; return out; });
      await vi.advanceTimersByTimeAsync(60_000);
      const out = await pending;
      expect(out.ended).toBe("timeout");
      expect(out.result.id).toBe("job-hang");
      expect(settledAt).toBeLessThanOrEqual(TRY_MODEL_WAIT_BUDGET_MS);
    } finally {
      vi.useRealTimers();
    }
  });
});
