// 中转视频通道启动体检（#1213）：被旧判据错切到方舟原生报文的模型要降回通用通道；探不到不动；
// 有合同证据才升级；存量旧版通用查询刷成 canonical。目录是内存版，探测结论直接给——测的是
// 「拿到哪种结论就改成哪种通道」这条决策，探测本身的判据在 nativeEndpointProbe.test.ts。
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mapping, Model } from "./types";

const state = vi.hoisted(() => ({
  models: [] as Model[],
  mappings: [] as Mapping[],
  verdict: "no-contract" as "contract" | "no-contract" | "unreachable",
  warnings: [] as Array<{ event: string; fields: Record<string, unknown> }>,
}));

vi.mock("./secrets", () => ({ decryptApiKeyRecord: () => "relay-key" }));
vi.mock("./nativeEndpointProbe", () => ({
  probeNativeEndpoint: vi.fn(async () => ({ exists: state.verdict === "contract", verdict: state.verdict, detail: `verdict ${state.verdict}` })),
}));
vi.mock("../logging/logger", () => ({
  logInfo: vi.fn(),
  logWarn: (_scope: string, event: string, fields: Record<string, unknown>) => state.warnings.push({ event, fields }),
}));
vi.mock("./catalogStore", () => ({
  listModelCatalogModels: () => state.models,
  listModelCatalogMappings: () => state.mappings,
  listModelCatalogVendors: () => [{ key: "relay", name: "relay", enabled: true, baseUrlHint: "https://relay.example/v1", authType: "bearer" }],
  readCatalog: () => ({ apiKeysByVendor: { relay: { apiKey: "x" } } }),
  upsertModelCatalogMapping: (payload: Mapping) => {
    const index = state.mappings.findIndex((m) => m.vendorKey === payload.vendorKey && m.taskKind === payload.taskKind && (m.modelKey || undefined) === (payload.modelKey || undefined));
    const next = { ...(index >= 0 ? state.mappings[index] : {}), ...payload } as Mapping;
    if (index >= 0) state.mappings[index] = next;
    else state.mappings.push(next);
    return next;
  },
  upsertModelCatalogModel: (payload: Partial<Model>) => {
    const index = state.models.findIndex((m) => m.vendorKey === payload.vendorKey && m.modelKey === payload.modelKey);
    state.models[index] = { ...state.models[index], ...payload } as Model;
  },
}));

import { upgradeRelayModelsToNativeWire } from "./relayNativeWireUpgrade";
import { nativeWireProfileForArchetype } from "./nativeWireProfiles";
import { NEWAPI_VIDEO_CREATE_OP, NEWAPI_VIDEO_QUERY_OP, NEWAPI_STATUS_MAPPING } from "./newapiTransport";

const MODEL_KEY = "doubao-seedance-2-0-fast-260128";
const native = nativeWireProfileForArchetype("volcengine-seedance-2")!;
const LEGACY_QUERY = { ...NEWAPI_VIDEO_QUERY_OP, response_mapping: { task_id: "task_id", status: "status", video_url: "data[*].url", error_message: "error.message" } };

function seedModel(meta: Record<string, unknown>): void {
  state.models = [{ modelKey: MODEL_KEY, vendorKey: "relay", labelZh: "Seedance fast", kind: "video", enabled: true, meta, createdAt: "", updatedAt: "" } as Model];
}
function seedNativeMappings(query = native.query): void {
  state.mappings = (["text_to_video", "image_to_video"] as const).map((taskKind) => ({
    vendorKey: "relay", taskKind, modelKey: MODEL_KEY, name: "native", enabled: true,
    create: native.create[taskKind]!, query, statusMapping: native.statusMapping, createdAt: "", updatedAt: "",
  }) as Mapping);
}
function seedGenericMappings(query: Mapping["query"] = NEWAPI_VIDEO_QUERY_OP): void {
  state.mappings = (["text_to_video", "image_to_video"] as const).map((taskKind) => ({
    vendorKey: "relay", taskKind, modelKey: MODEL_KEY, name: "generic", enabled: true,
    create: NEWAPI_VIDEO_CREATE_OP, query, statusMapping: NEWAPI_STATUS_MAPPING, createdAt: "", updatedAt: "",
  }) as Mapping);
}

