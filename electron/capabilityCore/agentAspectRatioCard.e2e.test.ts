// 端到端（零额度）：用户在 Agent 对话里说的比例 = 落到画布节点上的比例（`docs/plan/2026-10-05-agent-aspect-ratio-semantic.md`）。
// D2 第③步之后付费卡上没有参数：卡上那一行摘要读节点，发出也读节点，所以「说的 = 卡上的 = 发出的」三处同值的源头就是落地报文。
//
// 走的是真链：模型面 `draft_shots` 参数 → lane 翻译（`verbToTransportCall`）→ 宿主规划 handler 的 create
// （语义翻译就在这里）→ 真的 durable Run（`productionRunRepository`）→ `generate` 那一步的 present（卡出来）→
// 落地报文 `buildMaterializeShotsPayload`（节点上写的就是它）。节点 → 生成框 → 发出那一段在 `electron/parity/draftNodeSendParity.test.ts`。
// 没有供应商、不派发、不花钱。
// 用的是真档案：Z-Image（键 `size`，出厂 1:1）与 Nano Banana 2 的 kie 变体（键 `aspect_ratio`，出厂 auto）
// ——正是 2026-10-05 实测里卡上印出出厂默认的那两个。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { verbToTransportCall } from "../agentLane/laneVerbTransport";
import { createModuleRegistry } from "./moduleRegistry";
import { createGenerationPlanningHandler, type GenerationOperationStore } from "./mcpGenerationTools";
import { PROJECT_LEASE_ALGORITHM, PROJECT_LEASE_AUDIENCE, PROJECT_LEASE_VERSION, type ProjectLeaseV2 } from "./projectLease";
import { createProductionGenerationOperationStore } from "../productionRun/productionGenerationOperationStore";
import { createProductionRunRepository } from "../productionRun/productionRunRepository";
import { projectPendingSpendConfirm } from "../productionRun/productionPendingSpend";
import { buildMaterializeShotsPayload } from "../productionRun/multiShotCanvasLanding";
import { withFixedCatalog } from "./generationFixedCatalog.testkit";

const PROJECT_ID = "project-1";
const roots: string[] = [];
const now = () => "2026-10-05T00:00:00.000Z";
const capabilities = { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true };

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text", "image"],
  outputKinds: ["image"],
  modes: ["text_to_image"],
  parameterSchema: {},
  assetInputSchema: { references: { kind: "image", max: 14 } },
  providers: [
    { providerId: "apimart", models: [{ modelId: "z-image-turbo", modes: ["text_to_image"], parameterSchema: {}, capabilities }] },
    { providerId: "kie", models: [{ modelId: "nano-banana-2", modes: ["text_to_image"], parameterSchema: {}, capabilities }] },
  ],
}]);

