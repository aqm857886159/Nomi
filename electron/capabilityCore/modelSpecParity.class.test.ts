// 类级回归：**同一个模型经两个入口拿到的说明书必须逐字段一致**，且两档分级都真的分级了。
//
// 这条测试是本刀的验收门第 3 条（2026-09-21 任务书）：
// 「同一模型经 `list_models`（应用内面）与 `nomi_read{target:"model"}`（外部面）
//  拿到的详情逐字段一致 —— 防以后再漂移」。
//
// 为什么这条必须存在：漂移正是这一族缺陷的形状。两个面各写各的投影时，
// 谁也不会红；直到用户在外部宿主里发现「Nomi 说这个模型没有 720p」才暴露。
import { describe, expect, it } from "vitest";

import { applyBuiltinSeeds } from "../catalog/seedBuiltins";
import { agentModelEntriesFromCatalog } from "../catalog/agentModelEntriesFromCatalog";
import { getArchetypeById, specializeArchetypeForVendor } from "../shared/modelArchetypes";
import { createLaneModelRead } from "../agentLane/laneModelRead.mjs";
import { findModelEntry, modelSpecDetail, modelSpecRow, vendorsCarrying } from "../shared/agentCapabilities/modelSpecProjection";
import { catalogAvailabilityFor, requireModelSpecDetail } from "./modelSpecRead";

const state = applyBuiltinSeeds(
  { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} },
  "2026-09-22T00:00:00.000Z",
).state;
const catalog = agentModelEntriesFromCatalog(state);
const entries = catalog.map((row) => row.entry);
const availabilityOf = (entry: typeof entries[number]) =>
  catalog.find((row) => row.entry.modelId === entry.modelId && row.entry.vendor === entry.vendor)?.availability;

/**
 * 应用内那一面：真的 lane 工具，而且**按生产接线注入可用性**
 * （`laneDesktopRuntime` 注入 `catalogAvailabilityFor`，lane 自己不 import 目录）。
 * 上一轮这里给两面各注入一个本地函数，测的是「函数对等」不是「生产对等」——
 * 于是生产接线漏传 availabilityOf 这件事测不出来（2026-09-22 第二轮验收）。
 */
const laneTool = createLaneModelRead(
  () => entries,
  // 生产里 state 缺省读真实目录；测试喂同一份种子状态，接线逐字相同。
  (entry) => catalogAvailabilityFor(entry.vendor, entry.modelId, state),
);
const laneCall = async (args: { kind?: string; modelId?: string; vendor?: string }) =>
  (await laneTool.execute("call-1", args)).details as Record<string, unknown>;

/** 外部 MCP 那一面：与 `dispatcher` 的 `models.list` / `models.read` 用的是同一对函数。 */
const mcpThin = () => entries.map((entry) => modelSpecRow(entry, availabilityOf(entry)));
const mcpDetail = (modelId: string, vendor?: string | null) => {
  const entry = findModelEntry(entries, modelId, vendor);
  return entry ? modelSpecDetail(entry, availabilityOf(entry)) : null;
};

/** **全量**：156 个模型逐个比，不抽样。抽 2 个挡不住「5/156 不一致」那种缺陷。 */
const allIdentities = entries.map((entry) => [entry.modelId, entry.vendor] as const);

/** 同一个 modelId 名下有 ≥2 家供应商的那些（身份唯一键是 (vendor, modelId)）。 */
function sharedModelIds(): Array<readonly [string, Set<string>]> {
  const byId = new Map<string, Set<string>>();
  for (const [modelId, vendor] of allIdentities) {
    if (!vendor) continue;
    byId.set(modelId, (byId.get(modelId) ?? new Set()).add(vendor));
  }
  return [...byId.entries()].filter(([, vendors]) => vendors.size > 1).map(([id, v]) => [id, v] as const);
}

