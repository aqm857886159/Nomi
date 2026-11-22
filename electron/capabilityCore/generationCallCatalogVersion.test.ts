/**
 * 一次生成调用从头到尾只用一版目录：模型表和价格是同一版。
 *
 * 过门（gate_request）里真会让出执行权的步骤有两处，都在「准备授权」里：应用内宿主先等画布落地落完，
 * 有参考素材时还要解析参考（上传 / 换地址，按秒计）。创作者在这段时间里改了价、或删了这个模型，
 * 这次调用后半段读到的价格就该仍是入口那一版——否则模型表是一版、记钱是另一版。
 *
 * 这里用一个会真让出执行权的「准备授权」桩代替那两步（桩不回授权信封）。桩在调用里拿到的目录
 * 就是宿主在这一步拿到的那一个（规划把入口那一版当最后一个参数传下来）；宿主按它的
 * `resolveShotPrice` 往授权信封里记钱。
 *
 * 修前（2026-11-21，主分支 24b1ad04d）这两条都红：只改价 → 信封会记 19，入口是 7；
 * 删模型 → 模型表说还在、价格说没了。修前的测试正文留在
 * docs/evidence/2026-11-21-generation-assembly/red5-before-fix.test.ts.txt。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { deleteModelCatalogModel, readCatalog, upsertModelCatalogModel } from "../catalog/catalogStore";
import { createLiveGenerationRuntime } from "./liveGenerationRuntime";
import { createGenerationPlanningHandler, createInMemoryGenerationOperationStore } from "./mcpGenerationTools";
import { freshSettingsDir, restoreSettingsDir } from "./externalAgentGateTestUtils";

vi.mock("electron", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ipcMain: { on: () => undefined, handle: () => undefined, removeHandler: () => undefined },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`enc:${value}`, "utf8"),
      decryptString: (buffer: Buffer) => buffer.toString("utf8").replace(/^enc:/, ""),
    },
  };
});

afterEach(() => { restoreSettingsDir(); });

const lease = { projectId: "project-1" } as never;
const ENTRY_PRICE = 7;
const EDITED_PRICE = 19;

function builtinImageModel(runtime: ReturnType<typeof createLiveGenerationRuntime>) {
  for (const manifest of runtime.current().registry.snapshot()) {
    if (!manifest.outputKinds.includes("image")) continue;
    for (const provider of manifest.providers) {
      if (provider.providerId !== "apimart") continue;
      const model = provider.models.find((row) => row.modelId.includes("seedream"));
      if (model) return { moduleId: manifest.moduleId, providerId: "apimart", modelId: model.modelId, mode: model.modes[0]! };
    }
  }
  throw new Error("no built-in APIMart image model in the registry");
}

function setPrice(modelKey: string, cost: number): void {
  const row = readCatalog().models.find((model) => model.vendorKey === "apimart" && model.modelKey === modelKey)!;
  upsertModelCatalogModel({ ...row, pricing: { cost, enabled: true, specCosts: [] } });
}

/** 走一次过门；`duringReferenceResolve` 在「解析参考素材」那一步里执行（创作者这时动了目录）。 */
async function gateWhileCatalogChanges(duringReferenceResolve: (modelKey: string) => void) {
  freshSettingsDir("call-version");
  const runtime = createLiveGenerationRuntime();
  const picked = builtinImageModel(runtime);
  setPrice(picked.modelId, ENTRY_PRICE);

  const seen: { modelTableStillHasIt?: boolean; priceSealedIntoEnvelope?: unknown } = {};
  const handler = createGenerationPlanningHandler({
    // 目录就绪照真的来会卡在「没存密钥」上，这条测的不是它：只把就绪换成「就绪」，其余都是这次调用的那一版。
    catalog: { openCall: () => { const call = runtime.openCall(); return Object.create(call, { providerReadiness: { value: () => ({ providerReady: true, missingForSubmit: [] }) } }) as typeof call; } },
    operations: createInMemoryGenerationOperationStore(),
    now: () => "2026-11-21T00:00:00.000Z",
    prepareAuthorization: async ({ contract }, catalog) => {
      await new Promise((resolve) => setImmediate(resolve)); // 等画布落地 / 解析参考：真让出执行权
      duringReferenceResolve(picked.modelId);
      // 生产里授权信封就在这一步之后按这次调用的 `catalog.resolveShotPrice(contract)` 记钱。
      seen.priceSealedIntoEnvelope = catalog.resolveShotPrice(contract);
      try { catalog.registry.resolve({ moduleId: picked.moduleId, providerId: picked.providerId, modelId: picked.modelId, mode: picked.mode }); seen.modelTableStillHasIt = true; }
      catch { seen.modelTableStillHasIt = false; }
      return undefined as never;
    },
  });
  const created = await handler({ capability: "create", params: { candidate: { candidateId: "c1", revision: 1, moduleId: picked.moduleId, providerId: picked.providerId, modelId: picked.modelId, mode: picked.mode, prompt: "a red apple", parameters: {} } }, lease } as never) as { operation: { operationId: string } };
  const operationId = created.operation.operationId;
  const preview = await handler({ capability: "preview", params: { operationId }, lease } as never) as { pricing: { shots: Array<{ price: unknown }> } };
  const gate = await handler({ capability: "gate_request", params: { operationId }, lease } as never) as { costKnown: boolean; maximumCost: number | null };
  return { preview, gate, seen };
}

describe("一次调用只用一版目录", () => {
  it("只改价：封进授权的价 = 这次调用入口那一版的价", async () => {
    const { preview, gate, seen } = await gateWhileCatalogChanges((modelKey) => setPrice(modelKey, EDITED_PRICE));
    // 先证明不是空断言：入口那一版的价真的是已知的 7。
    expect(preview.pricing.shots[0].price).toEqual({ known: true, amount: ENTRY_PRICE });
    expect({ replyCostKnown: gate.costKnown, replyMaximumCost: gate.maximumCost }).toEqual({ replyCostKnown: true, replyMaximumCost: ENTRY_PRICE });
    expect(seen.priceSealedIntoEnvelope).toEqual({ known: true, amount: ENTRY_PRICE });
  });

  it("删了这个模型：模型表和价格说的是同一版（要么都还在，要么都没了）", async () => {
    const { preview, gate, seen } = await gateWhileCatalogChanges((modelKey) => deleteModelCatalogModel("apimart", modelKey));
    expect(preview.pricing.shots[0].price).toEqual({ known: true, amount: ENTRY_PRICE });
    expect(gate.costKnown).toBe(true);
    const priceStillKnown = (seen.priceSealedIntoEnvelope as { known: boolean }).known;
    expect({ modelTable: seen.modelTableStillHasIt, price: priceStillKnown }).toEqual({ modelTable: true, price: true });
  });
});