const lease: ProjectLeaseV2 = {
  version: PROJECT_LEASE_VERSION, keyId: "key-1", algorithm: PROJECT_LEASE_ALGORITHM, issuer: "nomi-main",
  nonce: "nonce-1", scopeHash: "scope-hash-1", mac: "mac-1", projectId: PROJECT_ID,
  immutableProjectUuid: "project-uuid-1", projectGeneration: 1, canonicalRootDigest: "root-1", manifestDigest: "manifest-1",
  issuedAt: "2026-10-05T00:00:00.000Z", expiresAt: "2026-10-05T01:00:00.000Z", audience: PROJECT_LEASE_AUDIENCE,
  leasePrincipal: "mcp:agent-panel", sessionId: "session-1", connectionNonce: "connection-1", revocationEpoch: 0,
  scopeSet: ["generation:create", "generation:plan", "generation:preview", "generation:gate", "generation:submit", "generation:read"],
};

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-aspect-card-e2e-"));
  roots.push(root);
  const repository = createProductionRunRepository({ projectDirResolver: (projectId) => (projectId === PROJECT_ID ? root : null), now });
  const owner = {
    createGenerationDraft: repository.createGenerationDraft,
    readFull: (projectId: string, operationId: string) => {
      const run = repository.read(projectId, operationId);
      if (!run) throw new Error(`Run not found: ${operationId}`);
      return run;
    },
    command: async (projectId: string, operationId: string, command: Parameters<typeof repository.execute>[2]) => repository.execute(projectId, operationId, command),
  };
  const operations = createProductionGenerationOperationStore(owner as never) as GenerationOperationStore;
  // 用户在设置里存过的默认模型（生产里一定有）：点名的模型目录里没有时，模块身份就从这里来——
  // 于是候选能一路走到「认不出模型」那一步，而不是更早被「没有配置模型」拦下。
  const defaultModelForTaskKind = () => ({ moduleId: "generation.single-shot", providerId: "apimart", modelId: "z-image-turbo", mode: "text_to_image" });
  const handler = createGenerationPlanningHandler(withFixedCatalog({ registry, operations, now, defaultModelForTaskKind }));
  const origin = { host: "nomi", actorId: "agent-panel" };
  /** 这份计划落到画布上时，每一镜节点上写的参数（卡上摘要与发出都读节点）。 */
  const landedParameters = (operationId: string) => buildMaterializeShotsPayload(repository.read(PROJECT_ID, operationId)!, { projectRoot: null })!
    .shots.map((shot) => shot.candidate?.parameters);
  /** Agent 调一次 `draft_shots`（lane 真翻译），再 `generate` 把它摆到卡上；回落到节点上的每镜参数。 */
  const cardAfter = async (draftShotsArgs: Record<string, unknown>) => {
    const translated = verbToTransportCall({ toolCallId: "call-1", toolName: "draft_shots", args: draftShotsArgs }, LANE_MODELS)!;
    const created = await handler({ capability: "create", params: translated.call.args as Record<string, unknown>, lease, origin } as never) as { operation: { operationId: string } };
    const operationId = created.operation.operationId;
    await handler({ capability: "present", params: { operationId }, lease, origin } as never);
    const card = projectPendingSpendConfirm(repository.read(PROJECT_ID, operationId)!, () => undefined);
    expect(card?.shots.length, "卡出来了（摘要读的就是下面这些节点）").toBeGreaterThan(0);
    return { operationId, shots: landedParameters(operationId) };
  };
  return { handler, cardAfter, landedParameters, origin, repository };
}

/**
 * 这条消息带上来的可用模型清单（`draft_shots` 的完整名字在 lane 这一侧按它查）。`ghost-model@kie` 是故意的：
 * 消息发出时清单里还有、宿主目录里已经没有（清单与目录不同步）——这时拦它的是宿主的身份准入，下面最后一条证的就是那一层。
 */
