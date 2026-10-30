import { describe, it, expect } from "vitest";
import { assertPlannedModelIdentity, buildModelEntryIndex, buildPlannedNodeMeta, resolvePlannedNodeArgs } from "./plannedNodeMeta";
import { buildAgentModelEntries, type AgentModelEntry } from "./availableModels";
import type { ModelOption } from "../../../config/models";
import { ASPECT_EXPLICIT_META_KEY } from "../nodes/aspectExplicit";

function entryByKey(): Map<string, AgentModelEntry> {
  const entries = buildAgentModelEntries([
    { value: "seedance-2", label: "即梦 Seedance", vendor: "kie", meta: { archetypeId: "seedance-2" } } as ModelOption,
  ]);
  return new Map(entries.map((e) => [e.modelId, e]));
}

function textEntryByKey(): Map<string, AgentModelEntry> {
  const entries = buildAgentModelEntries([
    { value: "agent-runtime-text", label: "Fixture 文本", vendor: "loopback", kind: "text" } as ModelOption & { kind: "text" },
  ]);
  return new Map(entries.map((e) => [e.modelId, e]));
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
    expect(buildPlannedNodeMeta(
      { modelKey: "seedance-2", vendor: "kie", modelVendor: "other-vendor", variantId: "fast" },
      entryByKey(),
    )).toBeUndefined();
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

  // 裸 key（没记供应商的旧数据）落哪家由 pickImplicitVendorMatch 决定——与模型框回显同一把尺：
  // 用户顺序 > 官方 > 内置中转 > 自接 > 目录序。以前是「首次出现」，而目录新接入的在前，
  // 用户一自定义同名模型裸键就换成了它（2026-09-21）。既不是「最后写入」也不是「第一条」。
  it("裸 key 按同一把尺落家：内置中转 apimart 先于自接中转，不看目录里谁先出现", () => {
    const index = buildModelEntryIndex(buildAgentModelEntries(TWO_VENDORS));
    expect(index.get("nano-banana")?.vendor).toBe("apimart");
  });

  it("裸 key 跟随用户排的供应商顺序", () => {
    const index = buildModelEntryIndex(buildAgentModelEntries(TWO_VENDORS), ["code-newcli-com"]);
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


describe("B4 provider preference at node persistence", () => {
  it("lands a bare gpt-image-2 key on APIMart when APIMart is preferred", () => {
    const entries = buildAgentModelEntries([
      { value: "gpt-image-2", modelKey: "gpt-image-2", label: "GPT Image 2", vendor: "relay", kind: "image" },
      { value: "gpt-image-2", modelKey: "gpt-image-2", label: "GPT Image 2", vendor: "apimart", kind: "image" },
    ] as ModelOption[]);
    const index = buildModelEntryIndex(entries, ["apimart", "relay"]);
    expect(buildPlannedNodeMeta({ modelKey: "gpt-image-2" }, index)?.modelVendor).toBe("apimart");
    expect(buildPlannedNodeMeta({ modelKey: "gpt-image-2", vendor: "relay" }, index)?.modelVendor).toBe("relay");
  });
});

// 「比例明确选过」标记（aspect_ratio_user_set）：Agent / 分镜写了合法比例就记，连线时视频比例的产品默认不改它。
// 判据是**控件语义**——这个模式的比例控件（选项全是比例的那一个）被写了才算，不是键名：
// Agnes Video 2.5 的 `size` 是清晰度（720P / 960P / 2K），比例在 `aspect_ratio`；Seedance 2.5 的比例控件才叫 `size`。
describe("buildPlannedNodeMeta · 比例明确选过的标记", () => {
  const index = buildModelEntryIndex(buildAgentModelEntries([
    { value: "seedance-2", label: "即梦 Seedance", vendor: "kie", meta: { archetypeId: "seedance-2" } },
    { value: "doubao-seedance-2.5", label: "Seedance 2.5", vendor: "apimart", meta: { archetypeId: "seedance-2.5-apimart" } },
    { value: "agnes-video-2.5", label: "Agnes Video 2.5", vendor: "agnes", meta: { archetypeId: "agnes-video-2.5" } },
  ] as ModelOption[]));
  const metaOf = (modelKey: string, params?: Record<string, unknown>) => buildPlannedNodeMeta({ modelKey, ...(params ? { params } : {}) }, index)!;

  it("写了比例控件的合法值 → 记明确选过", () => {
    expect(metaOf("seedance-2", { aspect_ratio: "9:16" })[ASPECT_EXPLICIT_META_KEY]).toBe(true);
  });

  it("没写比例（落地 = 档案默认）→ 不记", () => {
    const meta = metaOf("seedance-2");
    expect(meta.aspect_ratio).toBe("16:9");
    expect(meta[ASPECT_EXPLICIT_META_KEY]).toBeUndefined();
  });

  it("写了非法比例（丢弃、回档案默认）→ 不记", () => {
    const meta = metaOf("seedance-2", { aspect_ratio: "999:1" });
    expect(meta.aspect_ratio).toBe("16:9");
    expect(meta[ASPECT_EXPLICIT_META_KEY]).toBeUndefined();
  });

  it("比例控件不叫 aspect_ratio（Seedance 2.5 的比例叫 size）：写了它 → 记", () => {
    const meta = metaOf("doubao-seedance-2.5", { size: "9:16" });
    expect(meta.size).toBe("9:16");
    expect(meta[ASPECT_EXPLICIT_META_KEY]).toBe(true);
  });

  it("Agnes Video 2.5 只写了清晰度 size: 960P（它的 size 不是比例）→ 不记，aspect_ratio 仍是档案默认", () => {
    const meta = metaOf("agnes-video-2.5", { size: "960P" });
    expect(meta.size).toBe("960P");
    expect(meta.aspect_ratio).toBe("16:9");
    expect(meta[ASPECT_EXPLICIT_META_KEY]).toBeUndefined();
  });

  it("Agnes Video 2.5 同时写了清晰度和比例 → 记（因为比例控件被写了）", () => {
    const meta = metaOf("agnes-video-2.5", { size: "960P", aspect_ratio: "9:16" });
    expect(meta.aspect_ratio).toBe("9:16");
    expect(meta[ASPECT_EXPLICIT_META_KEY]).toBe(true);
  });
});


it('rejects an explicit non-existent provider/model identity instead of silently retaining another model', () => {
  expect(() => assertPlannedModelIdentity({ modelKey: 'seedance-2', modelVendor: 'codex-local' }, entryByKey())).toThrow(/model_identity_unavailable/)
  const vendorless = new Map([...entryByKey()].map(([key, entry]) => [key, { ...entry, vendor: null }]))
  expect(() => assertPlannedModelIdentity({ modelKey: 'seedance-2', modelVendor: 'invented-vendor' }, vendorless)).toThrow(/model_identity_unavailable/)
})

describe('approved duration reaches an imported workflow control', () => {
  const entries = () => buildModelEntryIndex(buildAgentModelEntries([{
    value: 'custom-workflow', modelKey: 'custom-workflow', label: 'Custom workflow', kind: 'video', vendor: 'comfyui-local-fixture',
    meta: { comfyWorkflowImport: { binding: { outputKind: 'video' } }, parameters: [
      { key: 'first_frame_url', type: 'image-url', mediaKind: 'image', label: 'Frame' },
      { key: 'comfy_duration', type: 'number', label: 'Duration', default: 5 },
    ] },
  } as ModelOption]))
  it.each([6, 7, 8])('places the approved %s seconds into the declared execution key', duration => {
    const meta = buildPlannedNodeMeta({ modelKey: 'custom-workflow', modelVendor: 'comfyui-local-fixture', params: { duration } }, entries())
    expect(meta?.comfy_duration).toBe(duration)
  })
  it('refuses contradictory explicit semantic and wire durations', () => {
    expect(() => buildPlannedNodeMeta({ modelKey: 'custom-workflow', params: { duration: 7, comfy_duration: 5 } }, entries())).toThrow(/duration.*conflict/)
  })
})
