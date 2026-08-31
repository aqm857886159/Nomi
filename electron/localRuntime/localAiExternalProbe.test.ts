import { describe, expect, it, vi } from "vitest";

import {
  probeLocalAiExternalRuntime,
  type LocalAiProbeFetch,
} from "./localAiExternalProbe";

function reply(status: number, body: unknown = ""): Awaited<ReturnType<LocalAiProbeFetch>> {
  return {
    status,
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

type MockLocalAiProbeFetch = ReturnType<typeof vi.fn<LocalAiProbeFetch>>;

function fetchSequence(...responses: Array<Awaited<ReturnType<LocalAiProbeFetch>>>): MockLocalAiProbeFetch {
  return vi.fn<LocalAiProbeFetch>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return next;
  });
}

describe("probeLocalAiExternalRuntime", () => {
  it("uses the LocalAI 4.9 discovery contract and keeps credentials off public probes", async () => {
    const fetch = fetchSequence(
      reply(200, {
        version: "v4.9.0",
        endpoints: {
          models: "/v1/models",
          models_capabilities: "/v1/models/capabilities",
        },
        capabilities: { mcp: true },
      }),
      reply(200),
      reply(200, {
        object: "list",
        data: [
          {
            id: "qwen-omni",
            object: "model",
            capabilities: ["chat", "vision", "tools"],
            input_modalities: ["text", "image", "audio"],
            output_modalities: ["text"],
          },
          {
            id: "shape-model",
            object: "model",
            capabilities: ["3d"],
            input_modalities: ["image"],
            output_modalities: [],
          },
        ],
      }),
    );

    const descriptor = await probeLocalAiExternalRuntime({
      baseUrl: "http://127.0.0.1:8080/v1/",
      apiKey: "local-secret",
      authScope: "user",
    }, { fetch, now: () => "2026-08-30T12:00:00.000Z" });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.map(([request]) => request.url)).toEqual([
      "http://127.0.0.1:8080/.well-known/localai.json",
      "http://127.0.0.1:8080/readyz",
      "http://127.0.0.1:8080/v1/models/capabilities",
    ]);
    expect(fetch.mock.calls[0][0].headers).toEqual({});
    expect(fetch.mock.calls[1][0].headers).toEqual({});
    expect(fetch.mock.calls[2][0].headers).toEqual({ authorization: "Bearer local-secret" });
    expect(descriptor).toMatchObject({
      schemaVersion: 1,
      deployment: "external",
      kind: "localai",
      origin: "http://127.0.0.1:8080",
      apiBaseUrl: "http://127.0.0.1:8080/v1",
      version: "v4.9.0",
      identity: "confirmed",
      health: "ready",
      auth: { mode: "api-key", scope: "user" },
      certification: "uncertified",
      checkedAt: "2026-08-30T12:00:00.000Z",
    });
    expect(descriptor.runtimeId).toMatch(/^localai:[a-f0-9]{16}$/);
    expect(descriptor.capabilities).toEqual([
      {
        modelId: "qwen-omni",
        outputs: ["text"],
        inputModes: ["text", "image", "audio"],
        supports: ["tools"],
        evidence: {
          source: "discovery",
          endpoint: "/v1/models/capabilities",
          checkedAt: "2026-08-30T12:00:00.000Z",
        },
      },
      {
        modelId: "shape-model",
        outputs: ["model3d"],
        inputModes: ["image"],
        supports: [],
        evidence: {
          source: "discovery",
          endpoint: "/v1/models/capabilities",
          checkedAt: "2026-08-30T12:00:00.000Z",
        },
      },
    ]);
  });

  it("falls back to the OpenAI model list for older LocalAI versions without inventing capabilities", async () => {
    const fetch = fetchSequence(
      reply(404),
      reply(404),
      reply(200, { version: "v3.9.0" }),
      reply(404),
      reply(200, { object: "list", data: [{ id: "legacy-chat" }] }),
    );

    const descriptor = await probeLocalAiExternalRuntime(
      { baseUrl: "http://localhost:8080", authHeader: "x-api-key", apiKey: "legacy-key" },
      { fetch, now: () => "2026-08-30T12:00:00.000Z" },
    );

    expect(fetch.mock.calls.map(([request]) => request.url)).toEqual([
      "http://localhost:8080/.well-known/localai.json",
      "http://localhost:8080/readyz",
      "http://localhost:8080/version",
      "http://localhost:8080/v1/models/capabilities",
      "http://localhost:8080/v1/models",
    ]);
    expect(fetch.mock.calls.slice(2).every(([request]) => request.headers["x-api-key"] === "legacy-key")).toBe(true);
    expect(descriptor).toMatchObject({
      version: "v3.9.0",
      identity: "assumed",
      health: "ready",
      capabilities: [{
        modelId: "legacy-chat",
        outputs: [],
        inputModes: [],
        supports: [],
      }],
    });
  });

  it("reports a ready server with rejected model credentials as unauthorized", async () => {
    const fetch = fetchSequence(
      reply(200, { version: "v4.9.0", endpoints: { models_capabilities: "/v1/models/capabilities" } }),
      reply(200),
      reply(401, { error: "invalid key" }),
    );

    const descriptor = await probeLocalAiExternalRuntime(
      { baseUrl: "https://localai.example/v1", apiKey: "bad" },
      { fetch },
    );

    expect(descriptor.health).toBe("unauthorized");
    expect(descriptor.capabilities).toEqual([]);
    expect(descriptor.diagnostics).toContainEqual({
      stage: "capabilities",
      code: "unauthorized",
      status: 401,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("keeps readiness distinct from liveness while startup preload is in progress", async () => {
    const fetch = fetchSequence(
      reply(200, { version: "v4.9.0", endpoints: { models_capabilities: "/v1/models/capabilities" } }),
      reply(503, { status: "starting", reason: "startup preload in progress" }),
      reply(200, { object: "list", data: [] }),
    );

    const descriptor = await probeLocalAiExternalRuntime(
      { baseUrl: "http://127.0.0.1:8080" },
      { fetch },
    );

    expect(descriptor.health).toBe("degraded");
    expect(descriptor.diagnostics).toContainEqual({
      stage: "readiness",
      code: "starting",
      status: 503,
    });
  });

  it("degrades on malformed capability JSON but still returns the safe model-list fallback", async () => {
    const fetch = fetchSequence(
      reply(200, { version: "v4.9.0", endpoints: { models_capabilities: "/v1/models/capabilities" } }),
      reply(200),
      reply(200, "<html>not json</html>"),
      reply(200, { object: "list", data: [{ id: "fallback" }] }),
    );

    const descriptor = await probeLocalAiExternalRuntime(
      { baseUrl: "http://127.0.0.1:8080" },
      { fetch },
    );

    expect(descriptor.health).toBe("degraded");
    expect(descriptor.capabilities.map((item) => item.modelId)).toEqual(["fallback"]);
    expect(descriptor.diagnostics).toContainEqual({
      stage: "capabilities",
      code: "invalid_response",
      status: 200,
    });
  });

  it("never follows a cross-origin endpoint advertised by the discovery document", async () => {
    const fetch = fetchSequence(
      reply(200, {
        version: "v4.9.0",
        endpoints: { models_capabilities: "https://attacker.example/steal" },
      }),
      reply(200),
      reply(200, { object: "list", data: [] }),
    );

    await probeLocalAiExternalRuntime(
      { baseUrl: "https://localai.example/v1", apiKey: "do-not-leak" },
      { fetch },
    );

    expect(fetch.mock.calls.map(([request]) => request.url)).not.toContain("https://attacker.example/steal");
    expect(fetch.mock.calls[2][0]).toMatchObject({
      url: "https://localai.example/v1/models/capabilities",
      headers: { authorization: "Bearer do-not-leak" },
    });
  });

  it("reports offline without returning raw network errors or secrets", async () => {
    const fetch = vi.fn(async () => { throw new Error("connect failed with secret-token"); });
    const descriptor = await probeLocalAiExternalRuntime(
      { baseUrl: "http://127.0.0.1:8080", apiKey: "secret-token" },
      { fetch },
    );

    expect(descriptor.health).toBe("offline");
    expect(descriptor.capabilities).toEqual([]);
    expect(JSON.stringify(descriptor)).not.toContain("secret-token");
    expect(descriptor.diagnostics.every((item) => item.code === "network")).toBe(true);
  });

  it.each([
    "file:///tmp/localai",
    "http://user:password@localhost:8080",
    "http://localhost:8080/v1?token=secret",
  ])("rejects an unsafe LocalAI base URL: %s", async (baseUrl) => {
    await expect(probeLocalAiExternalRuntime({ baseUrl }, { fetch: vi.fn() })).rejects.toThrow("Invalid LocalAI address");
  });
});
