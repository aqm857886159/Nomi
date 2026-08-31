import { describe, it, expect } from "vitest";
import {
  buildAgentModelEntries,
  findAgentModelEntry,
  formatAvailableModelsForPrompt,
  indexAgentModelEntries,
} from "./availableModels";
import type { ModelOption } from "../../../config/models";

// 用 meta.archetypeId 显式命中内置档案（resolveArchetypeForModel 优先看 archetypeId）。
function opt(over: Partial<ModelOption>): ModelOption {
  return { value: "v", label: "L", ...over };
}

describe("buildAgentModelEntries", () => {
  it("命中档案的模型 join 出 modes + params", () => {
    const entries = buildAgentModelEntries([
      opt({ value: "seedance-2", label: "即梦 Seedance", vendor: "kie", meta: { archetypeId: "seedance-2" } }),
    ]);
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.modelKey).toBe("seedance-2");
    expect(e.kind).toBe("video");
    expect(e.archetypeId).toBe("seedance-2");
    expect(e.modes.length).toBeGreaterThan(0);
    // 每个 mode 带 vendorTerm（真名）+ params schema
    expect(e.modes[0].vendorTerm).toBeTruthy();
    expect(Array.isArray(e.modes[0].params)).toBe(true);
    // seedance 默认模式有 aspect_ratio 参数（计划卡比例 chip 的来源）
    const allParamKeys = e.modes.flatMap((m) => m.params.map((p) => p.key));
    expect(allParamKeys).toContain("aspect_ratio");
    // T8：每个 mode 带参考槽（agent 据此只连模型真支持的边）。seedance omni 有 image_ref 角色参考。
    const omni = e.modes.find((m) => m.slots.some((s) => s.kind === "image_ref"));
    expect(omni).toBeTruthy();
    expect(omni?.slots.find((s) => s.kind === "image_ref")?.characterIndexed).toBe(true);
  });

  it("纯文生模型的模式 slots 为空（不接参考边）", () => {
    const entries = buildAgentModelEntries([
      opt({ value: "imagen-4", label: "Imagen 4", meta: { archetypeId: "imagen-4" } }),
    ]);
    expect(entries[0].modes.every((m) => m.slots.length === 0)).toBe(true);
  });

  it("无档案的模型被跳过", () => {
    const entries = buildAgentModelEntries([
      opt({ value: "some-unknown-model-xyz", label: "未知", vendor: "x" }),
    ]);
    expect(entries).toHaveLength(0);
  });

  it("同一 modelKey 去重（image/video 两边重复）", () => {
    const entries = buildAgentModelEntries([
      opt({ value: "seedance-2", modelKey: "seedance-2", meta: { archetypeId: "seedance-2" } }),
      opt({ value: "seedance-2", modelKey: "seedance-2", meta: { archetypeId: "seedance-2" } }),
    ]);
    expect(entries).toHaveLength(1);
  });

  it("同名模型跨供应商保留两条复合身份，裸 key 不再随机命中", () => {
    const entries = buildAgentModelEntries([
      opt({ value: "seedance-2", modelKey: "seedance-2", vendor: 'relay-a', meta: { archetypeId: "seedance-2" } }),
      opt({ value: "seedance-2", modelKey: "seedance-2", vendor: 'relay-b', meta: { archetypeId: "seedance-2" } }),
    ]);
    expect(entries).toHaveLength(2);
    const index = indexAgentModelEntries(entries);
    expect(findAgentModelEntry(index, 'seedance-2')).toBeUndefined();
    expect(findAgentModelEntry(index, 'seedance-2', 'relay-a')?.vendor).toBe('relay-a');
    expect(findAgentModelEntry(index, 'seedance-2', 'relay-b')?.vendor).toBe('relay-b');
  });

  it("显式供应商不存在时不回退到另一家的唯一裸模型", () => {
    const entries = buildAgentModelEntries([
      opt({ value: "seedance-2", modelKey: "seedance-2", vendor: 'relay-b', meta: { archetypeId: "seedance-2" } }),
    ]);
    const index = indexAgentModelEntries(entries);
    expect(findAgentModelEntry(index, 'seedance-2', 'relay-a')).toBeUndefined();
    expect(findAgentModelEntry(index, 'seedance-2')).toMatchObject({ vendor: 'relay-b' });
  });

  it("空输入返回空", () => {
    expect(buildAgentModelEntries([])).toEqual([]);
  });
});

describe("formatAvailableModelsForPrompt", () => {
  it("空清单返回空串（不注入）", () => {
    expect(formatAvailableModelsForPrompt([])).toBe("");
  });

  it("列出 modelKey + 模式 + 参数选项", () => {
    const entries = buildAgentModelEntries([
      opt({ value: "seedance-2", label: "即梦 Seedance", meta: { archetypeId: "seedance-2" } }),
    ]);
    const text = formatAvailableModelsForPrompt(entries);
    expect(text).toContain("modelKey=seedance-2");
    expect(text).toContain("modelVendor=");
    expect(text).toContain("aspect_ratio[");
    expect(text).toContain("9:16");
    // T8：提示词里带每个模式的参考槽，让 agent 按模型真实能力连边
    expect(text).toContain("参考槽:");
  });

  it("纯文生模型在提示词里标注「不接参考边」", () => {
    const entries = buildAgentModelEntries([
      opt({ value: "imagen-4", label: "Imagen 4", meta: { archetypeId: "imagen-4" } }),
    ]);
    expect(formatAvailableModelsForPrompt(entries)).toContain("纯文生,不接参考边");
  });
});
