import { describe, it, expect } from "vitest";
import { buildModelEntryIndex, buildPlannedNodeMeta, resolvePlannedNodeArgs } from "./plannedNodeMeta";
import { buildAgentModelEntries, type AgentModelEntry } from "./availableModels";
import type { ModelOption } from "../../../config/models";

function entryByKey(): Map<string, AgentModelEntry> {
  const entries = buildAgentModelEntries([
    { value: "seedance-2", label: "即梦 Seedance", vendor: "kie", meta: { archetypeId: "seedance-2" } } as ModelOption,
  ]);
  return new Map(entries.map((e) => [e.modelKey, e]));
}

function textEntryByKey(): Map<string, AgentModelEntry> {
  const entries = buildAgentModelEntries([
    { value: "agent-runtime-text", label: "Fixture 文本", vendor: "loopback", kind: "text" } as ModelOption & { kind: "text" },
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

  it("保留批准卡选择的供应商和变体到 canonical node meta", () => {
    const meta = buildPlannedNodeMeta(
      { modelKey: "seedance-2", vendor: "kie", variantId: "fast", modeId: "t2v" },
      entryByKey(),
    );
    expect(meta).toMatchObject({
      modelKey: "seedance-2",
      modelVendor: "kie",
      vendor: "kie",
      archetype: { id: "seedance-2", modeId: "t2v", variantId: "fast" },
    });
  });

  it("冲突的 vendor/modelVendor 不会静默改路由", () => {
    expect(
      buildPlannedNodeMeta(
        { modelKey: "seedance-2", vendor: "kie", modelVendor: "other-vendor", variantId: "fast" },
        entryByKey(),
      ),
    ).toBeUndefined();
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

  it("文本模型保留显式身份但不伪造媒体 archetype", () => {
    const meta = buildPlannedNodeMeta({ modelKey: "agent-runtime-text", modeId: "chat" }, textEntryByKey());
    expect(meta).toMatchObject({ modelKey: "agent-runtime-text", modelVendor: "loopback", modelLabel: "Fixture 文本" });
    expect(meta?.archetype).toBeUndefined();
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
    const { modelKey: _mk, modelLabel: _ml, archetype: _arch, modelVendor: _mv, vendor: _vendor, ...metaParams } = meta;
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

// ── 根因回归：模型身份的唯一键是 (vendor, modelKey) ──────────────────────────
// 2026-09-03 首次真实付费闭环走查的阻断：UI 选 APIMart 的模型，出站请求实际发去
// code-newcli-com（HTTP 400，全链阻断）。成因是落地写 node.meta 时只按裸 modelKey
// 反查模型清单——两家供应商提供同名模型时，拿到的是「索引里碰巧那一家」。
// node.meta.modelVendor 就是运行器出站时用的供应商，所以这里断言的就是「出站发去哪家」。
describe("模型身份唯一键含 vendor（选 A 家就发去 A 家）", () => {
  const TWO_VENDORS: ModelOption[] = [
    { value: "nano-banana", label: "Nano Banana", vendor: "code-newcli-com", meta: { archetypeId: "nano-banana" } } as ModelOption,
    { value: "nano-banana", label: "Nano Banana", vendor: "apimart", meta: { archetypeId: "nano-banana" } } as ModelOption,
  ];

  it("同名不同家 = 两个条目，各自可按 vendor::key 取回", () => {
    const index = buildModelEntryIndex(buildAgentModelEntries(TWO_VENDORS));
    expect(index.get("code-newcli-com::nano-banana")?.vendor).toBe("code-newcli-com");
    expect(index.get("apimart::nano-banana")?.vendor).toBe("apimart");
  });

  it("裸 key 取首次出现的那家，不是「最后写入的那家」", () => {
    const index = buildModelEntryIndex(buildAgentModelEntries(TWO_VENDORS));
    expect(index.get("nano-banana")?.vendor).toBe("code-newcli-com");
  });

  it("选 apimart → 写进 node.meta 的供应商就是 apimart（不是目录里的另一家）", () => {
    const index = buildModelEntryIndex(buildAgentModelEntries(TWO_VENDORS));
    const meta = buildPlannedNodeMeta({ modelKey: "nano-banana", modelVendor: "apimart" }, index);
    expect(meta).toBeTruthy();
    expect(meta!.modelVendor).toBe("apimart");
    expect(meta!.vendor).toBe("apimart");
  });

  it("选 code-newcli-com → 写进 node.meta 的供应商就是 code-newcli-com", () => {
    const index = buildModelEntryIndex(buildAgentModelEntries(TWO_VENDORS));
    const meta = buildPlannedNodeMeta({ modelKey: "nano-banana", modelVendor: "code-newcli-com" }, index);
    expect(meta!.modelVendor).toBe("code-newcli-com");
  });

  // 裸 key 索引下这条会红：apimart 的请求反查到 code-newcli-com 的条目，
  // buildPlannedNodeMeta 的「不许跨家混搭」判定随即拒收 → 用户选的模型被整个剥掉，
  // 静默回落自动选（走查实测的第二种表现）。vendor 限定键让它稳稳落在 apimart 上。
  it("resolvePlannedNodeArgs 按 vendor 限定键落地，用户所选不被静默剥掉", () => {
    const index = buildModelEntryIndex(buildAgentModelEntries(TWO_VENDORS));
    const resolved = resolvePlannedNodeArgs(
      { clientId: "k1", kind: "image", title: "镜头", modelKey: "nano-banana", modelVendor: "apimart" },
      index,
    );
    expect(resolved.modelKey).toBe("nano-banana");
    expect(resolved.modelVendor).toBe("apimart");
  });
});
