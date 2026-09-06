import { describe, it, expect } from "vitest";
import { buildAgentModelEntries, formatAvailableModelsForPrompt } from "./availableModels";
import type { ModelOption } from "../../../config/models";

// 用 meta.archetypeId 显式命中内置档案（resolveArchetypeForModel 优先看 archetypeId）。
function opt(over: Partial<ModelOption>): ModelOption {
  return { value: "v", label: "L", ...over };
}

describe("buildAgentModelEntries", () => {
  // 2026-09-03 真实付费闭环走查的阻断根因回归：曾按 modelKey 去重（首家胜出），
  // 两家供应商提供同名模型时身份坍缩——用户选 APIMart 却发去 code-newcli-com HTTP 400。
  // 身份唯一键必须是 (vendor, modelKey)。
  it("同名模型来自不同供应商 = 两个条目，不去重（身份唯一键含 vendor）", () => {
    const entries = buildAgentModelEntries([
      opt({ value: "nano-banana", label: "Nano Banana", vendor: "apimart", meta: { archetypeId: "nano-banana" } }),
      opt({ value: "nano-banana", label: "Nano Banana", vendor: "code-newcli-com", meta: { archetypeId: "nano-banana" } }),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.vendor).sort()).toEqual(["apimart", "code-newcli-com"]);
  });

  it("同一供应商的同名模型仍然去重（image/video 两边重复的既有语义不变）", () => {
    const entries = buildAgentModelEntries([
      opt({ value: "nano-banana", label: "Nano Banana", vendor: "apimart", meta: { archetypeId: "nano-banana" } }),
      opt({ value: "nano-banana", label: "Nano Banana", vendor: "apimart", meta: { archetypeId: "nano-banana" } }),
    ]);
    expect(entries).toHaveLength(1);
  });

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

  it("保留目录中已发布的文本模型并声明 chat 模式（显式模型不能静默回退）", () => {
    // 文本模型没有媒体 archetype；catalog kind 仍然是唯一足够的能力证据。
    // 暂用结构扩展夹具，待实现把 kind 纳入 ModelOption 的正式类型。
    const entries = buildAgentModelEntries([
      { value: "agent-runtime-text", label: "Fixture 文本", vendor: "loopback", kind: "text" } as ModelOption & { kind: "text" },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ modelKey: "agent-runtime-text", kind: "text", vendor: "loopback" });
    expect(entries[0].archetypeId).toBeUndefined();
    expect(entries[0].defaultModeId).toBe("chat");
    expect(entries[0].modes).toEqual([
      expect.objectContaining({ modeId: "chat", slots: [] }),
    ]);
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
