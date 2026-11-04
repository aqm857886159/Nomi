// Accepted query contracts stay fixed even after repeated HTTP failures.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mapping, Model } from "../catalog/types";

const state = vi.hoisted(() => ({
  models: [] as Model[],
  mappings: [] as Mapping[],
  warnings: [] as Array<{ event: string; fields: Record<string, unknown> }>,
}));
const executeProfileOperation = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/nomi-relay-fallback", getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false },
  webContents: { getAllWebContents: () => [] },
}));
vi.mock("../logging/logger", async () => {
  const actual = await vi.importActual<typeof import("../logging/logger")>("../logging/logger");
  return { ...actual, logWarn: (_scope: string, event: string, fields: Record<string, unknown>) => state.warnings.push({ event, fields }) };
});
vi.mock("../catalog/catalogStore", async () => {
  const actual = await vi.importActual<typeof import("../catalog/catalogStore")>("../catalog/catalogStore");
  return {
    ...actual,
    listModelCatalogModels: () => state.models,
    listModelCatalogMappings: () => state.mappings,
    upsertModelCatalogMapping: (payload: Mapping) => {
      const index = state.mappings.findIndex((m) => m.vendorKey === payload.vendorKey && m.taskKind === payload.taskKind && m.modelKey === payload.modelKey);
      const next = { ...(index >= 0 ? state.mappings[index] : {}), ...payload } as Mapping;
      if (index >= 0) state.mappings[index] = next;
      else state.mappings.push(next);
      return next;
    },
    upsertModelCatalogModel: (payload: Partial<Model>) => {
      const index = state.models.findIndex((m) => m.vendorKey === payload.vendorKey && m.modelKey === payload.modelKey);
      state.models[index] = { ...state.models[index], ...payload } as Model;
    },
  };
});
vi.mock("../runtime", async () => {
  const actual = await vi.importActual<typeof import("../runtime")>("../runtime");
  return {
    ...actual,
    executeProfileOperation: (...args: unknown[]) => executeProfileOperation(...args),
    findExecutableModel: () => ({ vendor: { key: "relay", baseUrlHint: "https://relay.example.test/v1" }, model: state.models[0], apiKey: "k" }),
    findTaskMapping: (_vendor: string, taskKind: string) => state.mappings.find((m) => m.taskKind === taskKind) ?? null,
  };
});

import { nativeWireProfileForArchetype } from "../catalog/nativeWireProfiles";

import { VendorRequestError } from "../vendor/vendorHttp";
// 模块顶层取（不在测试体里冷加载）：taskResultQuery ↔ runtime 是调用时循环依赖，要等 vi.mock 生效后再取。
const { fetchTaskResult } = await import("./taskResultQuery");
const { admitTask, taskCache } = await import("../runtime");

const MODEL_KEY = "doubao-seedance-2-0-fast-260128";
const native = nativeWireProfileForArchetype("volcengine-seedance-2")!;

function vendorError(httpStatus: number | undefined, upstreamMsg: string): VendorRequestError {
  return new VendorRequestError(`Provider request failed (HTTP ${httpStatus}) at relay GET x: ${upstreamMsg}`, {
    vendorKey: "relay", method: "GET", url: "https://relay.example.test/api/v3/contents/generations/tasks/x",
    ...(httpStatus ? { httpStatus } : {}), upstreamMsg, category: "server", retryable: true,
  } as never);
}

async function seed(taskId: string) {
  state.models = [{ modelKey: MODEL_KEY, vendorKey: "relay", labelZh: "Seedance fast", kind: "video", enabled: true, meta: { wireProfile: "volcengine-seedance-2", archetypeId: "volcengine-seedance-2" }, createdAt: "", updatedAt: "" } as Model];
  state.mappings = [{ vendorKey: "relay", taskKind: "image_to_video", modelKey: MODEL_KEY, name: "native", enabled: true, create: native.create.image_to_video!, query: native.query, statusMapping: native.statusMapping, createdAt: "", updatedAt: "" } as Mapping];
  taskCache.delete(taskId);
  admitTask(taskId, {
    vendor: "relay",
    request: { kind: "image_to_video", prompt: "cat", extras: { modelKey: MODEL_KEY } },
    raw: {},
    mapping: state.mappings[0],
    model: state.models[0],
    providerMeta: { task_id: taskId, query_id: taskId },
    wantedKind: "video",
  });
}

beforeEach(() => {
  executeProfileOperation.mockReset();
  state.warnings = [];
});

describe("accepted relay query contracts remain immutable", () => {
  it.each([400, 404, 429, 502, 503])("HTTP %s never switches the stored or accepted query to a guessed route", async (httpStatus) => {
    await seed("accepted-original");
    const before = structuredClone(state.mappings);
    executeProfileOperation.mockImplementation(async () => { throw vendorError(httpStatus, "contract unavailable"); });
    for (let i = 0; i < 4; i++) await expect(fetchTaskResult({ taskId: "accepted-original" })).rejects.toThrow(/retrieval-query/);
    expect(state.mappings).toEqual(before);
    expect(executeProfileOperation).toHaveBeenCalledTimes(4);
    expect(executeProfileOperation.mock.calls.every(([input]) => input.operation.path === native.query!.path)).toBe(true);
    expect(taskCache.get("accepted-original")).toBeTruthy();
  });
});