beforeEach(() => {
  state.warnings = [];
});

describe("中转视频通道启动体检", () => {
  it("#1213：已切原生、探测拿不到合同证据 → 降回通用通道，撤掉 wireProfile/archetypeId，留日志写清新旧判据", async () => {
    seedModel({ parameters: [], wireProfile: "volcengine-seedance-2", archetypeId: "volcengine-seedance-2" });
    seedNativeMappings();
    state.verdict = "no-contract";

    const [outcome] = await upgradeRelayModelsToNativeWire();

    expect(outcome).toMatchObject({ modelKey: MODEL_KEY, downgraded: true, upgraded: false });
    for (const taskKind of ["text_to_video", "image_to_video"]) {
      const mapping = state.mappings.find((m) => m.taskKind === taskKind)!;
      expect(mapping.create.path).toBe("/v1/video/generations");
      expect(mapping.query).toEqual(NEWAPI_VIDEO_QUERY_OP);
      expect(mapping.statusMapping).toEqual(NEWAPI_STATUS_MAPPING);
    }
    // 不撤 archetypeId，modelRetype 会不经探测把原生报文装回来。
    expect(state.models[0].meta).toEqual({ parameters: [] });
    expect(state.warnings).toEqual([
      expect.objectContaining({
        event: "relay-native-wire-downgraded",
        fields: expect.objectContaining({ modelKey: MODEL_KEY, oldCriterion: expect.any(String), newCriterion: expect.any(String) }),
      }),
    ]);
  });

  it("探不到（unreachable）不是「没有」：已切原生的模型原样不动", async () => {
    seedModel({ wireProfile: "volcengine-seedance-2", archetypeId: "volcengine-seedance-2" });
    seedNativeMappings();
    state.verdict = "unreachable";

    const [outcome] = await upgradeRelayModelsToNativeWire();

    expect(outcome.downgraded).toBeUndefined();
    expect(state.mappings.every((m) => m.create.path === native.create.text_to_video!.path)).toBe(true);
    expect(state.warnings).toEqual([]);
  });

  it("有合同证据才升级；已在原生的旧 query 刷成 canonical（含中转信封的结果地址位置）", async () => {
    seedModel({});
    seedGenericMappings();
    state.verdict = "contract";
    expect((await upgradeRelayModelsToNativeWire())[0].upgraded).toBe(true);
    expect(state.mappings.find((m) => m.taskKind === "text_to_video")!.create.path).toBe(native.create.text_to_video!.path);

    seedNativeMappings({ ...native.query!, response_mapping: { video_url: "content.video_url" } });
    const [again] = await upgradeRelayModelsToNativeWire();
    expect(again.detail).toContain("query refreshed");
    expect(state.mappings.every((m) => JSON.stringify(m.query) === JSON.stringify(native.query))).toBe(true);
  });

  it("没被切过的通用通道 + 无证据：通道不动；存量旧版通用查询刷成读官方 new-api 信封的 canonical", async () => {
    seedModel({});
    seedGenericMappings(LEGACY_QUERY as Mapping["query"]);
    state.verdict = "no-contract";

    const [outcome] = await upgradeRelayModelsToNativeWire();

    expect(outcome).toMatchObject({ upgraded: false });
    expect(outcome.downgraded).toBeUndefined();
    expect(state.mappings.every((m) => JSON.stringify(m.query) === JSON.stringify(NEWAPI_VIDEO_QUERY_OP))).toBe(true);
  });

  it("用户手改过的通用查询不碰（只认我们自己发过的原样）", async () => {
    seedModel({});
    const custom = { ...NEWAPI_VIDEO_QUERY_OP, response_mapping: { status: "status", video_url: "result.my_url" } };
    seedGenericMappings(custom as Mapping["query"]);
    state.verdict = "no-contract";

    await upgradeRelayModelsToNativeWire();

    expect(state.mappings.every((m) => JSON.stringify(m.query) === JSON.stringify(custom))).toBe(true);
  });
});
