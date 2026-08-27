import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import type { Mapping, Model, Vendor } from "../catalog/types";
import type { TaskRequest, TaskResult } from "../runtime";
import type { AdapterModeDraft } from "./types";
import { verifyAdapterMode, type AdapterVerifierDependencies } from "./verifier";

const now = "2026-08-07T00:00:00.000Z";
const mediaFixture = (name: string) => fs.readFileSync(path.join(__dirname, "__fixtures__", "certification-media", name));
const vendor: Vendor = {
  key: "example-com",
  name: "Example",
  enabled: false,
  baseUrlHint: "https://api.example.com/v1",
  authType: "bearer",
  createdAt: now,
  updatedAt: now,
};
const model: Model = {
  vendorKey: vendor.key,
  modelKey: "paint-v2",
  labelZh: "Paint V2",
  kind: "image",
  enabled: false,
  createdAt: now,
  updatedAt: now,
};
const mode = (overrides: Partial<AdapterModeDraft> = {}): AdapterModeDraft => ({
  taskKind: "text_to_image",
  create: { method: "POST", path: "/images", body: { prompt: "{{request.prompt}}" } },
  testParams: {},
  sourceUrls: ["https://docs.example.com/api"],
  ...overrides,
});

function result(status: TaskResult["status"], assets: TaskResult["assets"] = []): TaskResult {
  return { id: "task-1", kind: "text_to_image", status, assets, raw: {} };
}

