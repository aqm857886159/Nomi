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

beforeAll(async () => {
  noAuthServer = http.createServer((req, res) => {
    observedAuthorization = req.headers.authorization;
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
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
      displayName: "Local model",
      kind: "text",
      enabled: true,
      capabilities: {},
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
