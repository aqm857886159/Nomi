/**
 * 试跑 × 提交预算：**提交那一步也在 40 秒预算里**，到点按出站证据说话。
 *
 * 事故形状：#987 只给「等结果」加了 40 秒上限；供应商的提交接口卡住时，这一次 MCP 工具调用会超过外部宿主
 * 的 60 秒超时，客户端先断线，AI 重试，供应商那边多收一单。
 *
 * 这里起真的 loopback 假供应商，走真的 `runtime.runTask`（与画布同一条执行器）。时间用假时钟，不真等。
 * 假供应商会数「收到几次提交」——重复收费在这里就是 `submits > 1`。
 * 假时钟只假 setTimeout / Date；真 socket 的 I/O 靠让出事件循环推进。
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

type Tried = Record<string, unknown> & { code?: string; ok?: boolean; taskId?: string; nextAction?: string; message?: string };
type RunTaskFn = typeof import("../../runtime").runTask;

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
async function until(condition: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200_000; i += 1) {
    if (condition()) return;
    await tick();
  }
  throw new Error(`never became true: ${label}`);
}
/** 假时钟按小步推进，每步让真 socket I/O 跑几圈。 */
async function advance(totalMs: number, stepMs = 250): Promise<void> {
  for (let done = 0; done < totalMs; done += stepMs) {
    await vi.advanceTimersByTimeAsync(Math.min(stepMs, totalMs - done));
    for (let i = 0; i < 30; i += 1) await tick();
  }
}