describe("verifyAdapterMode", () => {
  it("verifies text through Nomi's production streaming path instead of the compiled HTTP candidate", async () => {
    const execute = vi.fn();
    const verifyText = vi.fn().mockResolvedValue({ text: "ready" });

    const verification = await verifyAdapterMode(
      {
        vendor,
        model: { ...model, modelKey: "chat-v1", labelZh: "Chat V1", kind: "text" },
        apiKey: "sk-test",
        mode: mode({
          taskKind: "chat",
          create: { method: "POST", path: "/native/chat", response_mapping: { text: "text" } },
        }),
      },
      { execute, verifyText },
    );

    expect(verification.ok).toBe(true);
    expect(verifyText).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining("verification") }));
    expect(execute).not.toHaveBeenCalled();
  });

  // 回归钉子（2026-08-11 用户接 DeepSeek V4 踩到）：思考型模型先吐 reasoning 再吐正文，
  // 而 textStream 只含正文。探测额度太小 → 正文被截空 → 旧代码判「模型不可用」，把好模型判死。
  // 这里钉的是「空正文要分因」：我们自己截断的不算模型的错，真空回复才算。
  const textModel = { ...model, modelKey: "chat-v1", labelZh: "Chat V1", kind: "text" as const };
  const chatMode = mode({ taskKind: "chat", create: { method: "POST", path: "/chat" } });

  it("counts a thinking model as reachable when our own token cap truncated it before the answer", async () => {
    const verifyText = vi.fn().mockResolvedValue({
      text: "",
      finishReason: "length",
      reasoning: "The user wants the single word ready, so I should reply with",
    });

    const verification = await verifyAdapterMode(
      { vendor, model: textModel, apiKey: "sk-test", mode: chatMode },
      { verifyText },
    );

    expect(verification.ok).toBe(true);
  });

  it("still fails a model that returns nothing at all", async () => {
    const verifyText = vi.fn().mockResolvedValue({ text: "", finishReason: "stop" });

    const verification = await verifyAdapterMode(
      { vendor, model: textModel, apiKey: "sk-test", mode: chatMode },
      { verifyText },
    );

    expect(verification.ok).toBe(false);
    if (!verification.ok) expect(verification.error).toContain("empty reply");
  });

  it("passes a synchronous media result only after the returned asset is readable", async () => {
    const execute = vi.fn().mockResolvedValue({ response: { url: "https://cdn.example.com/out.png" }, request: {} });
    const normalize = vi.fn().mockResolvedValue({
      result: result("succeeded", [{ type: "image", url: "https://cdn.example.com/out.png" }]),
      providerMeta: {},
    });
    const fetchAsset = vi.fn().mockResolvedValue({ contentType: "image/png", bytes: mediaFixture("valid.png") });

    const verification = await verifyAdapterMode(
      { vendor, model, apiKey: "sk-test", mode: mode() },
      { execute, normalize, fetchAsset },
    );

    expect(verification.ok).toBe(true);
    expect(fetchAsset).toHaveBeenCalledWith("https://cdn.example.com/out.png", expect.objectContaining({
      allowRedirect: false,
      maxBytes: 12 * 1024 * 1024,
    }));
    if (verification.ok) expect(verification.mediaEvidence).toMatchObject({ kind: "image", contentType: "image/png" });
  });

  it("polls an asynchronous mapping until it reaches a terminal success", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ response: { id: "job-1" }, request: {} })
      .mockResolvedValueOnce({ response: { status: "running" }, request: {} })
      .mockResolvedValueOnce({ response: { status: "done", url: "https://cdn.example.com/out.mp4" }, request: {} });
    const normalize = vi
      .fn()
      .mockResolvedValueOnce({ result: { ...result("queued"), kind: "text_to_video", id: "job-1" }, providerMeta: { task_id: "job-1" } })
      .mockResolvedValueOnce({ result: { ...result("running"), kind: "text_to_video", id: "job-1" }, providerMeta: { task_id: "job-1" } })
      .mockResolvedValueOnce({
        result: {
          ...result("succeeded", [{ type: "video", url: "https://cdn.example.com/out.mp4" }]),
          kind: "text_to_video",
          id: "job-1",
        },
        providerMeta: { task_id: "job-1" },
      });
    const fetchAsset = vi.fn().mockResolvedValue({ contentType: "video/mp4", bytes: mediaFixture("valid.mp4") });

    const verification = await verifyAdapterMode(
      {
        vendor,
        model: { ...model, kind: "video" },
        apiKey: "sk-test",
        mode: mode({
          taskKind: "text_to_video",
          query: { method: "GET", path: "/jobs/{{providerMeta.task_id}}" },
        }),
      },
      { execute, normalize, fetchAsset, sleep: async () => {}, maxPolls: 3 },
    );

    expect(verification.ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls[1]?.[0].providerMeta).toEqual({ task_id: "job-1" });
  });

  it("injects a local reference fixture into the declared request parameter", async () => {
    let capturedRequest: TaskRequest | undefined;
    let capturedMapping: Mapping | undefined;
    const execute: AdapterVerifierDependencies["execute"] = async (input) => {
      capturedRequest = input.request;
      capturedMapping = {
        id: "capture",
        vendorKey: input.vendor.key,
        modelKey: input.model.modelKey,
        taskKind: input.request.kind,
        name: "capture",
        enabled: false,
        create: input.operation,
        createdAt: now,
        updatedAt: now,
      };
      expect(input.localAssetReader?.("nomi-local://adapter-test/reference.png")?.contentType).toBe("image/png");
      return { response: { url: "https://cdn.example.com/out.png" }, request: {} };
    };

    const verification = await verifyAdapterMode(
      {
        vendor,
        model,
        apiKey: "sk-test",
        mode: mode({
          taskKind: "image_edit",
          referenceParam: "referenceImages",
          referenceShape: "array",
        }),
      },
      {
        execute,
        normalize: async () => ({
          result: result("succeeded", [{ type: "image", url: "https://cdn.example.com/out.png" }]),
          providerMeta: {},
        }),
        fetchAsset: async () => ({ contentType: "image/png", bytes: mediaFixture("valid.png") }),
      },
    );

    expect(verification.ok).toBe(true);
    expect(capturedRequest?.extras?.referenceImages).toEqual(["nomi-local://adapter-test/reference.png"]);
    expect(capturedMapping?.taskKind).toBe("image_edit");
  });

  it("fails at verify_asset when the returned URL is not the expected media type", async () => {
    const verification = await verifyAdapterMode(
      { vendor, model, apiKey: "sk-test", mode: mode() },
      {
        execute: async () => ({ response: {}, request: {} }),
        normalize: async () => ({
          result: result("succeeded", [{ type: "image", url: "https://cdn.example.com/not-an-image" }]),
          providerMeta: {},
        }),
        fetchAsset: async () => ({ contentType: "text/plain", bytes: mediaFixture("valid.png") }),
      },
    );

    expect(verification).toMatchObject({ ok: false, stage: "verify_asset" });
    if (!verification.ok) expect(verification.reasonCode).toBe("media_content_type_unsupported");
  });

  it("rejects an HTTP 200 HTML error page even when the response claims image/png", async () => {
    const verification = await verifyAdapterMode(
      { vendor, model, apiKey: "sk-test", mode: mode() },
      {
        execute: async () => ({ response: {}, request: {} }),
        normalize: async () => ({
          result: result("succeeded", [{ type: "image", url: "https://cdn.example.com/out.png" }]),
          providerMeta: {},
        }),
        fetchAsset: async () => ({
          contentType: "image/png",
          bytes: Buffer.from("<!doctype html><html><body>upstream error</body></html>"),
        }),
      },
    );

    expect(verification).toMatchObject({
      ok: false,
      stage: "verify_asset",
      reasonCode: "media_markup_masquerade",
    });
  });

  it("rejects a corrupt raster header instead of promoting the provider", async () => {
    const verification = await verifyAdapterMode(
      { vendor, model, apiKey: "sk-test", mode: mode() },
      {
        execute: async () => ({ response: {}, request: {} }),
        normalize: async () => ({
          result: result("succeeded", [{ type: "image", url: "https://cdn.example.com/out.png" }]),
          providerMeta: {},
        }),
        fetchAsset: async () => ({
          contentType: "image/png",
          bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02]),
        }),
      },
    );

    expect(verification).toMatchObject({
      ok: false,
      stage: "verify_asset",
      reasonCode: "media_corrupt",
    });
  });

  it("passes caller cancellation to the active provider request", async () => {
    const controller = new AbortController();
    let executeSignal: AbortSignal | undefined;
    const pending = verifyAdapterMode(
      { vendor, model, apiKey: "sk-test", mode: mode(), signal: controller.signal },
      {
        execute: (input) => {
          executeSignal = input.signal;
          return new Promise((resolve, reject) => {
            input.signal?.addEventListener("abort", () => reject(input.signal?.reason), { once: true });
            setTimeout(() => resolve({ response: {}, request: {} }), 20);
          });
        },
      },
    );

    controller.abort(new Error("cancel verify"));

    await expect(pending).resolves.toMatchObject({ ok: false, error: "cancel verify" });
    expect(executeSignal?.aborted).toBe(true);
  });
});
