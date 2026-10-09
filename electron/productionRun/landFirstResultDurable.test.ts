import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { landingThatBinds } from "./landFirstTestUtils";
import { createMultiShotBatchScheduler } from "./multiShotBatchScheduler";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { createProductionRunRepository } from "./productionRunRepository";
import type { ProductionGenerationShot } from "./productionRunTypes";

// #1139 N2：画布上「节点不在时到达的结局」只暂存在本次会话（与普通画布一致，重启后撤销栈也没了）。
// 但结果本身不能丢：这一镜交出去之后节点被删、项目重新装载，这次生成的结果仍在 Run 账本里、产物文件仍在项目里。

const NOW = "2026-10-09T00:00:00.000Z";
const PROJECT = "project-1";
const RUN = "op-durable";
const roots: string[] = [];

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot", version: "1.0.0", inputKinds: ["text"], outputKinds: ["image", "video"], modes: ["image-to-video"],
  parameterSchema: { aspectRatio: { type: "string" } }, assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{ providerId: "apimart", models: [{ modelId: "video-model", modes: ["image-to-video"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } }] }],
}]);

function shotEntry(shotId: string): ProductionGenerationShot {
  const candidate: PlanCandidate = { candidateId: `cand-${shotId}`, revision: 1, moduleId: "generation.single-shot", providerId: "apimart", modelId: "video-model", mode: "image-to-video", prompt: shotId, parameters: { aspectRatio: "9:16" }, references: [] };
  const contract = compileExecutionContract(candidate, registry);
  return { shotId, candidate: { ...candidate, sealedContractHash: contract.contractHash }, contract, approvedReceiptId: "receipt-plan", updatedAt: NOW };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("a production result survives its node being deleted and the project being reloaded", () => {
  it("dispatched → node deleted (detached) → provider finishes → a reloaded repository still has the artifact, and the file is in the project", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-land-durable-"));
    roots.push(root);
    const open = () => createProductionRunRepository({ projectDirResolver: (projectId) => (projectId === PROJECT ? root : null), now: () => NOW,
      randomId: (() => { let n = 0; return () => `id-${++n}`; })() });
    const repository = open();
    const shots = [shotEntry("shot-a")];
    repository.createGenerationDraft({ operationId: RUN, projectId: PROJECT, origin: { host: "semantic-mcp" }, candidate: shots[0].candidate, shots,
      policy: { trustedHosts: ["semantic-mcp"], allowedProviders: ["apimart"], allowedModels: ["video-model"], maxSpend: null, maxAttemptsPerJob: 2 } });
    sealAndApproveProductionGeneration({ repository, projectId: PROJECT, operationId: RUN, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, projectRevision: 0,
      candidate: shots[0].candidate, contract: shots[0].contract!,
      providers: [{ providerId: "apimart", capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true }, buildRequest: (input) => input, submit: async () => ({ providerTaskId: "unused" }) }],
      multiShot: { shots, scope: ["shot-a"], planHash: "plan-hash-durable" }, resolveShotPrice: () => ({ known: true, amount: 1 }), receiptId: "receipt-plan", now: NOW });
    const sealed = repository.read(PROJECT, RUN)!;
    repository.execute(PROJECT, RUN, { commandId: "submit", expectedRevision: sealed.revision, type: "generation.submit", payload: {}, issuedAt: NOW });

    let finished = false;
    const submit = vi.fn(async () => ({ providerTaskId: "task-a" }));
    const provider: GenerationProvider = {
      providerId: "apimart", capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true },
      buildRequest: (input) => input, submit: submit as unknown as GenerationProvider["submit"],
      query: async (providerTaskId) => ({ status: finished ? "succeeded" : "processing", raw: { id: providerTaskId } }),
      materialize: async () => ({ outputs: [{ url: "https://fixture.invalid/a.mp4", kind: "video" as const }] }),
    };
    const submission = createProductionGenerationSubmission({ repository, beforeDispatch: () => undefined, projectRoot: root, immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1, intentMacKey: "test-intent-key", provider, now: () => NOW,
      materializeOutput: async ({ providerTaskId }) => {
        const relative = path.posix.join(".nomi", "out", `${providerTaskId}.mp4`);
        fs.mkdirSync(path.join(root, ".nomi", "out"), { recursive: true });
        fs.writeFileSync(path.join(root, relative), "mp4-bytes");
        return { artifactId: `artifact-${providerTaskId}`, kind: "video", contentHash: `hash-${providerTaskId}`, projectRelativePath: relative };
      } });
    const drive = () => createMultiShotBatchScheduler({ repository, submission, landShots: landingThatBinds(repository), projectId: PROJECT, runId: RUN, now: () => NOW,
      options: { pollHorizonMs: 0 } }).runToQuiescence();

    await drive();
    expect(submit).toHaveBeenCalledTimes(1);
    // 交出去之后用户删了这一镜的节点。
    const bound = repository.read(PROJECT, RUN)!;
    repository.execute(PROJECT, RUN, { commandId: "user-deleted-node", expectedRevision: bound.revision, type: "plan.detach-shot-nodes",
      payload: { nodeIds: [bound.generationPlan!.shots![0].nodeId!] }, issuedAt: NOW });
    finished = true;
    await drive();

    // 「重新装载」：另起一个仓库实例，只读盘上的那一份。
    const reloaded = open().read(PROJECT, RUN)!;
    expect(reloaded.generationPlan!.shots![0].canvasDetached).toBe(true);
    const artifact = reloaded.artifacts.find((candidate) => candidate.kind === "video");
    expect(artifact).toMatchObject({ projectRelativePath: ".nomi/out/task-a.mp4" });
    expect(fs.existsSync(path.join(root, artifact!.projectRelativePath!))).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
