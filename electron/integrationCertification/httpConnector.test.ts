import { describe, expect, it, vi } from "vitest";
import {
  HttpProviderConnector,
  buildHttpDiscoveryRequests,
  buildHttpProductionRequest,
} from "./httpConnector";

const connection = {
  vendorName: "Example",
  baseUrl: "https://api.example.test/v1",
  apiKey: "secret",
  authType: "bearer" as const,
  providerKind: "openai-compatible" as const,
  models: [{ modelKey: "image-v1", kind: "image" as const }],
};
const certification = {
  contractDigest: "a".repeat(64),
  idempotencyKey: "http-connector-test",
  remoteIdempotency: "unknown" as const,
};

describe("HttpProviderConnector", () => {
  it("delegates configure/start/get/cancel instead of duplicating Provider Adapter logic", async () => {
    const primitives = {
      register: vi.fn(() => ({ state: "configured" })),
      start: vi.fn(async () => ({ id: "run-1" })),
      getRun: vi.fn(() => ({ id: "run-1" })),
      latestRun: vi.fn(() => ({ id: "run-1" })),
      cancel: vi.fn(() => ({ id: "run-1", stage: "cancelled" })),
      deleteRun: vi.fn(() => ({ id: "run-1", stage: "failed" })),
      listRuns: vi.fn(() => [{ id: "run-1" }]),
      resumeInterrupted: vi.fn(),
    };
    const connector = new HttpProviderConnector(primitives as never);

    expect(connector.configure(connection)).toEqual({ state: "configured" });
    await expect(connector.start({ ...connection, certification })).resolves.toEqual({ id: "run-1" });
    expect(connector.get("run-1")).toEqual({ id: "run-1" });
    expect(connector.cancel("run-1")).toEqual({ id: "run-1", stage: "cancelled" });
    expect(connector.deleteRun("run-1")).toEqual({ id: "run-1", stage: "failed" });
    expect(connector.list({ limit: 5 })).toEqual([{ id: "run-1" }]);
  });

  it("exposes LocalAI discovery through the existing HTTP connector without probing other protocols", async () => {
    const probe = vi.fn(async () => ({ kind: "localai", health: "ready" }));
    const connector = new HttpProviderConnector({} as never, undefined, probe as never);

    await expect(connector.probeExternalLocalRuntime({
      baseUrl: "http://127.0.0.1:8080/v1",
      providerKind: "openai-compatible",
      authType: "bearer",
      apiKey: "secret",
    })).resolves.toMatchObject({ kind: "localai", health: "ready" });
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: "http://127.0.0.1:8080/v1",
      apiKey: "secret",
      authHeader: "authorization",
    }));

    await expect(connector.probeExternalLocalRuntime({
      baseUrl: "https://api.anthropic.com",
      providerKind: "anthropic",
      authType: "x-api-key",
      apiKey: "secret",
    })).resolves.toBeNull();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["https://gateway.test/v1", "https://gateway.test/v1/models", "https://gateway.test/v1/images/generations"],
    ["https://gateway.test/api/v3", "https://gateway.test/api/v3/models", "https://gateway.test/api/v3/images/generations"],
    ["https://gateway.test", "https://gateway.test/models", "https://gateway.test/v1/images/generations"],
    ["https://gateway.test/v1/", "https://gateway.test/v1/models", "https://gateway.test/v1/images/generations"],
  ])("uses the production request builder for discovery at %s", (baseUrl, expectedDiscovery, expectedProduction) => {
    const discovery = buildHttpDiscoveryRequests({
      baseUrl,
      providerKind: "openai-compatible",
      authType: "bearer",
      apiKey: "secret",
      headers: {},
    });
    const production = buildHttpProductionRequest({
      baseUrl,
      authType: "bearer",
      apiKey: "secret",
      context: {},
      operation: { method: "POST", path: "/v1/images/generations" },
    });

    expect(discovery[0].url).toBe(expectedDiscovery);
    expect(production.url).toBe(expectedProduction);
    expect(new Headers(discovery[0].headers).get("authorization")).toBe("Bearer secret");
    expect(new Headers(production.headers).get("authorization")).toBe("Bearer secret");
  });
});
