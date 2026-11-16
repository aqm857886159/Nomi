import fs from "node:fs";
import { describe, expect, it } from "vitest";

import type { GenerationProviderBootstrap } from "./generationProviderBootstrap";
import type { CatalogState } from "../catalog/types";
import { createLiveGenerationRuntime } from "./liveGenerationRuntime";

function catalog(marker: string): CatalogState {
  return {
    version: 1,
    vendors: [],
    models: [],
    mappings: [],
    apiKeysByVendor: {},
    // The test-only marker lets the fake factories make the change visible
    // without ever constructing a credential or touching the OS keychain.
    ...(marker ? ({ meta: { marker } } as never) : {}),
  };
}

function fakeBootstrap(state: CatalogState): GenerationProviderBootstrap {
  const marker = (state as CatalogState & { meta?: { marker?: string } }).meta?.marker;
  return {
    providers: marker === "connected" ? [{ providerId: "apimart", capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false }, buildRequest: () => ({}), submit: async () => ({ providerTaskId: "fixture" }) }] : [],
    readinessByProvider: { apimart: { providerReady: marker === "connected", capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false }, ...(marker === "connected" ? {} : { missingForSubmit: ["configured_provider"] }) } },
  };
}

describe("live generation runtime", () => {
  it("captures readiness and registry together for each draft scope", () => {
    let current = catalog("empty");
    const runtime = createLiveGenerationRuntime({
      catalogReader: () => current,
      bootstrap: fakeBootstrap,
      registry: (_state, readiness) => ({
        resolve: () => ({
          moduleId: "generation.single-shot",
          version: "fixture",
          providerId: "apimart",
          modelId: "fixture-model",
          mode: "text-to-image",
          inputKinds: ["image"],
          outputKinds: ["image"],
          parameterSchema: {},
          assetInputSchema: { references: { kind: "asset" } },
          capabilities: readiness.apimart?.capabilities ?? { submitIdempotency: false, query: false, reconcile: false, cancel: false },
        }),
        snapshot: () => [],
      }),
    });

    expect(runtime.readBootstrap().providers).toHaveLength(0);
    expect(runtime.readBootstrap().readinessByProvider.apimart?.providerReady).toBe(false);

    current = catalog("connected");
    expect(runtime.readBootstrap().providers).toHaveLength(1);
    expect(runtime.readBootstrap().readinessByProvider.apimart?.providerReady).toBe(true);
    expect(runtime.registry.resolve({ moduleId: "generation.single-shot", providerId: "apimart", modelId: "fixture-model", mode: "text-to-image" }).capabilities.query).toBe(true);
  });

  it("一次工具调用只读一版目录：调用中途目录变了，调用里的模型表和就绪都不变；下一次调用读新版；调用里起的后台活过后读现在的", async () => {
    let current = catalog("empty");
    let token: object = {};
    let registryBuilds = 0;
    const runtime = createLiveGenerationRuntime({
      catalogReader: () => current,
      catalogRevision: () => token,
      bootstrap: fakeBootstrap,
      registry: (_state, readiness) => {
        registryBuilds += 1;
        return {
          resolve: () => ({
            moduleId: "generation.single-shot",
            version: "fixture",
            providerId: "apimart",
            modelId: "fixture-model",
            mode: "text-to-image",
            inputKinds: ["image"],
            outputKinds: ["image"],
            parameterSchema: {},
            assetInputSchema: { references: { kind: "asset" } },
            // 「这一版认不认得」：没连上的那版 query=false
            capabilities: { submitIdempotency: false, query: readiness.apimart?.providerReady === true, reconcile: false, cancel: false },
          }),
          snapshot: () => [],
        };
      },
    });

    const request = { moduleId: "generation.single-shot", providerId: "apimart", modelId: "fixture-model", mode: "text-to-image" } as const;
    const changeCatalog = (marker: string) => { current = catalog(marker); token = {}; };
    let background: Promise<boolean> | undefined;

    const during = await runtime.registry.pinForCall(async () => {
      const before = runtime.registry.resolve(request).capabilities.query;
      changeCatalog("connected"); // 交卡 / 存密钥正好落在这次调用中间
      await Promise.resolve();
      const after = runtime.registry.resolve(request).capabilities.query;
      const ready = runtime.readBootstrap().readinessByProvider.apimart?.providerReady;
      // 嵌套再进一次工具：沿用外层那一版
      const nested = await runtime.registry.pinForCall(async () => runtime.readBootstrap().readinessByProvider.apimart?.providerReady);
      background = new Promise((resolve) => setTimeout(() => resolve(runtime.readBootstrap().readinessByProvider.apimart?.providerReady === true), 0));
      return { before, after, ready, nested };
    });
    expect(during).toEqual({ before: false, after: false, ready: false, nested: false });
    expect(registryBuilds).toBe(1);

    expect(await background).toBe(true); // 调用结束后才跑的后台活读现在的目录
    expect(await runtime.registry.pinForCall(async () => runtime.registry.resolve(request).capabilities.query)).toBe(true);
    expect(registryBuilds).toBe(2);
  });

  it("门读的那一份表按目录这一版答：同一版只算一次，目录一变下一次问就是新表", () => {
    let current = catalog("empty");
    let token: object = {};
    let registryBuilds = 0;
    const runtime = createLiveGenerationRuntime({
      catalogReader: () => current,
      catalogRevision: () => token,
      bootstrap: fakeBootstrap,
      registry: (state) => {
        registryBuilds += 1;
        const marker = (state as CatalogState & { meta?: { marker?: string } }).meta?.marker;
        return {
          resolve: (input) => {
            if (marker !== "connected") throw new Error(`Unknown model: ${input.modelId}`);
            return {
              moduleId: "generation.single-shot", version: "fixture", providerId: "apimart", modelId: input.modelId, mode: "text-to-image",
              inputKinds: ["image"], outputKinds: ["image"], parameterSchema: {}, assetInputSchema: { references: { kind: "asset" } },
              capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false },
            };
          },
          snapshot: () => [],
        };
      },
    });
    const ask = () => runtime.registry.resolve({ moduleId: "generation.single-shot", providerId: "apimart", modelId: "declared-after-start", mode: "text-to-image" });

    expect(ask).toThrow(/Unknown model/);
    expect(ask).toThrow(/Unknown model/);
    expect(registryBuilds).toBe(1);

    // 宿主早就起来了；Agent 这时交卡 / 存密钥，目录换了一版。不重启，门的下一次问就认得。
    current = catalog("connected");
    token = {};
    expect(ask().modelId).toBe("declared-after-start");
    expect(registryBuilds).toBe(2);
  });

  it("两个宿主都把这一份活表交给生成工具，不在启动时自己拍快照", () => {
    for (const host of ["appIntegration.ts", "mcpStdioServer.ts"]) {
      const source = fs.readFileSync(new URL(`./${host}`, import.meta.url), "utf8");
      expect(source, host).toContain("registry: liveGenerationRuntime.registry");
      expect(source, host).not.toMatch(/createDraftScope\(\)\.registry/);
    }
  });

});
