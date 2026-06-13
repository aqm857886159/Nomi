import { describe, it, expect } from "vitest";
import { buildPlannedNodeMeta, resolvePlannedNodeArgs } from "./plannedNodeMeta";
import { buildAgentModelEntries, type AgentModelEntry } from "./availableModels";
import type { ModelOption } from "../../../config/models";

function entryByKey(): Map<string, AgentModelEntry> {
  const entries = buildAgentModelEntries([
    { value: "seedance-2", label: "即梦 Seedance", vendor: "kie", meta: { archetypeId: "seedance-2" } } as ModelOption,
  ]);
  return new Map(entries.map((e) => [e.modelKey, e]));
}

describe("buildPlannedNodeMeta", () => {
  it("无 modelKey 返回 undefined（走原自动选）", () => {
    expect(buildPlannedNodeMeta({}, entryByKey())).toBeUndefined();
  });

  it("modelKey 不在清单返回 undefined", () => {
    expect(buildPlannedNodeMeta({ modelKey: "not-available" }, entryByKey())).toBeUndefined();
  });

  it("有效 modelKey 自铺全 vendor/label/archetype + 默认参数", () => {
    const meta = buildPlannedNodeMeta({ modelKey: "seedance-2" }, entryByKey());
    expect(meta).toBeTruthy();
    expect(meta!.modelKey).toBe("seedance-2");
    expect(meta!.modelVendor).toBe("kie");
    expect(meta!.modelLabel).toBe("即梦 Seedance");
    expect(meta!.archetype).toMatchObject({ id: "seedance-2" });
    // 默认参数已铺（seedance aspect_ratio 默认 16:9）
    expect(meta!.aspect_ratio).toBe("16:9");
  });

  it("agent 的合法参数覆盖默认", () => {
    const meta = buildPlannedNodeMeta(
      { modelKey: "seedance-2", params: { aspect_ratio: "9:16" } },
      entryByKey(),
    );
    expect(meta!.aspect_ratio).toBe("9:16");
  });

  it("非法参数值被丢弃，保留默认", () => {
    const meta = buildPlannedNodeMeta(
      { modelKey: "seedance-2", params: { aspect_ratio: "999:1" } },
      entryByKey(),
    );
    expect(meta!.aspect_ratio).toBe("16:9"); // 非法 → 回默认
  });

  it("非标量参数值被忽略", () => {
    const meta = buildPlannedNodeMeta(
      { modelKey: "seedance-2", params: { aspect_ratio: { bad: 1 } } },
      entryByKey(),
    );
    expect(meta!.aspect_ratio).toBe("16:9");
  });
});

describe("resolvePlannedNodeArgs — 批准≡执行(消灭对账出入)", () => {
  it("非法参数 → 折成执行后的默认值,使计划与执行一致", () => {
    // agent 写了非法 aspect_ratio,执行会回退默认;批准时就对齐 → 对账零出入。
    const node = { clientId: "k1", kind: "video", title: "镜头", modelKey: "seedance-2", params: { aspect_ratio: "999:1" } };
    const resolved = resolvePlannedNodeArgs(node, entryByKey());
    expect((resolved.params as Record<string, unknown>).aspect_ratio).toBe("16:9");
    expect(resolved.modelKey).toBe("seedance-2");
    expect(resolved.title).toBe("镜头"); // 其它字段原样保留
  });

  it("解析后的 params 与 buildPlannedNodeMeta 的参数子集一致(同源,故对账必匹配)", () => {
    const node = { clientId: "k1", kind: "video", modelKey: "seedance-2", params: { aspect_ratio: "999:1" } };
    const resolved = resolvePlannedNodeArgs(node, entryByKey());
    const meta = buildPlannedNodeMeta(node, entryByKey())!;
    const { modelKey: _mk, modelLabel: _ml, archetype: _arch, modelVendor: _mv, ...metaParams } = meta;
    expect(resolved.params).toEqual(metaParams);
    expect(resolved.modelKey).toBe(meta.modelKey);
  });

  it("无 modelKey → 原样返回(不动)", () => {
    const node = { clientId: "k1", kind: "image", title: "镜头" };
    expect(resolvePlannedNodeArgs(node, entryByKey())).toEqual(node);
  });

  it("模型不可用 → 剥掉 modelKey/modeId/params(与执行回退自动选一致)", () => {
    const node = { clientId: "k1", kind: "video", title: "镜头", modelKey: "not-available", modeId: "i2v", params: { x: 1 } };
    const resolved = resolvePlannedNodeArgs(node, entryByKey());
    expect(resolved.modelKey).toBeUndefined();
    expect(resolved.modeId).toBeUndefined();
    expect(resolved.params).toBeUndefined();
    expect(resolved.title).toBe("镜头");
  });
});
