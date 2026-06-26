/**
 * runTask 的 image/video **fallback 路径**（无 curated mapping 时走的
 * `/v1/{images,videos}/generations` OpenAI 兼容形状）回归。覆盖两个机制审计 P1：
 *
 *  #1 结构化 vendor 错误只覆盖 profile 一条出口：fallback 路径此前用本地 postJson 抛
 *     **裸 Error**（无 httpStatus/category/retryable），下游人话错误卡只能正则反猜。
 *     → fallback 现在与 profile 路径同源走 requestJson，抛结构化 VendorRequestError。
 *
 *  #2 vendor.meta.extraHeaders 到不了 profile/fallback 路径：relay/代理网关自定义鉴权头
 *     此前只在文本/AI-SDK 路径注入。→ 现在也透传进 HTTP 请求头。
 *
 * 用临时 settings 目录 + 明文 safeStorage mock 起一份真实 catalog（vendor+model，
 * 故意不建 mapping 以走 fallback），stub 全局 fetch 抓请求头/构造错误响应。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockedUserDataRoot = "";
const tempRoots: string[] = [];

vi.mock("electron", () => ({
  app: {
    getPath: () => mockedUserDataRoot,
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

const stubFetch = (impl: () => Promise<Response> | Response) => {
  const fn = vi.fn(async () => impl());
  vi.stubGlobal("fetch", fn);
  return fn;
};

beforeEach(() => {
  mockedUserDataRoot = makeTempDir("nomi-runtime-fallback-");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// 建一个走 fallback 路径的 image 供应商：有 vendor + key + image model，但**没有 mapping**。
// extraHeaders 经 manual 表单存在 vendor.meta.extraHeaders（与生产同形）。
async function seedFallbackImageVendor(): Promise<void> {
  const store = await import("./catalog/catalogStore");
  store.upsertModelCatalogVendor({
    key: "relay",
    name: "中转站",
    enabled: true,
    authType: "bearer",
    baseUrlHint: "https://relay.example.com/v1",
    meta: { extraHeaders: { "HTTP-Referer": "https://nomi.app", "X-Title": "Nomi" } },
  });
  store.upsertModelCatalogVendorApiKey("relay", { apiKey: "sk-relay" });
  store.upsertModelCatalogModel({ vendorKey: "relay", modelKey: "some-image-model", kind: "image", enabled: true });
}

describe("runTask fallback 路径 — 结构化错误 + extraHeaders", () => {
  it("#2 fallback 请求带上 vendor.meta.extraHeaders（网关头到达图片路径）", async () => {
    await seedFallbackImageVendor();
    const fetchFn = stubFetch(() =>
      new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/out.png" }] }), { status: 200 }),
    );
    const { runTask } = await import("./runtime");
    const { mintSpendGrant } = await import("./spendGrant");
    const result = await runTask({
      vendor: "relay",
      request: { kind: "text_to_image", prompt: "a cat", extras: { modelKey: "some-image-model", grantId: mintSpendGrant({ nodeIds: [] }) } },
    });
    expect(result.status).toBe("succeeded");

    // 抓 fetch 实际带的 headers。
    const headers = (fetchFn.mock.calls[0]?.[1] as { headers?: Record<string, string> })?.headers || {};
    expect(headers.Authorization).toBe("Bearer sk-relay");
    expect(headers["HTTP-Referer"]).toBe("https://nomi.app");
    expect(headers["X-Title"]).toBe("Nomi");
  });

  it("#1 fallback 路径 HTTP 401 → 抛结构化 VendorRequestError（auth/不可重试），不是裸 Error", async () => {
    await seedFallbackImageVendor();
    stubFetch(() => new Response(JSON.stringify({ message: "invalid api key" }), { status: 401 }));
    const { runTask } = await import("./runtime");
    const { VendorRequestError } = await import("./vendor/vendorHttp");
    const { mintSpendGrant } = await import("./spendGrant");

    const error = await runTask({
      vendor: "relay",
      request: { kind: "text_to_image", prompt: "a cat", extras: { modelKey: "some-image-model", grantId: mintSpendGrant({ nodeIds: [] }) } },
    }).catch((e) => e);

    expect(error).toBeInstanceOf(VendorRequestError);
    expect(error.structured).toMatchObject({ httpStatus: 401, category: "auth", retryable: false });
  });

  it("#1 fallback 路径 HTTP 402 → balance 类别（查表，不是猜）", async () => {
    await seedFallbackImageVendor();
    stubFetch(() => new Response(JSON.stringify({ message: "insufficient balance" }), { status: 402 }));
    const { runTask } = await import("./runtime");
    const { VendorRequestError } = await import("./vendor/vendorHttp");
    const { mintSpendGrant } = await import("./spendGrant");

    const error = await runTask({
      vendor: "relay",
      request: { kind: "text_to_image", prompt: "a cat", extras: { modelKey: "some-image-model", grantId: mintSpendGrant({ nodeIds: [] }) } },
    }).catch((e) => e);

    expect(error).toBeInstanceOf(VendorRequestError);
    expect(error.structured).toMatchObject({ httpStatus: 402, category: "balance", retryable: false });
  });
});

// 建一个**异步**供应商（有 create+query mapping），create 返回 taskId 但无 asset → 进 pending(queued)。
async function seedAsyncVideoVendorWithMapping(): Promise<void> {
  const store = await import("./catalog/catalogStore");
  store.upsertModelCatalogVendor({
    key: "asyncv",
    name: "异步视频",
    enabled: true,
    authType: "bearer",
    baseUrlHint: "https://asyncv.example.com",
  });
  store.upsertModelCatalogVendorApiKey("asyncv", { apiKey: "sk-async" });
  store.upsertModelCatalogModel({ vendorKey: "asyncv", modelKey: "vid-model", kind: "video", enabled: true });
  store.upsertModelCatalogMapping({
    vendorKey: "asyncv",
    taskKind: "text_to_video",
    name: "t2v",
    create: { method: "POST", path: "/create", body: { prompt: "{{request.prompt}}" }, response_mapping: { task_id: "data.taskId" } },
    query: { method: "GET", path: "/query", query: { taskId: "{{providerMeta.task_id}}" } },
  });
}

describe("fetchTaskResult — taskCache miss 区分（受理账本 → 集成验证 P1 修复）", () => {
  it("受理过的异步任务在缓存里时正常轮询；对 bogus id 报 task_unknown（两路不混）", async () => {
    await seedAsyncVideoVendorWithMapping();
    // create：返回 taskId，无 asset → queued → 进 pending cache + 受理账本。
    stubFetch(() => new Response(JSON.stringify({ code: 200, data: { taskId: "kie-xyz" } }), { status: 200 }));
    const { runTask, fetchTaskResult } = await import("./runtime");
    const { mintSpendGrant } = await import("./spendGrant");
    const created = await runTask({
      vendor: "asyncv",
      request: { kind: "text_to_video", prompt: "a dog", extras: { modelKey: "vid-model", grantId: mintSpendGrant({ nodeIds: [] }) } },
    });
    expect(created.status).toBe("queued");
    expect(created.id).toBe("kie-xyz");

    // 从未受理的 id → task_unknown（不是「追踪丢失」，更不是把它当受理过）。
    const unknown = await fetchTaskResult({ vendor: "asyncv", taskId: "never-existed", taskKind: "text_to_video" });
    expect(unknown.result.status).toBe("failed");
    expect((unknown.result.raw as { code?: string }).code).toBe("task_unknown");

    // 受理过且仍在缓存的 id → 走真实轮询分支（query GET），不是 miss（raw 是 vendor 原始响应，
    // 不带本地 miss code；id 仍是受理时的 taskId 而非合成失败）。
    const polled = await fetchTaskResult({ vendor: "asyncv", taskId: "kie-xyz", taskKind: "text_to_video" });
    const polledCode = (polled.result.raw as { code?: string | number }).code;
    expect(polledCode).not.toBe("task_unknown");
    expect(polledCode).not.toBe("task_tracking_lost");
    expect(polled.result.id).toBe("kie-xyz");
  });
});

describe("fetchTaskResult — 缓存 miss 无状态重建续查（重启/驱逐后仍能找回）", () => {
  it("缓存里没有该 taskId，但带 vendor+modelKey+taskKind → 重建 query 真去查上游，不报 task_unknown", async () => {
    await seedAsyncVideoVendorWithMapping();
    // **不跑 create**（模拟重启后内存 taskCache 全空）。直接对一个上游真实存在的 taskId 发查询。
    const fetchFn = stubFetch(() =>
      new Response(JSON.stringify({ video_url: "https://cdn.example.com/recovered.mp4" }), { status: 200 }),
    );
    const { fetchTaskResult } = await import("./runtime");
    const recovered = await fetchTaskResult({
      vendor: "asyncv",
      taskId: "upstream-live-123",
      taskKind: "text_to_video",
      modelKey: "vid-model",
    });
    // 真发了 query GET（无状态重建跑了上游查询），不是直接合成失败。
    expect(fetchFn).toHaveBeenCalled();
    expect(recovered.result.status).toBe("succeeded");
    expect(recovered.result.assets.length).toBeGreaterThan(0);
    expect((recovered.result.raw as { code?: string }).code).not.toBe("task_unknown");
  });

  it("重建不了（缺 modelKey 无法定位 mapping）→ 仍回落诚实诊断 task_unknown，不静默吞", async () => {
    await seedAsyncVideoVendorWithMapping();
    const { fetchTaskResult } = await import("./runtime");
    const miss = await fetchTaskResult({ vendor: "asyncv", taskId: "no-context-id", taskKind: "text_to_video" });
    expect(miss.result.status).toBe("failed");
    expect((miss.result.raw as { code?: string }).code).toBe("task_unknown");
  });
});
