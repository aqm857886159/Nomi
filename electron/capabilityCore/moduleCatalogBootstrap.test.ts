import { describe, expect, it } from "vitest";

import { createCatalogModuleRegistry } from "./moduleCatalogBootstrap";
import type { CatalogState, Mapping, Model } from "../catalog/types";
import { GPT_IMAGE_2_T2I_CREATE_OP } from "../catalog/kieGptImage2";

function state(over: Partial<CatalogState>): CatalogState {
  return { version: 8, vendors: [], models: [], mappings: [], apiKeysByVendor: {}, ...over } as CatalogState;
}

function model(over: Partial<Model>): Model {
  return { modelKey: "image-model", vendorKey: "provider-a", labelZh: "Image", kind: "image", enabled: true, createdAt: "t", updatedAt: "t", ...over } as Model;
}

function mapping(over: Partial<Mapping>): Mapping {
  return { id: "mapping-1", vendorKey: "provider-a", modelKey: "image-model", taskKind: "text_to_image", name: "Image", enabled: true, create: { method: "POST", path: "/generate", body: {}, defaultParams: { aspectRatio: "16:9" } }, createdAt: "t", updatedAt: "t", ...over } as Mapping;
}

describe("createCatalogModuleRegistry", () => {
  it("derives provider/model/mode/parameter declarations from the user catalog", () => {
    const registry = createCatalogModuleRegistry(state({
      vendors: [
        { key: "provider-a", name: "Provider A", enabled: true, createdAt: "t", updatedAt: "t" },
        { key: "provider-b", name: "Provider B", enabled: true, createdAt: "t", updatedAt: "t" },
      ],
      models: [
        model({ modelKey: "image-model", vendorKey: "provider-a", onboarding: { addedVia: "manual", addedAt: "t", fields: [{ key: "aspectRatio", displayName: "Aspect", type: "select", options: [{ value: "1:1", label: "Square" }, { value: "16:9", label: "Wide" }], evidence: { field: "aspectRatio", evidence: "doc", evidence_location: "fixture", confidence: "high" as const } }] } }),
        model({ modelKey: "video-model", vendorKey: "provider-b", kind: "video" }),
      ],
      mappings: [mapping({}), mapping({ id: "mapping-2", vendorKey: "provider-b", modelKey: "video-model", taskKind: "image_to_video", create: { method: "POST", path: "/video", body: {} } })],
    }));
    const image = registry.resolve({ moduleId: "generation.single-shot", providerId: "provider-a", modelId: "image-model", mode: "text_to_image" });
    const video = registry.resolve({ moduleId: "generation.single-shot", providerId: "provider-b", modelId: "video-model", mode: "image_to_video" });
    expect(image.parameterSchema.aspectRatio).toMatchObject({ type: "enum", enum: ["1:1", "16:9"] });
    expect(video.mode).toBe("image_to_video");
    expect(video.capabilities).toEqual({ submitIdempotency: false, query: false, reconcile: false, cancel: false });
  });

  it("declares every parameter the mapping's own wire template references", () => {
    // 这是「付款卡改 2K，供应商收到 1k」的根因测试：合法参数表此前只从 onboarding.fields +
    // defaultParams 派生（真实目录里 165 个模型只有 3 个有前者、270 条 mapping 只有 12 条有后者），
    // 于是绝大多数模型的表是空的，用户改的每个参数都被 compileExecutionContract 当成「不支持」。
    // 权威来源是那条 mapping 自己的 create body——它引用了 `{{request.params.resolution}}`，
    // 这个键就发得出去，就是合法的。用的是真实内置目录里的 op，不是合成夹具。
    const registry = createCatalogModuleRegistry(state({
      vendors: [{ key: "kie", name: "kie", enabled: true, createdAt: "t", updatedAt: "t" }],
      models: [model({ vendorKey: "kie", modelKey: "gpt-image-2-text-to-image" })],
      mappings: [mapping({
        vendorKey: "kie",
        modelKey: "gpt-image-2-text-to-image",
        taskKind: "text_to_image",
        create: { ...GPT_IMAGE_2_T2I_CREATE_OP },
      })],
    }));
    const resolved = registry.resolve({
      moduleId: "generation.single-shot", providerId: "kie",
      modelId: "gpt-image-2-text-to-image", mode: "text_to_image",
    });
    expect(resolved.parameterSchema.resolution).toEqual({ type: "any" });
    expect(resolved.parameterSchema.aspect_ratio).toEqual({ type: "any" });
    // 线上模型名不是参数（wireModelIdentity 决定）：模板引用了它也不进参数表。
    expect(resolved.parameterSchema).not.toHaveProperty("model");
  });

  it("keeps the onboarding field's declared type and options over the bare wire key", () => {
    // 两个来源同时命中一个键时，**带类型与选项的那一份赢**——否则会把可枚举的控件降级成 any，
    // 等于把校验拱手让给供应商的 400。
    const registry = createCatalogModuleRegistry(state({
      vendors: [{ key: "kie", name: "kie", enabled: true, createdAt: "t", updatedAt: "t" }],
      models: [model({
        vendorKey: "kie", modelKey: "gpt-image-2-text-to-image",
        onboarding: { addedVia: "manual", addedAt: "t", fields: [{ key: "resolution", displayName: "Resolution", type: "select", options: [{ value: "1K", label: "1K" }, { value: "2K", label: "2K" }], evidence: { field: "resolution", evidence: "kie docs 1K/2K/4K", evidence_location: "kieGptImage2.ts", confidence: "high" as const } }] },
      })],
      mappings: [mapping({
        vendorKey: "kie", modelKey: "gpt-image-2-text-to-image", taskKind: "text_to_image",
        create: { ...GPT_IMAGE_2_T2I_CREATE_OP },
      })],
    }));
    const resolved = registry.resolve({
      moduleId: "generation.single-shot", providerId: "kie",
      modelId: "gpt-image-2-text-to-image", mode: "text_to_image",
    });
    expect(resolved.parameterSchema.resolution).toEqual({ type: "enum", enum: ["1K", "2K"] });
  });

  it("returns an empty registry for an empty catalog instead of inventing a provider", () => {
    const registry = createCatalogModuleRegistry(state({ models: [] }));
    expect(() => registry.resolve({ moduleId: "generation.single-shot", providerId: "anything", modelId: "anything", mode: "text_to_image" })).toThrow(/Unknown module/);
  });

  it("does not register an enabled unverified adapter model even when a raw enabled mapping exists", () => {
    const registry = createCatalogModuleRegistry(state({
      models: [model({ meta: { adapter: { state: "unverified", modes: [], updatedAt: "t" } } })],
      mappings: [mapping({ enabled: true })],
    }));

    expect(() => registry.resolve({
      moduleId: "generation.single-shot",
      providerId: "provider-a",
      modelId: "image-model",
      mode: "text_to_image",
    })).toThrow(/Unknown module/);
  });

  it("projects only published modes from enabled vendors", () => {
    const registry = createCatalogModuleRegistry(state({
      vendors: [
        { key: "provider-a", name: "Provider A", enabled: true, createdAt: "t", updatedAt: "t" },
        { key: "provider-disabled", name: "Disabled", enabled: false, createdAt: "t", updatedAt: "t" },
      ],
      models: [
        model({ vendorKey: "provider-a", modelKey: "image-model" }),
        model({ vendorKey: "provider-disabled", modelKey: "disabled-model" }),
      ],
      mappings: [
        mapping({ vendorKey: "provider-a", modelKey: "image-model", taskKind: "text_to_image", enabled: true }),
        mapping({ id: "mapping-edit-disabled", vendorKey: "provider-a", modelKey: "image-model", taskKind: "image_edit", enabled: false }),
        mapping({ id: "mapping-disabled-vendor", vendorKey: "provider-disabled", modelKey: "disabled-model", taskKind: "text_to_image", enabled: true }),
      ],
    }));

    const manifest = registry.snapshot()[0];
    expect(manifest?.modes).toEqual(["text_to_image"]);
    expect(manifest?.providers.map((provider) => provider.providerId)).toEqual(["provider-a"]);
    expect(() => registry.resolve({
      moduleId: "generation.single-shot",
      providerId: "provider-a",
      modelId: "image-model",
      mode: "image_edit",
    })).toThrow(/Unsupported mode|does not support mode/);
    expect(() => registry.resolve({
      moduleId: "generation.single-shot",
      providerId: "provider-disabled",
      modelId: "disabled-model",
      mode: "text_to_image",
    })).toThrow(/Unknown provider/);
  });
});
