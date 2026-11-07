// Stored wire authorship is ambiguous: startup preserves every saved contract.
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

describe("legacy relay wire preservation", () => {
  it.each(["contract", "no-contract", "unreachable"] as const)("%s cannot rewrite a saved native query or create a guessed replacement", async (verdict) => {
    seedModel({ wireProfile: "volcengine-seedance-2", archetypeId: "volcengine-seedance-2", userNote: "keep contract" });
    seedNativeMappings({ ...native.query!, headers: { "x-contract": "explicit-user" } });
    const before = structuredClone({ models: state.models, mappings: state.mappings });
    state.verdict = verdict;
    await upgradeRelayModelsToNativeWire();
    expect({ models: state.models, mappings: state.mappings }).toEqual(before);
    expect(state.warnings).toEqual([]);
  });
  it("keeps indistinguishable legacy generic rows byte-for-byte, including the original accepted-task query", async () => {
    seedModel({});
    seedGenericMappings(LEGACY_QUERY as Mapping["query"]);
    const before = JSON.stringify(state.mappings);
    await upgradeRelayModelsToNativeWire();
    expect(JSON.stringify(state.mappings)).toBe(before);
  });
  it("cannot manufacture mappings for a video model with no stored contract", async () => {
    seedModel({}); state.mappings = []; state.verdict = "contract";
    await upgradeRelayModelsToNativeWire();
    expect(state.mappings).toEqual([]);
  });
});
