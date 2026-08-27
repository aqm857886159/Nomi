import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Model, Vendor } from "../catalog/types";
import { ProviderAdapterService, type ProviderAdapterCatalogPort } from "./service";
import { ProviderAdapterStore } from "./store";

const dirs: string[] = [];
const now = "2026-08-15T00:00:00.000Z";

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function store(): ProviderAdapterStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-adapter-registration-"));
  dirs.push(dir);
  return new ProviderAdapterStore(path.join(dir, "provider-adapters.json"));
}

describe("provider connection save-first registration", () => {
  it("keeps an unverified replacement in registration staging while the catalog returns the active contract", () => {
    const catalog: ProviderAdapterCatalogPort = {
      register: vi.fn((input: Parameters<ProviderAdapterCatalogPort["register"]>[0]) => ({
        vendor: {
          key: input.vendorKey,
          name: input.vendorName,
          enabled: true,
          authType: "none" as const,
          createdAt: now,
          updatedAt: now,
        },
        models: [{
          vendorKey: input.vendorKey,
          modelKey: "same-model",
          labelZh: "Published image",
          kind: "image" as const,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        }],
      })),
      stage: vi.fn(() => { throw new Error("not used"); }),
      load: vi.fn(() => null),
      promote: vi.fn(() => ({ status: "no-lease" as const })),
      fail: vi.fn(),
    };

    const registration = new ProviderAdapterService(store(), {
      catalog,
      schedule: vi.fn(),
      discover: vi.fn(),
      resolveLanguageModels: vi.fn(() => []),
      compile: vi.fn(),
      repair: vi.fn(),
      verify: vi.fn(),
      now: () => now,
      id: vi.fn(),
    }).register({
      vendorName: "Relay",
      baseUrl: "https://relay.example.test/v1",
      apiKey: "",
      authType: "none",
      models: [{ modelKey: "same-model", labelZh: "Replacement video", kind: "video" }],
    });

    expect(registration.models).toEqual([{
      modelKey: "same-model",
      labelZh: "Replacement video",
      kind: "video",
      state: "unverified",
    }]);
  });

  it("persists a configured connection with no models and starts no background work", () => {
    const register = vi.fn((input: Parameters<ProviderAdapterCatalogPort["register"]>[0]) => ({
      vendor: {
        key: input.vendorKey,
        name: input.vendorName,
        enabled: true,
        baseUrlHint: input.baseUrl,
        authType: input.authType,
        createdAt: input.savedAt,
        updatedAt: input.savedAt,
      } as Vendor,
      models: [] as Model[],
    }));
    const schedule = vi.fn();
    const catalog: ProviderAdapterCatalogPort = {
      register,
      stage: vi.fn(() => { throw new Error("stage must not run while saving"); }),
      load: vi.fn(() => null),
      promote: vi.fn(() => ({ status: "no-lease" as const })),
      fail: vi.fn(),
    };
    const adapterStore = store();
    const service = new ProviderAdapterService(adapterStore, {
      catalog,
      schedule,
      discover: vi.fn(async () => { throw new Error("discover must not run"); }),
      resolveLanguageModels: vi.fn(() => []),
      compile: vi.fn(async () => { throw new Error("compile must not run"); }),
      repair: vi.fn(async () => { throw new Error("repair must not run"); }),
      verify: vi.fn(async () => { throw new Error("verify must not run"); }),
      now: () => now,
      id: vi.fn(() => { throw new Error("id must not be allocated"); }),
    });

    const registration = service.register({
      vendorName: "Saved before discovery",
      baseUrl: "https://gateway.example.test/v1",
      apiKey: "sk-local-only",
      authType: "bearer",
      providerKind: "openai-compatible",
      models: [],
    });

    expect(registration).toMatchObject({
      vendorKey: "gateway-example-test",
      state: "configured",
      selectedModelKeys: [],
      models: [],
    });
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ models: [] }));
    expect(schedule).not.toHaveBeenCalled();
    expect(adapterStore.snapshot().runs).toEqual([]);
  });

  it("persists 20 configured models without starting any adaptation work", () => {
    const register = vi.fn((input: Parameters<ProviderAdapterCatalogPort["register"]>[0]) => {
      const vendor: Vendor = {
        key: input.vendorKey,
        name: input.vendorName,
        enabled: true,
        baseUrlHint: input.baseUrl,
        authType: input.authType,
        providerKind: input.providerKind,
        createdAt: input.savedAt,
        updatedAt: input.savedAt,
      };
      const models: Model[] = input.models.map((model) => ({
        vendorKey: input.vendorKey,
        modelKey: model.modelKey,
        labelZh: model.labelZh || model.modelKey,
        kind: model.kind,
        enabled: true,
        meta: { adapter: { state: "unverified", modes: [], updatedAt: input.savedAt } },
        createdAt: input.savedAt,
        updatedAt: input.savedAt,
      }));
      return { vendor, models };
    });
    const stage = vi.fn(() => { throw new Error("stage must not run while saving"); });
    const schedule = vi.fn(() => { throw new Error("scheduler must not run while saving"); });
    const discover = vi.fn(async () => { throw new Error("docs must not run while saving"); });
    const resolveLanguageModels = vi.fn(() => { throw new Error("AI resolution must not run while saving"); });
    const compile = vi.fn(async () => { throw new Error("compiler must not run while saving"); });
    const repair = vi.fn(async () => { throw new Error("repair must not run while saving"); });
    const verify = vi.fn(async () => { throw new Error("real verification must not run while saving"); });
    const catalog: ProviderAdapterCatalogPort = {
      register,
      stage,
      load: vi.fn(() => null),
      promote: vi.fn(() => { throw new Error("promotion must not run while saving"); }),
      fail: vi.fn(() => { throw new Error("failure publication must not run while saving"); }),
    };
    const adapterStore = store();
    const service = new ProviderAdapterService(adapterStore, {
      catalog,
      schedule,
      discover,
      resolveLanguageModels,
      compile,
      repair,
      verify,
      now: () => now,
      id: vi.fn(() => { throw new Error("run id must not be allocated while saving"); }),
    });
    const models = Array.from({ length: 20 }, (_, index) => ({
      modelKey: `new-model-${index + 1}`,
      labelZh: `New model ${index + 1}`,
      kind: index % 2 === 0 ? "image" as const : "video" as const,
    }));

    const registration = service.register({
      vendorName: "Generic Gateway",
      baseUrl: "https://gateway.example.test/v1/",
      apiKey: "sk-stays-in-main",
      authType: "bearer",
      providerKind: "openai-compatible",
      models,
    });

    expect(registration).toMatchObject({
      vendorKey: "gateway-example-test",
      vendorName: "Generic Gateway",
      state: "configured",
      selectedModelKeys: models.map((model) => model.modelKey),
      models: models.map((model) => expect.objectContaining({
        modelKey: model.modelKey,
        state: "unverified",
      })),
      savedAt: now,
    });
    expect(JSON.stringify(registration)).not.toContain("sk-stays-in-main");
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: "https://gateway.example.test/v1",
      models,
    }));
    expect(adapterStore.snapshot().runs).toEqual([]);
    for (const dependency of [stage, schedule, discover, resolveLanguageModels, compile, repair, verify]) {
      expect(dependency).not.toHaveBeenCalled();
    }
  });
});
