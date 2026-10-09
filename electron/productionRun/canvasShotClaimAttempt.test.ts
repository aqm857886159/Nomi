import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { decideShotClaim } from "../shared/decideShotClaim";
import { detachShotNodesCommandId } from "../shared/productionRunCommandId";
import { setupCanvasShots } from "../capabilityCore/canvasShotTestUtils";
import { createMultiShotBatchScheduler } from "./multiShotBatchScheduler";
import { prepareProductionGenerationReauthorization } from "./prepareProductionGenerationAuthorization";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { applyRunControl } from "./productionRunControl";
import { createProductionRunRepository } from "./productionRunRepository";
import type { ProductionGenerationShot, ProductionRun } from "./productionRunTypes";
import { createProductionShotDispatchGuard } from "./productionShotDispatchGuard";
import { landingThatBinds } from "./landFirstTestUtils";

// 画布 ↔ 制作「这一镜归谁」的写命令：同一镜的第 2、3 次认领 / 删除必须各自落盘。
// 根因合同：docs/fixes/2026-10-05-canvas-claim-attempt-id.root-cause.json；复盘：docs/plan/2026-10-05-engine-convergence-cut1.md §3。
// 全程走真实的仓库 / reducer / 调度器 / 提交出口 / 派发闸；画布那一侧走真实的画布付费口（appIntegrationCanvasShot 的准入：
// 绑着制作镜头的节点先经唯一判定口认领那一镜）、删节点走真实的命令号生成处 `detachShotNodesCommandId`。供应商是进程内计数器。

const NOW_BASE = Date.parse("2026-10-05T00:00:00.000Z");
const ELEVEN_MINUTES = 11 * 60 * 1000;
const roots: string[] = [];
let clock = NOW_BASE;
const now = () => new Date(clock).toISOString();

const CAPS = { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true } as const;
const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text", "image"],
  outputKinds: ["image", "video"],
  modes: ["image-to-video"],
  parameterSchema: {},
  assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{ providerId: "apimart", models: [{ modelId: "video-model", modes: ["image-to-video"], parameterSchema: {}, capabilities: CAPS }] }],
}]);
const LEASE = { projectId: "project-1", immutableProjectUuid: "project-uuid-1", projectGeneration: 1, revocationEpoch: 0 };
type Repository = ReturnType<typeof createProductionRunRepository>;

function countingProvider(submits: string[]): GenerationProvider {
  return {
    providerId: "apimart",
    capabilities: CAPS,
    buildRequest: (input) => input,
    submit: async (_request, idempotencyKey) => { submits.push(idempotencyKey); return { providerTaskId: `task-${submits.length}`, raw: {} }; },
    query: async (providerTaskId) => ({ status: "succeeded", raw: { id: providerTaskId, status: "succeeded" } }),
    materialize: async ({ providerTaskId }) => ({ outputs: [{ kind: "video", url: `nomi-local://asset/project-1/${providerTaskId}.mp4` }] }),
  };
}

function shotEntry(shotId: string): ProductionGenerationShot {
  const cand: PlanCandidate = { candidateId: `cand-${shotId}`, revision: 1, moduleId: "generation.single-shot", providerId: "apimart", modelId: "video-model", mode: "image-to-video", prompt: shotId, parameters: {}, references: [] };
  const contract = compileExecutionContract(cand, registry);
  return { shotId, candidate: { ...cand, sealedContractHash: contract.contractHash }, contract, approvedReceiptId: "receipt-plan", updatedAt: now() };
}

