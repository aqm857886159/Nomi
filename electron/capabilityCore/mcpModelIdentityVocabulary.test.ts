// 读写词表必须对得上（2026-09-05 探针 c-3）。
//
// 修复前：`nomi_read(target=models)` 吐 `{vendor, modelKey, kind, label, keyStatus}`；
// `nomi_operation_plan` 却要 `{moduleId, providerId, modelId}` 三元组，缺一不可，
// 而 `moduleId` 在任何读工具的输出里都不出现。宿主只能猜（探针猜了 `image`：plan 过了，
// preview 立刻回 `Unknown module: image`），而拒绝文案是「请先在设置中选择模型」——
// 一个无头宿主没有设置界面可点。
//
// 这里钉两件事：① 读出来的一行**含齐**写工具要的三项；② 写工具**收得下读工具吐出的字段名**。
import { describe, expect, it } from "vitest";

import { deriveModelListing } from "../catalog/modelCatalogListing";
import { SINGLE_SHOT_GENERATION_MODULE_ID } from "../shared/generationModuleId";
import { MCP_TOOL_RESOLVER } from "./mcpToolCatalog";

const catalogState = {
  version: 1,
  vendors: [{ key: "apimart", name: "APIMart", enabled: true, authType: "bearer" }],
  models: [{ vendorKey: "apimart", modelKey: "seedream-4", kind: "image", enabled: true, labelZh: "即梦 4" }],
  mappings: [{ vendorKey: "apimart", modelKey: "seedream-4", taskKind: "text_to_image", enabled: true, create: { body: {} } }],
  apiKeysByVendor: {},
} as never;

describe("model identity reads and writes use one vocabulary", () => {
  it("every listed model carries the whole identity triple the write tool requires", () => {
    const [entry] = deriveModelListing(catalogState, { keyStatusProbe: () => "ok" });
    expect(entry.moduleId).toBe(SINGLE_SHOT_GENERATION_MODULE_ID);
    expect(entry.vendor).toBe("apimart");
    expect(entry.modelKey).toBe("seedream-4");
  });

  it("nomi_operation_plan accepts the exact field names nomi_read(models) emits", () => {
    const tool = MCP_TOOL_RESOLVER.resolve("nomi_operation_plan");
    const properties = (tool?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    for (const field of ["moduleId", "providerId", "modelId", "vendor", "modelKey"]) {
      expect(properties, `${field} must be declared or additionalProperties:false rejects it`).toHaveProperty(field);
    }
    const [entry] = deriveModelListing(catalogState, { keyStatusProbe: () => "ok" });
    const built = tool?.build({
      leaseHandle: "lease-a",
      projectId: "project-1",
      prompt: "一只猫",
      moduleId: entry.moduleId,
      vendor: entry.vendor,
      modelKey: entry.modelKey,
    }) as Record<string, unknown>;
    // 读侧别名折成写侧的 canonical 名字；身份键定义本身不变。
    expect(built).toMatchObject({
      moduleId: SINGLE_SHOT_GENERATION_MODULE_ID,
      providerId: "apimart",
      modelId: "seedream-4",
    });
  });

  it("keeps the canonical names authoritative when both spellings arrive", () => {
    const tool = MCP_TOOL_RESOLVER.resolve("nomi_operation_plan");
    const built = tool?.build({
      leaseHandle: "lease-a", prompt: "x",
      providerId: "canonical", vendor: "alias", modelId: "canonical-model", modelKey: "alias-model",
    }) as Record<string, unknown>;
    expect(built.providerId).toBe("canonical");
    expect(built.modelId).toBe("canonical-model");
  });
});