describe("model spec parity across the two model faces", () => {
  it("the seeded catalog really carries the models this test is about", () => {
    expect(entries.length).toBeGreaterThan(150);
  });

  it("every one of the catalog's models reads field-for-field identical through both faces", async () => {
    const mismatches: string[] = [];
    for (const [modelId, vendor] of allIdentities) {
      const lane = (await laneCall({ modelId, vendor: vendor ?? undefined })).model;
      if (JSON.stringify(lane) !== JSON.stringify(mcpDetail(modelId, vendor))) mismatches.push(`${vendor}/${modelId}`);
    }
    expect(mismatches, `${mismatches.length}/${allIdentities.length} models differ between the two faces`).toEqual([]);
    expect(allIdentities.length).toBeGreaterThan(150);
  });

  it("keeps same-name models from different providers apart (identity is (vendor, modelId))", async () => {
    // 2026-09-22 第二轮验收的新缺陷：不传 vendor 时应用内 Agent 永远拿第一家的说明书，
    // 实测 apimart/MiniMax-H3 拿回 kie 的（modeIds 4→3、params 与 hint 全不同）。
    const byId = new Map<string, string[]>();
    for (const [modelId, vendor] of allIdentities) {
      if (vendor) byId.set(modelId, [...(byId.get(modelId) ?? []), vendor]);
    }
    const shared = [...byId.entries()].filter(([, vendors]) => new Set(vendors).size > 1);
    expect(shared.length, "the seeded catalog no longer has a same-name cross-vendor model — premise gone").toBeGreaterThan(0);
    for (const [modelId, vendors] of shared) {
      const details = await Promise.all([...new Set(vendors)].map(async (vendor) =>
        JSON.stringify((await laneCall({ modelId, vendor })).model)));
      // 各家取各家：两份详情必须不同 vendor 字段，且不能全都等于第一家。
      expect(new Set(details).size, `${modelId}: every vendor returned the same detail`).toBeGreaterThan(1);
    }
  });

  it("refuses as ambiguous when vendor is omitted and two providers carry that modelId", async () => {
    // 与「vendor 不匹配时静默回退」同一类：调用方没点名哪一家，我们**悄悄挑了第一家**，
    // 于是它以为拿到的是它要的那家，然后照另一家的参数表下单（2026-09-22 主管自查）。
    const shared = sharedModelIds();
    expect(shared.length, "the seeded catalog no longer has a same-name cross-vendor model — premise gone").toBeGreaterThan(0);
    const [modelId, vendors] = shared[0]!;

    // 应用内面
    const lane = await laneCall({ modelId });
    expect(lane.model).toBeNull();
    expect(String(lane.errorCode)).toBe("ambiguous_model_vendor");
    expect(lane.vendorsForModelId).toEqual(expect.arrayContaining([...vendors]));
    expect(String(lane.recoveryActions)).toMatch(/vendor/i);

    // MCP 面：同一条出路
    let mcpError: { code?: string; details?: Record<string, unknown> } | undefined;
    try { requireModelSpecDetail(modelId, undefined, state); } catch (error) { mcpError = error as typeof mcpError; }
    expect(mcpError?.code).toBe("ambiguous_model_vendor");
    expect(String(mcpError?.details?.vendorsForModelId)).toContain([...vendors][0]!);
  });

  it("still answers straight away when only one provider carries that modelId", async () => {
    const soloId = allIdentities.find(([modelId]) => vendorsCarrying(entries, modelId).length === 1)?.[0];
    expect(soloId, "every model is multi-vendor — premise gone").toBeTruthy();
    expect((await laneCall({ modelId: soloId! })).model).toBeTruthy();
    expect(requireModelSpecDetail(soloId!, undefined, state)).toBeTruthy();
  });

  it("refuses instead of silently falling back when the named vendor does not carry the model", async () => {
    const [modelId] = allIdentities[0]!;
    const payload = await laneCall({ modelId, vendor: "no-such-vendor" });
    expect(payload.model).toBeNull();
    expect(payload.vendorsForModelId).toBeTruthy();
  });

  it("the detail really carries this model's declared parameters (not an empty shell)", async () => {
    // M3：把详情里每个 mode 的 params 清空，上一轮 65/65 全绿——而 params 正是这一刀的理由。
    // 判据用**真实档案**：详情里的参数键必须与档案声明逐项一致。
    let checked = 0;
    for (const entry of entries) {
      const base = entry.archetypeId ? getArchetypeById(entry.archetypeId) : null;
      if (!base) continue;
      // 参数是**按供应商特化**的（同一档案在不同家参数枚举不同），所以比之前先特化一次。
      const archetype = specializeArchetypeForVendor(base, entry.vendor);
      const detail = (await laneCall({ modelId: entry.modelId, vendor: entry.vendor ?? undefined })).model as
        { modes: Array<{ modeId: string; params: Array<{ key: string }> }> };
      for (const mode of archetype.modes) {
        const declared = mode.params.map((p) => p.key).sort();
        if (declared.length === 0) continue;
        const got = (detail.modes.find((m) => m.modeId === mode.id)?.params ?? []).map((p) => p.key).sort();
        expect(got, `${entry.vendor}/${entry.modelId} mode ${mode.id}`).toEqual(declared);
        checked += 1;
      }
    }
    expect(checked, "no model/mode pair carried declared parameters — the assertion would be vacuous").toBeGreaterThan(100);
  });

  it("the thin list is identical through both faces", async () => {
    expect((await laneCall({})).models).toEqual(mcpThin());
  });

  it("the thin tier really is thin — no params, no slots, no mode prose", async () => {
    const rows = (await laneCall({})).models as Array<Record<string, unknown>>;
    for (const row of rows.slice(0, 20)) {
      expect(row).not.toHaveProperty("modes");
      expect(row).not.toHaveProperty("params");
      expect(JSON.stringify(row)).not.toContain("vendorTerm");
    }
  });

  it("the detail tier carries what the thin tier withheld", async () => {
    const modelId = allIdentities[0]![0];
    const detail = (await laneCall({ modelId })).model as Record<string, unknown>;
    expect(Array.isArray(detail.modes)).toBe(true);
    expect((detail.modes as unknown[]).length).toBeGreaterThan(0);
  });

  it("carries availability on both faces (it used to exist only on the MCP face)", async () => {
    const lane = (await laneCall({})).models as Array<Record<string, unknown>>;
    expect(lane[0]).toHaveProperty("usable");
    expect(lane[0]).toHaveProperty("keyStatus");
    expect(lane[0]).toHaveProperty("statusReason");
    expect(mcpThin()[0]).toHaveProperty("statusReason");
  });

  it("makes variants discoverable, because admission already refuses unknown ones", async () => {
    // 「可被拒、不可发现」是 2026-09-22 验收点名的新不对称。
    const withVariants = entries.find((entry) => (entry.variants?.length ?? 0) > 0);
    expect(withVariants, "the seeded catalog has no model with variants — premise gone").toBeTruthy();
    const detail = (await laneCall({ modelId: withVariants!.modelId })).model as Record<string, unknown>;
    expect((detail.variants as unknown[]).length).toBeGreaterThan(0);
    const thin = mcpThin().find((row) => row.modelId === withVariants!.modelId);
    expect(thin?.variantIds?.length).toBeGreaterThan(0);
  });

  it("refuses an unknown modelId with a way forward, on the lane face too", async () => {
    const payload = await laneCall({ modelId: "no-such-model-anywhere" });
    expect(payload.model).toBeNull();
    expect(String(payload.recoveryActions)).toContain("list_models");
  });
});