describe("nomi_try_model 提交步骤的预算", () => {
  let server: http.Server;
  let root: string;
  let vendorKey = "";
  let refusedVendorKey = "";
  let submits = 0;
  const held: http.ServerResponse[] = [];

  async function declare(name: string, baseUrl: string): Promise<string> {
    const { dispatch } = await import("../dispatcher");
    const docs = "https://docs.example-budget.com/api";
    const ctx = { origin: { host: "claude" } } as never;
    const submitted = await dispatch("model.onboarding.setup", {
      action: "submit_declaration",
      name,
      declaration: JSON.stringify({
        provider: { baseUrl, authType: "bearer", authHeader: "Authorization", authScheme: "Relay" },
        sources: [{ url: docs, evidence: "POST /v1/jobs returns id+status; GET /jobs/{id}" }],
        assetIngestion: { strategy: "none", sourceUrl: docs },
        models: [{
          modelKey: "budget-paint", labelZh: "Budget Paint", kind: "image",
          modes: [{
            taskKind: "text_to_image", delivery: "asynchronous",
            create: {
              method: "POST", path: "/v1/jobs", body: { prompt: "{{request.prompt}}" },
              response_mapping: { task_id: "id", status: "status" }, provider_meta_mapping: { task_id: "id" },
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
    const keyed = await dispatch("model.onboarding.setup", { action: "set_key", vendorKey: submitted.vendorKey, apiKey: "relay-test-key" }, ctx) as { ok: boolean };
    expect(keyed.ok).toBe(true);
    return submitted.vendorKey;
  }

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-try-budget-"));
    process.env.NOMI_SETTINGS_DIR = root;
    server = http.createServer((request, response) => {
      const url = String(request.url);
      if (request.method === "POST" && url === "/v1/jobs") {
        let body = "";
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", () => {
          submits += 1;
          const prompt = String((JSON.parse(body || "{}") as { prompt?: unknown }).prompt || "");
          response.setHeader("content-type", "application/json");
          if (prompt.includes("hold")) { held.push(response); return; } // 卡住：收下了但迟迟不回
          if (prompt.includes("reset")) { request.socket.destroy(); return; } // 收下后掐线：结果未知
          response.writeHead(200);
          response.end(JSON.stringify({ id: "job-slow", status: "queued" }));
        });
        return;
      }
      const match = /^\/jobs\/([\w-]+)$/.exec(url);
      if (request.method === "GET" && match) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: match[1], status: "in_progress" }));
        return;
      }
      response.writeHead(404).end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    vendorKey = await declare("Example Budget", origin);
    // 一个没人监听的端口：建连被拒 = 请求一个字节都没写出去。
    const probe = net.createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const closedPort = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    refusedVendorKey = await declare("Example Refused", `http://127.0.0.1:${closedPort}`);
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const response of held.splice(0)) response.destroy();
  });

  afterAll(async () => {
    delete process.env.NOMI_SETTINGS_DIR;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function start(vendor: string, prompt: string, wrapRunTask?: (real: RunTaskFn) => RunTaskFn) {
    const { tryModel } = await import("./tryModel");
    const { runTask, fetchTaskResult } = await import("../../runtime");
    submits = 0;
    const box: { settled: boolean; out?: Tried } = { settled: false };
    const promise = (tryModel({
      runTask: wrapRunTask ? wrapRunTask(runTask) : runTask,
      fetchTaskResult,
      approvalPolicy: () => ({ mode: "project", spend: "confirm" }),
    }, { vendorKey: vendor, modelKey: "budget-paint", prompt }) as Promise<Tried>).then((out) => { box.settled = true; box.out = out; return out; });
    return { box, promise };
  }

  it("提交卡住：到 40 秒就回话「结果未知、不要重试」；后台那次提交照跑，供应商只收到 1 次，任务号进缓存", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { taskCache } = await import("../../runtime");
    const { box } = await start(vendorKey, "hold apple");
    await until(() => submits === 1, "provider received the submit");
    await advance(39_000);
    expect(box.settled).toBe(false);
    await advance(1_000);
    await until(() => box.settled, "tool call returned at the budget");
    expect(box.out?.ok).toBe(false);
    expect(box.out?.code).toBe("submission_unknown");
    expect(box.out?.nextAction).toMatch(/do not retry/i);
    expect(box.out?.nextAction).toMatch(/nomi_read target=task|provider's own console/i);
    // 后台那次提交没被中止：供应商这时才回，任务号落进任务缓存，`nomi_read` 能查到它。
    expect(taskCache.get("job-slow")).toBeUndefined();
    for (const response of held.splice(0)) response.end(JSON.stringify({ id: "job-slow", status: "queued" }));
    await until(() => taskCache.get("job-slow") !== undefined, "late submit result admitted to taskCache");
    expect(submits).toBe(1);
  });

  it("提交和等待共用一份预算：提交占了 30 秒，等待只剩 10 秒，总共仍是 40 秒", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { box } = await start(vendorKey, "slow apple", (real) => async (payload) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 30_000));
      return real(payload);
    });
    await advance(39_000);
    expect(box.settled).toBe(false);
    await advance(1_000);
    await until(() => box.settled, "tool call returned at the shared budget");
    expect(box.out?.code).toBe("still_processing");
    expect(box.out?.taskId).toBe("job-slow");
    expect(submits).toBe(1);
  });

  it("请求被写出去之后连接被掐断：回「结果未知、不要重试」，不是可重试的失败", async () => {
    const { box, promise } = await start(vendorKey, "reset apple");
    const out = await promise;
    expect(box.settled).toBe(true);
    expect(out.ok).toBe(false);
    expect(out.code).toBe("submission_unknown");
    expect(out.nextAction).toMatch(/do not retry/i);
    expect(submits).toBe(1);
  });

  it("证明请求没写出去（建连被拒）：如实说「没提交，可以重试」", async () => {
    const { promise } = await start(refusedVendorKey, "plain apple");
    const out = await promise;
    expect(out.ok).toBe(false);
    expect(out.code).toBe("provider_failed");
    expect(out.message).toMatch(/nothing was sent/i);
    expect(out.nextAction).toMatch(/safe to retry/i);
    expect(out.nextAction).not.toMatch(/do not retry/i);
  });
});