function setup(shotIds: string[], maxAttemptsPerJob = 3) {
  const shots = shotIds.map(shotEntry);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-claim-attempt-"));
  roots.push(root);
  const repository = createProductionRunRepository({ projectDirResolver: (p) => (p === "project-1" ? root : null), now });
  repository.createGenerationDraft({ operationId: "op-batch", projectId: "project-1", origin: { host: "semantic-mcp" }, candidate: shots[0].candidate, shots, policy: { trustedHosts: ["semantic-mcp"], allowedProviders: ["apimart"], allowedModels: ["video-model"], maxSpend: null, maxAttemptsPerJob } });
  sealAndApproveProductionGeneration({
    repository, projectId: "project-1", operationId: "op-batch", immutableProjectUuid: "project-uuid-1", projectGeneration: 1, projectRevision: 0,
    candidate: shots[0].candidate, contract: shots[0].contract!,
    providers: [{ providerId: "apimart", capabilities: CAPS, buildRequest: (input) => input, submit: async () => ({ providerTaskId: "unused" }) }],
    multiShot: { shots, scope: shots.map((shot) => shot.shotId), planHash: "plan-hash-claim" },
    resolveShotPrice: () => ({ known: true, amount: 6 }), receiptId: "receipt-plan", now: now(),
  });
  repository.execute("project-1", "op-batch", { commandId: "submit", expectedRevision: 2, type: "generation.submit", payload: {}, issuedAt: now() });
  // 画布那一侧：真实的画布付费口，和制作 Run 共用同一个项目仓库。
  const canvas = setupCanvasShots({ root, repository, now });
  return { root, repository, canvas };
}

function scheduler(root: string, repository: Repository, submits: string[], options: { maxShotsPerRun?: number } = {}) {
  const submission = createProductionGenerationSubmission({
    repository,
    beforeDispatch: createProductionShotDispatchGuard({ readRun: (projectId, runId) => repository.read(projectId, runId) ?? undefined }),
    projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, intentMacKey: "test-intent-key",
    provider: countingProvider(submits),
    materializeOutput: async ({ providerTaskId }) => ({ artifactId: `artifact-${providerTaskId}`, kind: "video", contentHash: `hash-${providerTaskId}`, projectRelativePath: `.nomi/out/${providerTaskId}.mp4` }),
    now,
  });
  return createMultiShotBatchScheduler({ repository, landShots: landingThatBinds(repository), submission, projectId: "project-1", runId: "op-batch", now, options });
}

const read = (repository: Repository): ProductionRun => repository.read("project-1", "op-batch")!;

/** 第 1 镜派出去拍完；过了同意窗口，剩下的镜派不出去，批次停在 consent_expired（这类停下不随返工解除）。 */
async function stopOnLapsedConsent(root: string, repository: Repository, submits: string[]): Promise<void> {
  await scheduler(root, repository, submits, { maxShotsPerRun: 1 }).runToQuiescence();
  clock += ELEVEN_MINUTES;
  await scheduler(root, repository, submits).runToQuiescence();
  expect(read(repository)).toMatchObject({ status: "needs_attention", stop: { reason: "consent_expired" } });
}

/** 画布按 ↑：经真实的画布付费口交——准入先认领那一镜（认领不到就拒），认领到了画布那台才发出一笔。 */
let canvasClicks = 0;
async function canvasGenerates(canvas: ReturnType<typeof setupCanvasShots>, shotId: string, canvasSubmits: string[]): Promise<void> {
  canvasClicks += 1;
  await canvas.submit(`node-${shotId}`, `run-canvas-${canvasClicks}`, shotId, { productionRunId: "op-batch", productionShotId: shotId });
  canvasSubmits.push(`canvas:${shotId}`);
}

/** 用户让制作返工这一镜，并在 Nomi 里批了；批次停着时这一类停下不解除，新 attempt 停在 authorized。 */
function reworkApproved(repository: Repository, shotId: string, submits: string[], tag: string): number {
  const before = read(repository);
  const rework = prepareProductionGenerationReauthorization({ lease: LEASE, projectRevision: 0, run: before, shotId, providers: [countingProvider(submits)], resolveShotPrice: () => ({ known: true, amount: 6 }), now: now() });
  const requested = repository.execute("project-1", "op-batch", { commandId: `rework-${tag}`, expectedRevision: before.revision, type: "generation.reauthorize", payload: { shotId, authorization: rework }, issuedAt: now() }).run;
  repository.execute("project-1", "op-batch", { commandId: `approve-rework-${tag}`, expectedRevision: requested.revision, type: "gate.decide", payload: { gateId: rework.envelope.gateId, status: "approved", receiptId: `receipt-rework-${tag}`, authorizationDigest: rework.authorizationDigest }, issuedAt: now() });
  return rework.attempt;
}

