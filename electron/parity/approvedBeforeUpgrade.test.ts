/**
 * 升级路径钉子（方式参数 owner，设计卡 docs/plan/2026-11-12-mode-params-owner.md ★1c）：
 * Run 路（Agent / 多镜批量）批准时存的是 provider.buildRequest 输出的指纹（providerWirePayloadHash，
 * prepareProductionGenerationAuthorization.ts），派发前用当时的代码重算再比（productionGenerationSubmission.ts 的
 * 「Provider wire payload no longer matches the approved authorization」）。这一刀改了两类 Run 请求体的字节：
 *   ① ref 方式自己控件上的比例 / size 默认值以前没发、现在发（官方矩阵登记的 24 份）；
 *   ② 参数里带着别的方式的键，现在剥掉。
 * 所以跨升级、已批准未发完的 Run 里，这两类镜头的旧指纹对不上 → 这一镜不发（零副作用由
 * productionGenerationAuthorizationFlow.test.ts「rejects provider payload drift before any durable or provider side effect」钉住），
 * 要重新批一次；请求体没变的镜头旧指纹照样对得上 → 照发。
 *
 * 下面的 OLD_HASH 是修前代码（3f40a0efc）对同一份合同算出的指纹：重算方法见文件尾注释。
 */
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => {
  const nodeFs = await import("node:fs");
  const os = await import("node:os");
  const nodePath = await import("node:path");
  const { electronStub } = await import("./parityElectronMock");
  return electronStub(nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "nomi-approved-upgrade-")));
});
vi.mock("../capabilityCore/rendererBridge", () => ({
  requestRendererDecision: async () => ({ confirmed: true }),
  requestRenderer: async (operation: string) => {
    throw new Error(`no renderer bridge in approved-before-upgrade: ${operation}`);
  },
}));

import { getArchetypeById, specializeArchetypeForVendor } from "../shared/modelArchetypes";
import { modeTransportFor } from "../shared/videoCapabilities/modeTransport";
import { spendReferenceKey } from "../shared/contracts/pendingSpendConfirm";
import { placeUploadedImages } from "../../src/workbench/generationCanvas/nodes/controls/referenceList";
import { assertProductionGenerationPayloadHash } from "../productionRun/productionGenerationAuthorization";
import { installFetchCapture, seedParityCatalog } from "./generationParityTestUtils";

const capture = installFetchCapture();
await seedParityCatalog(["apimart"]);
afterAll(() => capture.restore());

type Case = { name: string; archetypeId: string; modelId: string; modeId: string; parameters: Record<string, unknown> };

/** 与真实宿主同形：候选归一 → 编译合同 → 运行时适配器 prepareAuthorization（批准时算指纹的就是它）。 */
async function prepared(c: Case): Promise<{ providerRequest: Record<string, unknown>; providerRequestHash: string }> {
  const store = await import("../catalog/catalogStore");
  const state = store.readCatalog();
  const { createGenerationProviderBootstrap } = await import("../capabilityCore/generationProviderBootstrap");
  const bootstrap = createGenerationProviderBootstrap(state, { catalogReader: () => store.readCatalog() });
  const provider = bootstrap.providers.find((candidate) => candidate.providerId === "apimart")!;
  const { createCatalogModuleRegistry } = await import("../capabilityCore/moduleCatalogBootstrap");
  const { compileExecutionContract } = await import("../capabilityCore/executionContract");
  const { normalizeVideoCandidate } = await import("../capabilityCore/mcpGenerationVideoResolve");
  const { deriveUsableVideoModelCandidates } = await import("../capabilityCore/usableVideoModelCandidates");
  const { createGenerationRuntimeAdapter } = await import("../capabilityCore/generationRuntimeAdapter");
  const archetype = specializeArchetypeForVendor(getArchetypeById(c.archetypeId)!, "apimart");
  const mode = archetype.modes.find((candidate) => candidate.id === c.modeId)!;
  const slots = mode.slots.filter((slot: { kind: string }) => ["first_frame", "last_frame", "image_ref"].includes(slot.kind));
  const urls = Array.from({ length: Math.max(1, slots.reduce((sum: number, slot: { min: number }) => sum + slot.min, 0)) }, (_, i) => `https://assets.example.com/ref/img-${i + 1}.png`);
  const placed = placeUploadedImages(mode, slots.length ? urls : []);
  const references: Array<{ assetId: string; contentHash: string; version: number; kind: "image"; role: "first_frame" | "last_frame" | "reference" }> = [];
  mode.slots.forEach((slot: { kind: string }, i: number) => (placed.bySlot[i] ?? []).forEach((u: string) => references.push({
    assetId: u, contentHash: `h-${references.length}`, version: 1, kind: "image",
    role: slot.kind === "first_frame" ? "first_frame" : slot.kind === "last_frame" ? "last_frame" : "reference",
  })));
  const referenceUrls = Object.fromEntries(references.map((r) => [spendReferenceKey(r as never), r.assetId]));
  const candidate = normalizeVideoCandidate({
    candidateId: "upgrade-candidate", revision: 1, moduleId: "generation.single-shot", providerId: "apimart",
    modelId: c.modelId, mode: modeTransportFor(mode, archetype, "apimart") ?? "", modeId: c.modeId,
    prompt: "一个镜头", parameters: c.parameters, references,
  }, deriveUsableVideoModelCandidates());
  const registry = createCatalogModuleRegistry(state, { readinessByProvider: bootstrap.readinessByProvider });
  const contract = compileExecutionContract(candidate, registry, { referenceSourceUrls: references.map((r) => referenceUrls[spendReferenceKey(r as never)]) });
  const out = createGenerationRuntimeAdapter({ providers: [provider] }).prepareAuthorization({ contract, providerIdempotencyKey: "upgrade-idempotency-key", referenceUrls });
  return { providerRequest: out.providerRequest as Record<string, unknown>, providerRequestHash: out.providerRequestHash };
}

