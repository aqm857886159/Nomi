import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogState } from "./types";
import {
  sanitizeRendererMappingMutation,
  sanitizeRendererModelMutation,
  sanitizeRendererVendorMutation,
  sanitizeRendererVendorApiKeyMutation,
  sanitizeRendererCatalogImport,
  upsertRendererCatalogVendorApiKey,
} from "./rendererCatalogMutation";
import * as store from "./catalogStore";

vi.mock("./catalogStore", async (importActual) => {
  const actual = await importActual<typeof import("./catalogStore")>();
  return {
    ...actual,
    readCatalog: vi.fn(),
    upsertModelCatalogVendorApiKey: vi.fn((vendorKey: string, payload: unknown) => ({ vendorKey, payload })),
    upsertModelCatalogVendor: vi.fn((payload: unknown) => payload),
  };
});

function state(): CatalogState {
  return {
    version: 1,
    revision: 1,
    vendors: [{ key: "relay", name: "Relay", enabled: false, authType: "bearer", createdAt: "", updatedAt: "" }],
    models: [
      {
        vendorKey: "relay",
        modelKey: "image-1",
        labelZh: "Image",
        kind: "image",
        enabled: false,
        meta: { adapter: { state: "testing", modes: [{ taskKind: "text_to_image", state: "failed" }] } },
        createdAt: "",
        updatedAt: "",
      },
    ],
    mappings: [],
    apiKeysByVendor: { relay: { apiKey: "encrypted", enabled: true, createdAt: "", updatedAt: "" } },
  } as unknown as CatalogState;
}

describe("renderer Catalog mutation boundary", () => {
  afterEach(() => {
    vi.mocked(store.upsertModelCatalogVendorApiKey).mockClear();
    vi.mocked(store.upsertModelCatalogVendor).mockClear();
    vi.mocked(store.readCatalog).mockReset();
  });

  it("cannot raw-enable or forge publication for an uncertified adapter vendor/model/mapping", () => {
    const catalog = state();
    const vendor = sanitizeRendererVendorMutation(
      { key: "relay", enabled: true, meta: { adapter: { activeRevision: "forged" } } },
      catalog,
    );
    const model = sanitizeRendererModelMutation(
      {
        vendorKey: "relay",
        modelKey: "image-1",
        enabled: true,
        meta: { adapter: { activeRevision: "forged", modes: [{ taskKind: "text_to_image", state: "verified" }] } },
      },
      catalog,
    );
    const mapping = sanitizeRendererMappingMutation(
      {
        id: "raw",
        vendorKey: "relay",
        modelKey: "image-1",
        taskKind: "text_to_image",
        enabled: true,
        create: { method: "POST", path: "/generate" },
      },
      catalog,
    );

    expect(vendor.enabled).toBe(false);
    expect((vendor.meta as Json | undefined)?.adapter).toBeUndefined();
    expect(model.enabled).toBe(false);
    expect((model.meta as { adapter: unknown }).adapter).toEqual(
      (catalog.models[0].meta as { adapter: unknown }).adapter,
    );
    expect(mapping.enabled).toBe(false);
  });

  it("stages a renderer-created model as unverified even when adapter metadata is omitted", () => {
    const catalog = state();
    catalog.models = [];
    const model = sanitizeRendererModelMutation(
      {
        vendorKey: "relay",
        modelKey: "new-image",
        labelZh: "New",
        kind: "image",
        enabled: true,
      },
      catalog,
    );
    expect(model.enabled).toBe(false);
    expect(model.meta).toMatchObject({ adapter: { state: "unverified", modes: [] } });
  });

  it("never promotes a vendor while a renderer saves its API key", () => {
    expect(sanitizeRendererVendorApiKeyMutation({ apiKey: "sk-test", enabled: true })).toEqual({
      apiKey: "sk-test",
      enabled: false,
    });
  });

  it("imports renderer packages as unverified drafts instead of trusting serialized publication state", () => {
    const sanitized = sanitizeRendererCatalogImport({
      vendors: [
        {
          vendor: { key: "relay", enabled: true },
          models: [
            { vendorKey: "relay", modelKey: "image", enabled: true, meta: { adapter: { activeRevision: "forged" } } },
          ],
          mappings: [{ vendorKey: "relay", modelKey: "image", taskKind: "text_to_image", enabled: true }],
        },
      ],
    });
    expect(sanitized).toMatchObject({
      vendors: [
        {
          vendor: { enabled: false },
          models: [{ enabled: false, meta: { adapter: { state: "unverified", modes: [] } } }],
          mappings: [{ enabled: false }],
        },
      ],
    });
  });

  it("writes the credential disabled-pending-certification and delegates the vendor de-publish to the store", () => {
    // The reported honesty gap — a credential written disabled-pending-certification beside an
    // enabled vendor, which the model home reads as 已接入 / N 个可使用 while resolveTextBrainKeys
    // (needs an enabled credential) returns null — is prevented one layer down, inside
    // applyApiKeyUpsert (see credentialPublication.ts + credentialPublication.test.ts). That is the
    // innermost boundary every credential writer shares, and it de-publishes in the SAME
    // writeCatalog. This boundary must therefore NOT issue a second vendor write of its own.
    const catalog = state();
    catalog.vendors[0] = { ...catalog.vendors[0], enabled: true } as never;
    vi.mocked(store.readCatalog).mockReturnValue(catalog);

    upsertRendererCatalogVendorApiKey("relay", { apiKey: "sk-test", enabled: true });

    expect(store.upsertModelCatalogVendorApiKey).toHaveBeenCalledWith("relay", { apiKey: "sk-test", enabled: false });
    expect(store.upsertModelCatalogVendor).not.toHaveBeenCalled();
  });

  it("rejects security-scope edits on certification-owned connections", () => {
    const catalog = state();
    catalog.vendors[0] = {
      ...catalog.vendors[0],
      enabled: true,
      baseUrlHint: "https://old.example/v1",
      meta: { adapter: { activeRevision: "revision-old" } },
    } as never;

    expect(() => sanitizeRendererVendorMutation(
      { key: "relay", baseUrlHint: "https://new.example/v1" },
      catalog,
    )).toThrow(/integration|certification|connection/i);
  });
});

type Json = Record<string, unknown>;