it('publishes imported graph modes and exact scalar parameters in the native handbook', () => {
  const key='comfy-minimax-h3-local';
  const imported={...state, models:[...state.models,{modelKey:key,vendorKey:'comfyui-local',labelZh:'Local graph',kind:'video' as const,enabled:true,createdAt:'now',updatedAt:'now',meta:{adapter:{state:'verified',activeRevision:'test',modes:[{taskKind:'image_to_video',state:'verified'}]},comfyWorkflowImport:{binding:{outputKind:'video'}},parameters:[{key:'frame',type:'image-url',mediaKind:'image'},{key:'steps',type:'number',default:8}]}}]};
  imported.mappings=[...imported.mappings,{id:'local-workflow-test',vendorKey:'comfyui-local',modelKey:key,taskKind:'image_to_video',name:'local',enabled:true,createdAt:'now',updatedAt:'now',create:{method:'POST',path:'/prompt',body:{prompt:'{{request.prompt}}'}}}];
  const row=agentModelEntriesFromCatalog(imported).find(row=>row.entry.modelId===key);
  expect(row?.entry.defaultModeId).toBe('image_to_video');
  expect(row?.entry.modes.map(mode=>mode.modeId)).toEqual(['image_to_video']);
  expect(row?.entry.modes[0]?.params).toEqual([expect.objectContaining({key:'steps',defaultValue:8})]);
  const malformed=structuredClone(imported);
  malformed.models.at(-1)!.meta={adapter:{state:'verified',activeRevision:'test',modes:[{taskKind:'image_to_video',state:'verified'}]},comfyWorkflowImport:{binding:{}},parameters:[]};
  expect(agentModelEntriesFromCatalog(malformed).find(row=>row.entry.modelId===key)).toBeUndefined();
  malformed.models.at(-1)!.meta={adapter:{state:'verified',activeRevision:'test',modes:[{taskKind:'image_to_video',state:'verified'}]}};
  const unprofiled=agentModelEntriesFromCatalog(malformed).find(row=>row.entry.modelId===key);
  expect(unprofiled?.entry.modes).toEqual([]);
  expect(unprofiled?.entry.defaultModeId).toBe('');

});