const LANE_MODELS = [
  { vendor: "apimart", modelId: "z-image-turbo", modelAlias: null },
  { vendor: "kie", modelId: "nano-banana-2", modelAlias: null },
  { vendor: "kie", modelId: "ghost-model", modelAlias: null },
];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Agent 说的比例 = 落到节点上的比例（卡上摘要读节点）", () => {
  it("Z-Image：说 16:9，节点上是 size=16:9（不再是出厂 1:1）", async () => {
    const { cardAfter } = harness();
    const { shots } = await cardAfter({
      shots: [{ prompt: "海边日出", taskKind: "text_to_image", aspectRatio: "16:9", model: "z-image-turbo@apimart" }],
    });
    expect(shots).toEqual([{ size: "16:9" }]);
  });

  it("Nano Banana 2（kie）多镜：说 1:1，每一镜节点上都是 aspect_ratio=1:1（不再是出厂「自动」）", async () => {
    const { cardAfter } = harness();
    const { shots } = await cardAfter({
      taskKind: "text_to_image",
      shots: [{ prompt: "第一镜", aspectRatio: "1:1", model: "nano-banana-2@kie" }, { prompt: "第二镜", aspectRatio: "1:1", model: "nano-banana-2@kie" }],
    });
    expect(shots).toEqual([{ aspect_ratio: "1:1" }, { aspect_ratio: "1:1" }]);
  });

  it("改草稿「把第 2 镜改成 9:16」：节点上那一镜跟着变、清晰度不动，读盘归一不会把它当残留清掉", async () => {
    const { handler, cardAfter, landedParameters, origin, repository } = harness();
    const { operationId } = await cardAfter({
      taskKind: "text_to_image",
      shots: [
        { shotId: "shot-1", prompt: "第一镜", aspectRatio: "16:9", parameters: { resolution: "4K" }, model: "nano-banana-2@kie" },
        { shotId: "shot-2", prompt: "第二镜", aspectRatio: "16:9", parameters: { resolution: "4K" }, model: "nano-banana-2@kie" },
      ],
    });
    const revision = verbToTransportCall({ toolCallId: "call-2", toolName: "draft_shots", args: { operationId, shots: [{ shotId: "shot-2", aspectRatio: "9:16" }] } }, LANE_MODELS)!;
    const revised = await handler({ capability: "plan", params: revision.call.args as Record<string, unknown>, lease, origin } as never) as { changeset?: unknown };
    // 回给 Agent 的结果里说清这一次改了什么：只有比例，清晰度没动。
    expect(revised.changeset).toMatchObject({ changedParameters: [{ key: "aspect_ratio", before: "16:9", after: "9:16" }] });
    // 再读一次（预览）：所有读都先经读盘归一——没翻译就落盘的 `aspectRatio` 会在这里被当残留清掉。
    await handler({ capability: "preview", params: { operationId }, lease, origin } as never);
    const shots = repository.read(PROJECT_ID, operationId)!.generationPlan!.shots!;
    expect(shots.map((shot) => [shot.shotId, shot.candidate.parameters])).toEqual([
      // 只改比例：4K 留着（整份替换那一版这里会掉回档案默认的 1K）。
      ["shot-1", { aspect_ratio: "16:9", resolution: "4K" }], ["shot-2", { aspect_ratio: "9:16", resolution: "4K" }],
    ]);
    // 重新摆卡：落到节点上的就是合并后要发出去的那一份（卡上摘要读它）。
    await handler({ capability: "present", params: { operationId }, lease, origin } as never);
    expect(projectPendingSpendConfirm(repository.read(PROJECT_ID, operationId)!, () => undefined)!.shots).toHaveLength(2);
    expect(landedParameters(operationId)).toEqual([
      { aspect_ratio: "16:9", resolution: "4K" }, { aspect_ratio: "9:16", resolution: "4K" },
    ]);
  });

  it("模型做不到（Z-Image 要 21:9）：草稿不落、卡不出，拒绝里带合法值", async () => {
    const { handler } = harness();
    const translated = verbToTransportCall({ toolCallId: "call-1", toolName: "draft_shots", args: {
      shots: [{ prompt: "海边日出", taskKind: "text_to_image", aspectRatio: "21:9", model: "z-image-turbo@apimart" }],
    } }, LANE_MODELS)!;
    await expect(handler({ capability: "create", params: translated.call.args as Record<string, unknown>, lease, origin: { host: "nomi", actorId: "agent-panel" } } as never))
      .rejects.toMatchObject({ code: "parameter_not_in_enum", details: { allowedValues: "1:1,4:3,3:4,16:9,9:16,3:2,2:3" } });
  });

  it("目录里认不出的模型：语义键留在候选里不翻，紧接着的身份准入拒掉——不落草稿、不出卡、到不了花钱那一步", async () => {
    const { handler, repository } = harness();
    const translated = verbToTransportCall({ toolCallId: "call-1", toolName: "draft_shots", args: {
      shots: [{ prompt: "海边日出", taskKind: "text_to_image", aspectRatio: "16:9", model: "ghost-model@kie" }],
    } }, LANE_MODELS)!;
    await expect(handler({ capability: "create", params: translated.call.args as Record<string, unknown>, lease, origin: { host: "nomi", actorId: "agent-panel" } } as never))
      .rejects.toThrow("kie/ghost-model is not in the model catalog");
    expect(repository.list(PROJECT_ID)).toEqual([]);
  });
});