const CASES = {
  /** ① 官方矩阵登记的 24 份之一：wan2.7 参考生视频，以前不发 size，现在发 ref 方式自己的默认 16:9。 */
  refDefault: { name: "wan2.7 ref（多一个 size）", archetypeId: "wan-2.7", modelId: "wan2.7", modeId: "ref", parameters: {} },
  /** ② 被剥键的那类：wan3.0 首帧方式，参数里带着文生才有的 size（首帧方式不收），现在剥掉。 */
  stripped: { name: "wan3.0 首帧带文生 size（剥掉 size）", archetypeId: "wan-3.0-apimart", modelId: "wan3.0-video", modeId: "first", parameters: { size: "9:16" } },
  /** 对照：请求体没变的镜头。 */
  unchanged: { name: "wan2.7 文生（不变）", archetypeId: "wan-2.7", modelId: "wan2.7", modeId: "t2v", parameters: {} },
} satisfies Record<string, Case>;

/** 修前代码（3f40a0efc）对同一份合同算出的指纹。 */
const OLD_HASH: Record<keyof typeof CASES, string> = {
  refDefault: "4f6e47e94a6a67911eac7b1eda554d78d6c593939f33a90da5829a2f7b311bb0",
  stripped: "2c9115376f487afd64038c7b641ad3644eb4b616f0c0cab816df6c39fffcf838",
  unchanged: "9bc30929315b04a2965511286dcc10c436110893c1a4f00bc30b11faa8fcc735",
};

describe("升级前已批准、还没发出去的 Run 作业：新代码重算请求体指纹", () => {
  it.each(Object.entries(CASES))("%s", async (key, c) => {
    const now = await prepared(c);
    if (process.env.NOMI_PRINT_UPGRADE_HASHES === "1") console.log(`HASH ${key} ${now.providerRequestHash} ${JSON.stringify(now.providerRequest)}`);
    const old = OLD_HASH[key as keyof typeof CASES];
    if (key === "unchanged") {
      expect(now.providerRequestHash).toBe(old);
      // 提交出口那道比对（generationRuntimeAdapter.submit → assertProductionGenerationPayloadHash）放行 → 照发。
      expect(() => assertProductionGenerationPayloadHash(now.providerRequest, old)).not.toThrow();
    } else {
      expect(now.providerRequestHash).not.toBe(old);
      // 同一道比对拦下：这一镜不发，要重新批一次。
      expect(() => assertProductionGenerationPayloadHash(now.providerRequest, old)).toThrow("Provider wire payload no longer matches the approved authorization");
    }
    if (key === "refDefault") expect(now.providerRequest.size ?? (now.providerRequest.body as Record<string, unknown> | undefined)?.size).toBeDefined();
  });
});

// 重算 OLD_HASH：把 electron/catalog/taskParams.ts 临时换成 3f40a0efc 的版本，
// NOMI_PRINT_UPGRADE_HASHES=1 跑本文件，取输出里的 HASH 行，再把 taskParams.ts 还原（git checkout）。
