import { describe, expect, it } from "vitest";

import { connectedModelScope } from "./connectedModelScope";
import type { ModelListingEntry } from "../catalog/modelCatalogListing";
import { DEFAULT_AUTOMATION_POLICY_SETTINGS, normalizeAutomationPolicySettings } from "../settings/automationPolicyContract";

const references: ModelListingEntry["references"] = {
  image: false, video: false, audio: false, multiImage: false, referenceModes: [],
} as unknown as ModelListingEntry["references"];

function entry(patch: Partial<ModelListingEntry>): ModelListingEntry {
  return {
    vendor: "kie", vendorName: "Kie.ai", modelKey: "gpt-image-2-text-to-image", moduleId: "single-shot",
    kind: "image", label: "GPT Image 2", keyStatus: "ok", statusReason: "ok", references, ...patch,
  };
}

// 2026-09-14 设置页删冗余（审计 §⑥ 7）：全局白名单删了，run 级默认范围 = 目录里已接入的那些。
describe("connectedModelScope", () => {
  it("admits every provider/model whose key resolves, and nothing that is not connected", () => {
    const scope = connectedModelScope([
      entry({}),
      entry({ modelKey: "gpt-image-2-image-edit" }),
      entry({ vendor: "comfyui-local", vendorName: "本地 ComfyUI", modelKey: "comfy-default", keyStatus: "ok" }),
      entry({ vendor: "runway", vendorName: "Runway", modelKey: "gen4", keyStatus: "missing" }),
      entry({ vendor: "fal", vendorName: "fal", modelKey: "flux", keyStatus: "locked" }),
      entry({ vendor: "minimax", vendorName: "MiniMax", modelKey: "hailuo", keyStatus: "needs_resave" }),
    ]);
    expect(scope).toEqual({
      allowedProviders: ["kie", "comfyui-local"],
      allowedModels: ["gpt-image-2-text-to-image", "gpt-image-2-image-edit", "comfy-default"],
    });
  });

  it("is empty only when nothing is connected — the old settings default (empty = deny all) no longer exists", () => {
    expect(connectedModelScope([])).toEqual({ allowedProviders: [], allowedModels: [] });
    // 设置契约里已经没有这两个字段：白名单不可能再从一份空的持久化设置回来。
    expect(DEFAULT_AUTOMATION_POLICY_SETTINGS).not.toHaveProperty("allowedProviders");
    expect(normalizeAutomationPolicySettings({ allowedProviders: [], allowedModels: [] })).not.toHaveProperty("allowedModels");
  });
});
