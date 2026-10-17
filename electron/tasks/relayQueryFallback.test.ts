// 运行中退回（#1213 原则 2，协调 10-16 裁定 N=3）：中转上的方舟原生通道查询，连续 3 次按合同认出的
// 非瞬时失败（无可用渠道 / 路由不存在 / 任务号无效）→ 单向退回通用通道、记日志；这一单免费用通用查询
// 再试一次，不重新提交。普通 5xx、429、网络抖动不算。技术详情里写清「已从 X 退回 Y」。
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
import { NEWAPI_VIDEO_QUERY_OP } from "../catalog/newapiTransport";
import { resetRelayQueryFallbackStateForTests, isContractNonTransientQueryFailure } from "../catalog/relayNativeWireUpgrade";
import { VendorRequestError } from "../vendor/vendorHttp";
// 模块顶层取（不在测试体里冷加载）：taskResultQuery ↔ runtime 是调用时循环依赖，要等 vi.mock 生效后再取。
const { fetchTaskResult } = await import("./taskResultQuery");
const { admitTask, taskCache } = await import("../runtime");

const MODEL_KEY = "doubao-seedance-2-0-fast-260128";
const native = nativeWireProfileForArchetype("volcengine-seedance-2")!;
const MP4 = "https://result-cdn.example.test/v.mp4";

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
  resetRelayQueryFallbackStateForTests();
});

describe("运行中退回：中转原生通道", () => {
  it("连续 3 次「无可用渠道」→ 退回通用通道、这一单用通用查询免费再查一次就取回；技术详情写清退回", async () => {
    await seed("task_pub123");
    executeProfileOperation.mockImplementation(async ({ operation }: { operation: { path: string } }) => {
      if (operation.path === NEWAPI_VIDEO_QUERY_OP.path) return { response: { code: "success", data: { task_id: "task_pub123", status: "SUCCESS", result_url: MP4 } }, request: {} };
      throw vendorError(503, "当前分组 default 下对于模型  无可用渠道");
    });

    for (let i = 1; i <= 2; i += 1) {
      await expect(fetchTaskResult({ taskId: "task_pub123" })).rejects.toThrow(/NOMI_ERR::retrieval-query::[\s\S]*无可用渠道/);
    }
    // 前两次没退：通道还是原生。
    expect(state.mappings[0].query?.path).toBe(native.query!.path);

    const third = await fetchTaskResult({ taskId: "task_pub123" });
    expect(third.result.status).toBe("succeeded");
    expect(third.result.assets[0]?.providerUrl ?? third.result.assets[0]?.url).toBe(MP4);
    // 单向退回：目录里这个模型已是通用通道，撤掉了原生标注；日志留痕。
    expect(state.mappings.find((m) => m.taskKind === "image_to_video")?.query).toEqual(NEWAPI_VIDEO_QUERY_OP);
    expect(state.models[0].meta).not.toHaveProperty("wireProfile");
    expect(state.warnings.map((w) => w.event)).toContain("relay-native-wire-fell-back-at-runtime");
  });

  it("退回后通用查询也失败：错误里写清「已从 X 退回 Y」与查询阶段", async () => {
    await seed("task_cgt");
    executeProfileOperation.mockImplementation(async () => {
      throw vendorError(404, "Invalid URL (GET /api/v3/contents/generations/tasks/task_cgt)");
    });
    for (let i = 1; i <= 2; i += 1) await expect(fetchTaskResult({ taskId: "task_cgt" })).rejects.toThrow(/retrieval-query/);
    await expect(fetchTaskResult({ taskId: "task_cgt" })).rejects.toThrow(/火山方舟原生[\s\S]*new-api[\s\S]*Invalid URL/);
  });

  it("普通 5xx / 429 / 网络抖动不算数，不退回", async () => {
    expect(isContractNonTransientQueryFailure(vendorError(502, "Bad Gateway"))).toBe(false);
    expect(isContractNonTransientQueryFailure(vendorError(429, "rate limited"))).toBe(false);
    expect(isContractNonTransientQueryFailure(vendorError(undefined, "fetch failed"))).toBe(false);
    expect(isContractNonTransientQueryFailure(new Error("socket hang up"))).toBe(false);
    expect(isContractNonTransientQueryFailure(vendorError(503, "当前分组 default 下对于模型  无可用渠道"))).toBe(true);
    expect(isContractNonTransientQueryFailure(vendorError(404, "Invalid URL"))).toBe(true);
    expect(isContractNonTransientQueryFailure(vendorError(400, "invalid task id"))).toBe(true);

    await seed("task_flaky");
    executeProfileOperation.mockImplementation(async () => {
      throw vendorError(502, "Bad Gateway");
    });
    for (let i = 1; i <= 4; i += 1) await expect(fetchTaskResult({ taskId: "task_flaky" })).rejects.toThrow(/retrieval-query/);
    expect(state.mappings[0].query?.path).toBe(native.query!.path);
    expect(state.warnings).toEqual([]);
  });
});
