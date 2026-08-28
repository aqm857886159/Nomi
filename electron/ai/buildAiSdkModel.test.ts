import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { generateText } from "ai";
import { buildAiSdkModel } from "./buildAiSdkModel";
import { buildLanguageModelForVendor } from "./vendorLanguageModel";
import type { Model, Vendor } from "../catalog/types";

let noAuthServer: http.Server;
let noAuthBaseUrl = "";
let observedAuthorization: string | undefined;
let observedUrl: string | undefined;

beforeAll(async () => {
  noAuthServer = http.createServer((req, res) => {
    observedAuthorization = req.headers.authorization;
    observedUrl = req.url;
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url?.endsWith("/messages")) {
        res.end(JSON.stringify({
          id: "message-1", type: "message", role: "assistant", model: "local-model",
          content: [{ type: "text", text: "pong" }], stop_reason: "end_turn", stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }));
        return;
      }
      if (req.url?.endsWith("/responses")) {
        res.end(JSON.stringify({
          id: "response-1", created_at: 1, model: "local-model", status: "completed", incomplete_details: null,
          output: [{ id: "msg-1", type: "message", role: "assistant", status: "completed",
            content: [{ type: "output_text", text: "pong", annotations: [] }] }],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        }));
        return;
      }
      res.end(JSON.stringify({
        id: "local-response",
        object: "chat.completion",
        created: 1,
        model: "local-model",
        choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  await new Promise<void>((resolve) => noAuthServer.listen(0, "127.0.0.1", resolve));
  noAuthBaseUrl = `http://127.0.0.1:${(noAuthServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => noAuthServer.close(() => resolve()));
});

describe("buildAiSdkModel", () => {
  it("preserves the vendor-specific missing base diagnostic before API-key validation", () => {
    const vendor = { key: "missing-base", providerKind: "openai-compatible", baseUrlHint: "   " } as Vendor;
    const model = { modelKey: "local-model" } as Model;
    expect(() => buildLanguageModelForVendor(vendor, model, "")).toThrow("Base URL missing: missing-base");
  });

  it.each([
    ["", "/v1/chat/completions"],
    ["/", "/v1/chat/completions"],
    ["/v1", "/v1/chat/completions"],
    ["/v1/", "/v1/chat/completions"],
    ["/v1beta/openai", "/v1beta/openai/chat/completions"],
    ["/v1beta/openai/", "/v1beta/openai/chat/completions"],
    ["/api/v3", "/api/v3/chat/completions"],
    ["/api/paas/v4", "/api/paas/v4/chat/completions"],
    ["/custom/gateway", "/custom/gateway/chat/completions"],
  ])("keeps an explicit SDK API base %s without adding a version", async (suffix, expectedPath) => {
    const vendor: Vendor = {
      key: "endpoint-test", name: "Endpoint test", enabled: true, authType: "none",
      providerKind: "openai-compatible", baseUrlHint: `${noAuthBaseUrl}${suffix}`,
      createdAt: "2026-08-26T00:00:00Z", updatedAt: "2026-08-26T00:00:00Z",
    };
    const model: Model = {
      vendorKey: vendor.key, modelKey: "local-model", labelZh: "Local", kind: "text",
      enabled: true, createdAt: vendor.createdAt, updatedAt: vendor.updatedAt,
    };
    await generateText({ model: buildLanguageModelForVendor(vendor, model, ""), prompt: "ping", maxRetries: 0 });
    expect(observedUrl).toBe(expectedPath);
  });

  // anthropic 的两行都必须落在 `/v1/messages`：库里存的是 host root（onboarding 探测会剥掉尾随 /v1），
  // 而 @ai-sdk/anthropic 的 baseURL 必须自带版本段。此前第一行断言的是 `/messages`，把 bug 钉成了契约——
  // 连接检查过、画布 Agent 每次 404（2026-08-28 用户实测）。补 /v1 后两种存储形态都收敛到同一个端点，
  // 且已带 /v1 的不会被拼成 /v1/v1。
  it.each([
    ["anthropic", "", "/v1/messages"],
    ["anthropic", "/v1/", "/v1/messages"],
    ["openai-responses", "", "/v1/responses"],
    ["openai-responses", "/custom/v3/", "/custom/v3/responses"],
  ] as const)("preserves %s resource routing for %s", async (providerKind, suffix, expectedPath) => {
    const vendor: Vendor = {
      key: "endpoint-test", name: "Endpoint test", enabled: true, authType: "bearer",
      providerKind, baseUrlHint: `${noAuthBaseUrl}${suffix}`,
      createdAt: "2026-08-26T00:00:00Z", updatedAt: "2026-08-26T00:00:00Z",
    };
    const model: Model = {
      vendorKey: vendor.key, modelKey: "local-model", labelZh: "Local", kind: "text",
      enabled: true, createdAt: vendor.createdAt, updatedAt: vendor.updatedAt,
    };
    const result = await generateText({ model: buildLanguageModelForVendor(vendor, model, "test-key"), prompt: "ping", maxRetries: 0 });
    expect(result.text).toBe("pong");
    expect(observedUrl).toBe(expectedPath);
  });

  it("returns an openai-compatible language model for kind=openai-compatible", () => {
    const model = buildAiSdkModel({
      kind: "openai-compatible",
      baseURL: "https://api.chatfire.site/v1",
      apiKey: "test-key",
      modelId: "gpt-4o-mini",
    });
    // Vercel AI SDK exposes a stable shape on language models
    expect(model.specificationVersion).toBe("v1");
    expect(model.modelId).toBe("gpt-4o-mini");
    // openai-compatible providers expose a provider id derived from the
    // `name` passed to createOpenAICompatible (here: "nomi")
    expect(model.provider).toMatch(/^nomi/);
  });

  it("returns an anthropic language model for kind=anthropic", () => {
    const model = buildAiSdkModel({
      kind: "anthropic",
      baseURL: "",
      apiKey: "test-key",
      modelId: "claude-3-5-sonnet-latest",
    });
    expect(model.specificationVersion).toBe("v1");
    expect(model.modelId).toBe("claude-3-5-sonnet-latest");
    expect(model.provider).toMatch(/anthropic/);
  });

  it("accepts custom request headers without breaking model construction", () => {
    const model = buildAiSdkModel({
      kind: "openai-compatible",
      baseURL: "https://relay.example.com/v1",
      apiKey: "test-key",
      modelId: "gpt-4o-mini",
      headers: { "HTTP-Referer": "https://nomi.app", "X-Title": "Nomi", blank: "  " },
    });
    expect(model.modelId).toBe("gpt-4o-mini");

    const anthropic = buildAiSdkModel({
      kind: "anthropic",
      baseURL: "",
      apiKey: "test-key",
      modelId: "claude-3-5-sonnet-latest",
      headers: { "anthropic-beta": "prompt-caching-2024-07-31" },
    });
    expect(anthropic.modelId).toBe("claude-3-5-sonnet-latest");
  });

  it("throws when apiKey is missing", () => {
    expect(() =>
      buildAiSdkModel({
        kind: "openai-compatible",
        baseURL: "https://api.chatfire.site/v1",
        apiKey: "",
        modelId: "gpt-4o-mini",
      }),
    ).toThrow(/apiKey/);
  });

  it("runs an authType=none text gateway without sending Authorization", async () => {
    observedAuthorization = "not-called";
    const vendor: Vendor = {
      key: "local-gateway",
      name: "Local gateway",
      enabled: true,
      authType: "none",
      providerKind: "openai-compatible",
      baseUrlHint: noAuthBaseUrl,
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z",
    };
    const model: Model = {
      vendorKey: vendor.key,
      modelKey: "local-model",
      labelZh: "Local model",
      kind: "text",
      enabled: true,
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z",
    };

    const result = await generateText({
      model: buildLanguageModelForVendor(vendor, model, ""),
      prompt: "ping",
      maxRetries: 0,
    });

    expect(result.text).toBe("pong");
    expect(observedAuthorization).toBeUndefined();
  });

  it("requires baseURL for openai-compatible providers and accepts a custom one", () => {
    expect(() =>
      buildAiSdkModel({
        kind: "openai-compatible",
        baseURL: "",
        apiKey: "test-key",
        modelId: "gpt-4o-mini",
      }),
    ).toThrow(/baseURL/);

    const model = buildAiSdkModel({
      kind: "openai-compatible",
      baseURL: "https://custom.example.com/v1/",
      apiKey: "test-key",
      modelId: "gpt-4o-mini",
    });
    expect(model.modelId).toBe("gpt-4o-mini");
  });
});
