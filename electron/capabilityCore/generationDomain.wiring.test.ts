/**
 * 工厂自己那几行接线，跑真的 `createGenerationDomain`，改坏就红。
 *
 * 别的测试量的是「规划逻辑拿到这次调用的目录之后怎么用」，用的是测试自己写的宿主桩；它们不经过工厂。
 * 所以工厂里这几行被改坏时它们不会红（独立验收 2026-11-22 试出来的两种改法）：
 *  · 准备授权时把价格改回「现读盘上的」而不是这次调用入口那一版；
 *  · 删掉「参考素材的身份归项目素材库管」那一行（2026-09-22 应用内宿主漏接过的那一行）。
 *
 * 这里只把规划逻辑的入口换成「记下工厂交给它的东西」，工厂本身、它写的三个宿主回调都是真的；
 * 回调往下调的那一层（授权信封、素材库、工作区）换成桩，看工厂递下去的是什么。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GenerationHostPorts } from "./generationDomain";
import type { LiveGenerationCallCatalog } from "./liveGenerationRuntime";
import type { GenerationPlanningHandlerDependencies } from "./mcpGenerationTools";

const seen = vi.hoisted(() => ({
  planningDeps: undefined as unknown,
  authorization: [] as unknown[],
  identityLookups: [] as Array<[string, string]>,
}));

vi.mock("electron", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ipcMain: { on: () => undefined, handle: () => undefined, removeHandler: () => undefined } };
});
vi.mock("./mcpGenerationTools", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  createGenerationPlanningHandler: (deps: unknown) => {
    seen.planningDeps = deps;
    return async () => ({});
  },
}));
vi.mock("../assets/projectAssetStore", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  resolveProjectAssetReferenceIdentity: (projectId: string, assetId: string) => {
    seen.identityLookups.push([projectId, assetId]);
    return { contentHash: `hash-of-${assetId}`, version: 1 as const, kind: "image" as const };
  },
}));
vi.mock("../productionRun/prepareProductionGenerationAuthorization", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  prepareProductionGenerationAuthorizationWithReferences: async (input: unknown) => {
    seen.authorization.push(input);
    return { prepared: true };
  },
}));
vi.mock("./generationReferenceScope", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  createGenerationReferenceScopeGuard: () => () => undefined,
}));
vi.mock("../workspace/workspaceRepository", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  readWorkspaceProject: (projectId: string) => ({ id: projectId, name: "纸鹤", revision: 7, immutableProjectUuid: "uuid-1", projectGeneration: 1 }),
  resolveWorkspaceProjectDir: () => "/tmp/nomi-wiring-test-project",
}));
vi.mock("../runtimePaths", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  getWorkspaceRepositoryDeps: () => ({}),
}));

const RUN_SNAPSHOT = { runId: "op-1", revision: 3 };

function hostPorts(): GenerationHostPorts {
  return {
    runs: { repository: { read: () => RUN_SNAPSHOT } } as never,
    renderer: null,
    landShots: async () => undefined as never,
    onPlanChanged: () => undefined,
    settleBeforeAuthorization: async () => undefined,
    kickMultiShotBatch: async ({ operation }) => ({ operationId: operation.operationId, state: "submitted", nextAction: "observe" }),
    observeSingleShot: () => undefined,
    onReconciled: () => undefined,
  };
}

async function factoryWiring() {
  // 工厂模块在加载时拿走「往名单里记」的能力，只发一次：每条用例要一份新的模块实例。
  vi.resetModules();
  // 上一行重置了模块，这里必须重新加载才拿得到新实例。
  const { createGenerationDomain } = await import("./generationDomain");
  createGenerationDomain(hostPorts());
  return seen.planningDeps as GenerationPlanningHandlerDependencies<LiveGenerationCallCatalog>;
}

beforeEach(() => {
  seen.planningDeps = undefined;
  seen.authorization = [];
  seen.identityLookups = [];
});

describe("工厂自己的接线", () => {
  it("准备授权：记进授权信封的价格和执行器，是这次调用入口那一版目录的，不是另读的", async () => {
    const wiring = await factoryWiring();
    // 这次调用入口取的那一版。价格函数和执行器表都是这一版独有的对象：工厂要是另去读一份，递下去的就不是它们。
    const entryPrice = { known: true as const, amount: 7, currency: "CNY" };
    const call = {
      bootstrap: { providers: [{ providerId: "entry-version-provider" }] },
      resolveShotPrice: () => entryPrice,
    } as unknown as LiveGenerationCallCatalog;

    await wiring.prepareAuthorization!({
      lease: { projectId: "project-1", immutableProjectUuid: "uuid-1", projectGeneration: 1 } as never,
      operation: { operationId: "op-1" } as never,
      contract: {} as never,
    }, call);

    expect(seen.authorization).toHaveLength(1);
    const handed = seen.authorization[0] as { resolveShotPrice: (...args: never[]) => unknown; providers: unknown; projectRevision: number; run: unknown };
    expect(handed.resolveShotPrice).toBe(call.resolveShotPrice);
    expect(handed.resolveShotPrice()).toBe(entryPrice);
    expect(handed.providers).toBe(call.bootstrap.providers);
    // 同一份授权里的另外两样也来自宿主此刻的事实，不是编的。
    expect(handed.projectRevision).toBe(7);
    expect(handed.run).toBe(RUN_SNAPSHOT);
  });

  it("参考素材的身份：工厂把它接到项目素材库，模型只给 assetId 就查得到", async () => {
    const wiring = await factoryWiring();

    expect(wiring.resolveAssetReferenceIdentity, "工厂没有把素材身份解析交给规划").toBeTypeOf("function");
    const identity = wiring.resolveAssetReferenceIdentity!("project-1", "asset-9");

    expect(seen.identityLookups).toEqual([["project-1", "asset-9"]]);
    expect(identity).toEqual({ contentHash: "hash-of-asset-9", version: 1, kind: "image" });
  });
});
