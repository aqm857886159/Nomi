import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogState, Mapping, Model, Vendor } from "./types";

const state = vi.hoisted(() => ({ catalog: null as CatalogState | null }));

vi.mock("./catalogStore", async (importOriginal) => ({
  ...await importOriginal<typeof import("./catalogStore")>(),
  readCatalog: () => state.catalog,
}));

vi.mock("../runtime", async () => {
  const { buildProfileHttpRequest } = await import("./profileHttpRequest");
  return {
    billingKindForTaskKind: () => "image",
    buildProfileHttpRequest,
    buildProfileTaskResult: vi.fn(),
    executeProfileOperation: vi.fn(),
    findExecutableModelForTask: () => {
      const catalog = state.catalog!;
      return {
        vendor: catalog.vendors[0],
        model: catalog.models[0],
        apiKey: "opaque+Credential/Value=987654%",
      };
    },
  };
});

import { testModelCatalogMapping } from "./catalogCommit";
import { buildProfileHttpRequest } from "./profileHttpRequest";
import { requestJson } from "../vendor/vendorHttp";

describe("testModelCatalogMapping request redaction", () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    const customHeaderSecret = "SENTINEL-CUSTOM-HEADER-SECRET";
    const randomHeaderSecret = "RANDOM-NAMED-HEADER-SECRET";
    const vendor = {
      key: "relay",
      name: "Relay",
      enabled: true,
      authType: "query",
      authQueryParam: "access_token",
      baseUrlHint: "https://relay.example/v1",
      meta: {
        extraHeaders: {
          "X-Workspace": customHeaderSecret,
          "X-Random-Gateway-Field": randomHeaderSecret,
        },
      },
      createdAt: "",
      updatedAt: "",
    } satisfies Vendor;
    const model = {
      vendorKey: vendor.key,
      modelKey: "image-model",
      labelZh: "Image",
      kind: "image",
      enabled: true,
      createdAt: "",
      updatedAt: "",
    } satisfies Model;
    const mapping = {
      id: "relay:image-model:text_to_image",
      vendorKey: vendor.key,
      modelKey: model.modelKey,
      taskKind: "text_to_image",
      name: "Image smoke test",
      enabled: true,
      create: {
        method: "GET",
        path: "/generate",
        headers: { "X-Custom-Credential": "{{user_api_key}}" },
        query: { credential: "{{user_api_key}}", ordinary: "ordinary-marker" },
      },
      createdAt: "",
      updatedAt: "",
    } satisfies Mapping;
    state.catalog = { version: 11, vendors: [vendor], models: [model], mappings: [mapping], apiKeysByVendor: {} };
  });

  it("never returns raw or outbound-encoded header/query credentials in the mapping test DTO", async () => {
    const secret = "opaque+Credential/Value=987654%";
    const customHeaderSecret = "SENTINEL-CUSTOM-HEADER-SECRET";
    const randomHeaderSecret = "RANDOM-NAMED-HEADER-SECRET";
    const result = await testModelCatalogMapping("relay:image-model:text_to_image", { execute: false });
    const serialized = JSON.stringify(result);

    expect(serialized).toContain("ordinary-marker");
    for (const value of [secret, customHeaderSecret, randomHeaderSecret]) {
      expect(serialized).not.toContain(value);
      expect(serialized).not.toContain(encodeURIComponent(value));
      expect(serialized).not.toContain(new URLSearchParams({ credential: value }).toString().slice("credential=".length));
    }
  });

  it("keeps the custom auth query name identical in the actual request and redacted preview", async () => {
    const vendor = state.catalog!.vendors[0];
    const model = state.catalog!.models[0];
    const operation = state.catalog!.mappings[0].create;
    const secret = "opaque+Credential/Value=987654%";
    const built = buildProfileHttpRequest({
      vendor,
      model,
      apiKey: secret,
      request: { kind: "text_to_image", prompt: "test", extras: {} } as never,
      operation,
    });

    const preview = built.preview as { url: string };
    expect(preview.url).toContain("access_token=");
    expect(preview.url).not.toContain(secret);
    expect(preview.url).not.toContain(encodeURIComponent(secret));

    const fetchSpy = vi.fn(async (_input: string | URL | Request) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await requestJson(vendor, secret, built.method, built.url, built.headers, built.query, built.body);
    const actualUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(actualUrl.searchParams.get("access_token")).toBe(secret);
    expect(actualUrl.searchParams.get("api_key")).toBeNull();
  });
});
