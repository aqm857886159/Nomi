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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatch } from "../dispatcher";
import { tryModel, TRY_MODEL_WAIT_BUDGET_MS } from "./tryModel";
import { runTask, fetchTaskResult } from "../../runtime";
import { pollTaskToTerminal } from "../pollTaskToTerminal";

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

type Tried = Record<string, unknown> & {
  code?: string;
  ok?: boolean;
  taskId?: string;
  nextAction?: string;
  message?: string;
  state?: { assets: unknown[] };
};
type CaseCounters = { submits: number; polls: Map<string, number> };

const realSetTimeout = globalThis.setTimeout;
const yieldIo = (first: boolean): Promise<void> =>
  first ? new Promise((resolve) => setImmediate(resolve)) : new Promise((resolve) => realSetTimeout(resolve, 1));

/** 推进 0ms 假时钟并让出真实 I/O：假 Date.now() 恒为 0，提交与原子落盘不会与轮询预算竞态。 */
async function settleAtZeroClock(condition: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 20_000; i += 1) {
    if (condition()) return;
    await vi.advanceTimersByTimeAsync(0);
    if (condition()) return;
    await yieldIo(i === 0);
  }
  throw new Error(`never became true: ${label}`);
}

describe("nomi_try_model 遇到异步供应商", () => {
  let server: http.Server;
  let origin: string;
  let root: string;
  let vendorKey = "";
  let caseSeq = 0;
  let currentCaseId = "";
  let currentCase: CaseCounters = { submits: 0, polls: new Map() };
  /** 按用例路径隔离的假供应商计数，避免前序迟到请求污染后续用例。 */
  const cases = new Map<string, CaseCounters>();

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-try-async-"));
    server = http.createServer((request, response) => {
      const url = String(request.url);
      if (url === "/art.png") {
        response.writeHead(200, { "content-type": "image/png" });
        response.end(PNG);
        return;
      }
      const postMatch = /^\/(case-\d+)\/v1\/jobs$/.exec(url);
      if (request.method === "POST" && postMatch) {
        const bucket = cases.get(postMatch[1]!);
        if (!bucket) {
          response.writeHead(404).end("{}");
          return;
        }
        let body = "";
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", () => {
          bucket.submits += 1;
          const prompt = String((JSON.parse(body || "{}") as { prompt?: unknown }).prompt || "");
          const id = prompt.includes("fail") ? "job-fail" : prompt.includes("slow") ? "job-slow" : "job-ok";
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ id, status: "queued" }));
        });
        return;
      }
      const getMatch = /^\/(case-\d+)\/jobs\/([\w-]+)$/.exec(url);
      if (request.method === "GET" && getMatch) {
        const bucket = cases.get(getMatch[1]!);
        if (!bucket) {
          response.writeHead(404).end("{}");
          return;
        }
        const id = getMatch[2]!;
        const n = (bucket.polls.get(id) || 0) + 1;
        bucket.polls.set(id, n);
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
  });

  beforeEach(async () => {
    vi.useRealTimers();
    currentCaseId = `case-${++caseSeq}`;
    currentCase = { submits: 0, polls: new Map() };
    cases.set(currentCaseId, currentCase);
    vi.stubEnv("NOMI_SETTINGS_DIR", fs.mkdtempSync(path.join(root, `${currentCaseId}-`)));
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
              path: `/${currentCaseId}/v1/jobs`,
              body: { prompt: "{{request.prompt}}" },
              response_mapping: { task_id: "id", status: "status" },
              provider_meta_mapping: { task_id: "id" },
            },
            query: {
              method: "GET",
              path: `/${currentCaseId}/jobs/{{providerMeta.task_id}}`,
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
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    vi.stubEnv("NOMI_SETTINGS_DIR", undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  function start(prompt: string, { withFetch = true, pollTimeoutMs = 2_000 }: { withFetch?: boolean; pollTimeoutMs?: number } = {}) {
    const box: { settled: boolean; out?: Tried } = { settled: false };
    const promise = (tryModel({
      runTask,
      ...(withFetch ? { fetchTaskResult } : {}),
      pollIntervalMs: 0,
      pollTimeoutMs,
      // 档位代答：不需要 Nomi 窗口；钱闸照走同一个函数。
      approvalPolicy: () => ({ mode: "direct" }),
    }, { vendorKey, modelKey: "async-paint", prompt }) as Promise<Tried>).then((out) => {
      box.settled = true;
      box.out = out;
      return out;
    });
    return { box, promise };
  }

  it("提交返回 queued、查几次后才出图：试跑成功，且只提交了一次", async () => {
    const { box, promise } = start("ok apple");
    await settleAtZeroClock(() => box.settled, "ok trial settled");
    const tried = await promise;
    expect(tried.ok, JSON.stringify(tried)).toBe(true);
    expect(tried.state?.assets.length ?? 0).toBeGreaterThan(0);
    expect(currentCase.submits).toBe(1);
    expect(currentCase.polls.get("job-ok")).toBeGreaterThanOrEqual(3);
  });

  it("等到供应商明确失败：报 provider_failed，带供应商原话", async () => {
    const { box, promise } = start("fail apple");
    await settleAtZeroClock(() => box.settled, "fail trial settled");
    const tried = await promise;
    expect(tried.ok).toBe(false);
    expect(tried.code).toBe("provider_failed");
    expect(JSON.stringify(tried)).toContain("content policy rejected the prompt");
    expect(currentCase.submits).toBe(1);
  });

  it("等不到终态：如实说「仍在处理」，绝不报 provider_failed，且明说不要重试", async () => {
    const { box, promise } = start("slow apple", { pollTimeoutMs: 200 });
    // 先在假时钟 0ms 下确认提交完成并进入 GET 轮询，再推进假时钟耗尽轮询预算，避免提交耗时竞态。
    await settleAtZeroClock(() => (currentCase.polls.get("job-slow") ?? 0) >= 1, "slow trial entered polling");
    expect(box.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await settleAtZeroClock(() => box.settled, "slow trial timed out in polling");
    const tried = await promise;
    expect(tried.ok).toBe(false);
    expect(tried.code).toBe("still_processing");
    expect(tried.code).not.toBe("provider_failed");
    expect(tried.taskId).toBe("job-slow");
    expect(tried.nextAction).toMatch(/do not retry/i);
    expect(tried.message).toMatch(/not a failure/i);
    expect(currentCase.submits).toBe(1);
    expect(currentCase.polls.get("job-slow")).toBeGreaterThanOrEqual(1);
  });

  it("宿主没给查询函数时同样不判失败（不能因为少一个依赖就把已收费的单子说成失败）", async () => {
    const { box, promise } = start("ok apple", { withFetch: false });
    await settleAtZeroClock(() => box.settled, "no-fetch trial settled");
    const tried = await promise;
    expect(tried.ok).toBe(false);
    expect(tried.code).toBe("still_processing");
    expect(tried.nextAction).toMatch(/do not retry/i);
    expect(currentCase.submits).toBe(1);
  });
});

describe("试跑等待上限", () => {
  it("上限不超过 40 秒；假时钟下等不到终态就在上限内放弃（不真等）", async () => {
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
