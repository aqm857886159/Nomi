import { describe, expect, it, vi } from "vitest";

import { createApimartGenerationProvider } from "./apimartGenerationProvider";

function input(overrides: Record<string, unknown> = {}) {
  return {
    moduleId: "generation.single-shot",
    providerId: "apimart",
    modelId: "gpt-image-2",
    mode: "text-to-image",
    prompt: "a red paper crane",
    parameters: { aspectRatio: "1:1", resolution: "1K" },
    references: [],
    contractHash: "a".repeat(64),
    idempotencyKey: "stable-nomi-key",
    requestFingerprint: "b".repeat(64),
    executionBinding: {
      immutableProjectUuid: "project-1",
      projectGeneration: 1,
      runId: "run-1",
      shotId: "shot-1",
      contractHash: "a".repeat(64),
      runtimeTaskId: "runtime-1",
      providerNamespace: "apimart",
      providerIdempotencyKey: "stable-nomi-key",
      requestFingerprint: "b".repeat(64),
      runtimeEnvelopeRef: ".nomi/runs/run-1/runtime.json",
      fencingEpoch: 1,
    },
    ...overrides,
  };
}

describe("APIMart observe-only generation provider", () => {
  it("maps a generic image contract to APIMart's flat image request", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(provider.buildRequest(input())).toEqual({
      model: "gpt-image-2",
      prompt: "a red paper crane",
      size: "1:1",
      resolution: "1K",
      n: 1,
    });
    expect(provider.capabilities).toEqual({ submitIdempotency: false, query: true, reconcile: true, cancel: false, materialize: true });
  });

  it("submits with bearer auth and extracts data[0].task_id", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.apimart.ai/v1/images/generations");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ code: 200, data: [{ status: "submitted", task_id: "task-1" }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl });
    await expect(provider.submit({ model: "gpt-image-2", prompt: "x", size: "1:1", resolution: "1K", n: 1 }, "stable-key")).resolves.toMatchObject({ providerTaskId: "task-1" });
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer test-key" });
  });

  it("queries by task id and never sends the stable Nomi key as a false provider idempotency claim", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 200, data: { id: "task-1", status: "processing" } }), { status: 200 }));
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl });
    await expect(provider.query?.("task-1")).resolves.toMatchObject({ status: "processing" });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.apimart.ai/v1/tasks/task-1", expect.objectContaining({ method: "GET" }));
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).not.toHaveProperty("Idempotency-Key");
  });

  it("reconcile returns not-found without a task id and never invents one", async () => {
    const fetchImpl = vi.fn();
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl });
    await expect(provider.reconcile?.({ idempotencyKey: "stable-key" })).resolves.toEqual({ found: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("extracts provider-specific image/video output shapes without making a second request", async () => {
    const fetchImpl = vi.fn();
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl });
    await expect(provider.materialize?.({
      providerTaskId: "task-1",
      raw: { code: 200, data: { status: "completed", result: { images: [{ url: "https://cdn.example/image.png" }], videos: [{ url: "https://cdn.example/video.mp4" }] } } },
    })).resolves.toMatchObject({ outputs: [
      { kind: "image", url: "https://cdn.example/image.png" },
      { kind: "video", url: "https://cdn.example/video.mp4", providerOutputId: "video-1" },
    ] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("extracts the REAL Seedance video payload where videos[].url is an ARRAY of strings", async () => {
    // Live-captured 2026-08-25 (task_01M0VPQMBEN24HA665TM0KQZTS, S6.5 paid acceptance): the vendor
    // delivers `videos[0].url` as ["https://…"], not a plain string. The old extractor returned zero
    // outputs → adapter.materialize threw "no materializable output" on EVERY observe round, so a real
    // completed video never landed. Docs-shaped plain strings must keep working (previous test).
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    await expect(provider.materialize?.({
      providerTaskId: "task-1",
      raw: {
        code: 200,
        data: {
          actual_time: 128, progress: 100, status: "completed",
          result: { videos: [{ url: ["https://cdn.example/real-video.mp4"], expires_at: 1787722735 }] },
        },
      },
    })).resolves.toMatchObject({ outputs: [
      { kind: "video", url: "https://cdn.example/real-video.mp4", providerOutputId: "video-1" },
    ] });
  });
});