/** 用户在 Nomi 窗口里点「继续」，然后调度器跑到歇下。 */
async function resume(root: string, repository: Repository, submits: string[], tag: string): Promise<void> {
  const latest = read(repository);
  applyRunControl(repository, "project-1", "op-batch", latest, { commandId: `resume-${tag}`, expectedRevision: latest.revision, type: "run.control", payload: { action: "resume" }, issuedAt: now(), humanGesture: true });
  await scheduler(root, repository, submits).runToQuiescence();
}

function productionSubmitsFor(repository: Repository, shotId: string): number {
  return read(repository).jobs.filter((job) => job.metadata?.shotId === shotId && Boolean(job.providerTaskId)).length;
}

function claimOf(repository: Repository, shotId: string) {
  return read(repository).generationPlan?.shots?.find((shot) => shot.shotId === shotId)?.claim;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  clock = NOW_BASE;
});

describe("canvas ↔ production claim commands carry which attempt they are about", () => {
  it("first takeover: after the batch stops, the canvas claims shot-2 and 「继续」 never dispatches it", async () => {
    const { root, repository, canvas: canvasPort } = setup(["shot-1", "shot-2"]);
    const submits: string[] = [];
    const canvas: string[] = [];
    await stopOnLapsedConsent(root, repository, submits);

    await canvasGenerates(canvasPort, "shot-2", canvas);
    await resume(root, repository, submits, "1");

    expect(canvas).toEqual(["canvas:shot-2"]);
    expect(productionSubmitsFor(repository, "shot-2")).toBe(0);
  });

  // 报告路径（双扣路径 6）：画布第二次接手同一镜。修前认领命令号是 `shot.claim:<run>:<shot>`，不带 attempt，
  // 仓库按命令号幂等重放、原样返回第一次的结果，这一次的认领没落盘；「继续」后制作照派 attempt 2——同一镜付两次钱。
  it("reported case: a second canvas takeover after a production rework lands, so 「继续」 does not pay for shot-2 again", async () => {
    const { root, repository, canvas: canvasPort } = setup(["shot-1", "shot-2"]);
    const submits: string[] = [];
    const canvas: string[] = [];
    await stopOnLapsedConsent(root, repository, submits);

    await canvasGenerates(canvasPort, "shot-2", canvas);
    const attempt = reworkApproved(repository, "shot-2", submits, "2");
    expect(attempt).toBe(2);

    expect(decideShotClaim(read(repository), "shot-2", "canvas")).toMatchObject({ granted: true, holder: "canvas" });
    await canvasGenerates(canvasPort, "shot-2", canvas);
    expect(claimOf(repository, "shot-2")).toMatchObject({ by: "canvas", attempt: 2 });

    await resume(root, repository, submits, "2");

    expect(canvas).toEqual(["canvas:shot-2", "canvas:shot-2"]);
    expect(productionSubmitsFor(repository, "shot-2")).toBe(0);
  });

  it("class: the 2nd and 3rd canvas claims of one shot each land on their own attempt; production never dispatches a claimed attempt", async () => {
    const { root, repository, canvas: canvasPort } = setup(["shot-1", "shot-2"], 3);
    const submits: string[] = [];
    const canvas: string[] = [];
    await stopOnLapsedConsent(root, repository, submits);

    await canvasGenerates(canvasPort, "shot-2", canvas);
    expect(claimOf(repository, "shot-2")).toMatchObject({ by: "canvas", attempt: 1 });

    expect(reworkApproved(repository, "shot-2", submits, "a2")).toBe(2);
    await canvasGenerates(canvasPort, "shot-2", canvas);
    expect(claimOf(repository, "shot-2")).toMatchObject({ by: "canvas", attempt: 2 });

    expect(reworkApproved(repository, "shot-2", submits, "a3")).toBe(3);
    await canvasGenerates(canvasPort, "shot-2", canvas);
    expect(claimOf(repository, "shot-2")).toMatchObject({ by: "canvas", attempt: 3 });

    const shot2Jobs = read(repository).jobs.filter((job) => job.metadata?.shotId === "shot-2");
    expect(shot2Jobs.map((job) => [job.attempt, job.status, job.errorCode])).toEqual([
      [1, "detached", "canvas_claimed"],
      [2, "detached", "canvas_claimed"],
      [3, "detached", "canvas_claimed"],
    ]);
    await resume(root, repository, submits, "a3");
    expect(productionSubmitsFor(repository, "shot-2")).toBe(0);
    expect(canvas).toHaveLength(3);
  });

  it("class: a retried claim of the same attempt is still a single durable claim (idempotent replay inside one attempt)", async () => {
    const { root, repository, canvas: canvasPort } = setup(["shot-1", "shot-2"]);
    const submits: string[] = [];
    await stopOnLapsedConsent(root, repository, submits);
    await canvasGenerates(canvasPort, "shot-2", []);
    const afterFirst = read(repository).revision;
    // 同一 attempt 再来一次：判定口已经说「画布认领过了」，制作那个 Run 什么都不写（画布照常再生成一次）。
    await canvasGenerates(canvasPort, "shot-2", []);
    expect(read(repository).revision).toBe(afterFirst);
    expect(canvasPort.vendor.executes).toHaveLength(2);
  });

  // 同类（删节点上报）：修前命令号只看 runId + 节点集合。用户删掉节点 → 撤销（节点 id 原样回来、落地对账重新绑上）→
  // 又让制作返工这一镜 → 再删同一个节点：第二次删除和第一次一字不差，被幂等重放吞掉，制作照派新 attempt——钱花在一个已删的节点上。
  it("class (detach report): deleting the same node again after undo + rework is recorded, so the deleted shot is not paid for", async () => {
    const { root, repository } = setup(["shot-1", "shot-2"]);
    const submits: string[] = [];
    await stopOnLapsedConsent(root, repository, submits);

    const bindTo = (tag: string) => {
      const current = read(repository);
      repository.execute("project-1", "op-batch", { commandId: `canvas-landing:op-batch:${tag}:shot-2=node-2`, expectedRevision: current.revision, type: "plan.bind-shot-nodes", payload: { bindings: [{ shotId: "shot-2", nodeId: "node-2" }] }, issuedAt: now() });
    };
    const deleteNode = () => {
      const current = read(repository);
      repository.execute("project-1", "op-batch", { commandId: detachShotNodesCommandId("op-batch", ["node-2"], current.revision), expectedRevision: current.revision, type: "plan.detach-shot-nodes", payload: { nodeIds: ["node-2"] }, issuedAt: now() });
    };

    bindTo("bind");
    deleteNode();
    expect(decideShotClaim(read(repository), "shot-2", "production")).toMatchObject({ granted: false, reason: "canvas_detached" });

    // 撤销删除：同一个节点 id 回来，落地对账按「纠正」重新绑上（#966）。
    bindTo(`reattach-${read(repository).revision}`);
    expect(reworkApproved(repository, "shot-2", submits, "d2")).toBe(2);

    deleteNode();
    expect(decideShotClaim(read(repository), "shot-2", "production")).toMatchObject({ granted: false, reason: "canvas_detached" });
    await resume(root, repository, submits, "d2");
    expect(productionSubmitsFor(repository, "shot-2")).toBe(0);
  });
});
