import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// 派发准入闸（镜头认领闸）必须在一次提交的**第一笔耐久写之前**判：它看到的是还没落盘的 job（authorized），
// 一拒就什么都没写——没有预算预留、没有提交意向。2026-09-29 #921 真额度验收：闸排在 submit_intent_persisted 之后，
// 看到的永远是「制作自己在提交」（in_flight），从来拒不了；三镜批次开拍后按急停，同一轮里第 2、3 镜照样派发扣费。
// 这里走真链路：调度器 → 真提交门面（真 Run 锁 / 真账本 / 真 job）→ 真 outbox → 真闸；急停 / 取消走的是
// IPC 与 MCP 共用的 applyRunControl，按下的时刻就是第 1 镜的请求正在供应商那边的时候。

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import { decideShotClaim } from "../shared/decideShotClaim";
import { createMultiShotBatchScheduler } from "./multiShotBatchScheduler";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { applyRunControl } from "./productionRunControl";
import { createProductionRunRepository } from "./productionRunRepository";
import type { ProductionGenerationShot, ProductionJob, ProductionRun } from "./productionRunTypes";
import { createProductionShotDispatchGuard } from "./productionShotDispatchGuard";
import { landedAdmission, landingThatBinds } from "./landFirstTestUtils";

const PROJECT = "project-1";
const RUN = "op-gate";
const roots: string[] = [];
const now = () => "2026-09-29T00:00:00.000Z";

type Repository = ReturnType<typeof createProductionRunRepository>;

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot", version: "1.0.0", inputKinds: ["text", "image"], outputKinds: ["video"],
  modes: ["image-to-video"], parameterSchema: {}, assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{ providerId: "apimart", models: [{ modelId: "video-model", modes: ["image-to-video"], parameterSchema: {},
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true } }] }],
}]);

function planCandidate(candidateId: string, prompt: string): PlanCandidate {
  return { candidateId, revision: 1, moduleId: "generation.single-shot", providerId: "apimart", modelId: "video-model", mode: "image-to-video", prompt, parameters: {}, references: [] };
}

function shotEntry(shotId: string): ProductionGenerationShot {
  const candidate = planCandidate(`cand-${shotId}`, `镜头 ${shotId}`);
  const contract = compileExecutionContract(candidate, registry);
  return { shotId, candidate: { ...candidate, sealedContractHash: contract.contractHash }, contract, approvedReceiptId: "receipt-plan", updatedAt: now() };
}

/** 真供应商形状的内存提交面：每次 submit 记一笔；`duringSubmit` 在请求「正在供应商那边」时触发（用户这时按急停）。 */
function provider(submits: string[], duringSubmit?: () => void): GenerationProvider {
  return {
    providerId: "apimart",
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true },
    buildRequest: (input) => input,
    submit: async (_request, idempotencyKey) => {
      submits.push(idempotencyKey);
      duringSubmit?.();
      return { providerTaskId: `task-${submits.length}` };
    },
    query: async (providerTaskId) => ({ status: "succeeded", raw: { id: providerTaskId, status: "succeeded" } }),
    materialize: async ({ providerTaskId }) => ({ outputs: [{ kind: "video", url: `nomi-local://asset/${PROJECT}/${providerTaskId}.mp4` }] }),
  };
}

function setup(shots?: ProductionGenerationShot[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-dispatch-gate-"));
  roots.push(root);
  const repository = createProductionRunRepository({ projectDirResolver: (projectId) => (projectId === PROJECT ? root : null), now });
  const single = planCandidate("cand-single", "一镜：清晨渔港");
  const candidate = shots ? shots[0].candidate : single;
  const contract = shots ? shots[0].contract! : compileExecutionContract(single, registry);
  repository.createGenerationDraft({ operationId: RUN, projectId: PROJECT, origin: { host: "semantic-mcp" }, candidate, ...(shots ? { shots } : {}),
    policy: { trustedHosts: ["semantic-mcp"], allowedProviders: ["apimart"], allowedModels: ["video-model"], maxSpend: null, maxAttemptsPerJob: 3 } });
  sealAndApproveProductionGeneration({
    repository, projectId: PROJECT, operationId: RUN, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, projectRevision: 0,
    candidate, contract, providers: [provider([])], ...(shots ? { multiShot: { shots, scope: shots.filter((shot) => shot.included !== false).map((shot) => shot.shotId), planHash: "plan-hash-gate" } } : {}),
    resolveShotPrice: () => ({ known: true, amount: 6 }), receiptId: "receipt-plan", now: now(),
  });
  if (shots) {
    const run = repository.read(PROJECT, RUN)!;
    repository.execute(PROJECT, RUN, { commandId: "submit", expectedRevision: run.revision, type: "generation.submit", payload: {}, issuedAt: now() });
  }
  return { root, repository };
}

const reservationOf = (repository: Repository, job: ProductionJob) =>
  repository.readBudgetLedger(PROJECT, RUN).reservations[`${RUN}:${job.jobId}:${job.attempt}`];

/** 真闸，外面包一层记录：闸被调用的那一刻，这一镜在耐久 Run 里是什么样。 */
function observedGate(repository: Repository) {
  const guard = createProductionShotDispatchGuard({ readRun: (projectId, runId) => repository.read(projectId, runId) ?? undefined });
  const seen: Array<{ shotId: string; status: ProductionJob["status"]; reserved: boolean }> = [];
  return {
    seen,
    guard: (input: { run: ProductionRun; job: ProductionJob }) => {
      const durable = repository.read(PROJECT, RUN)!;
      const job = durable.jobs.find((candidate) => candidate.jobId === input.job.jobId)!;
      const shotId = typeof job.metadata?.shotId === "string" ? job.metadata.shotId : durable.generationPlan!.candidate.candidateId;
      seen.push({ shotId, status: job.status, reserved: Boolean(reservationOf(repository, job)) });
      guard(input);
    },
  };
}

function submission(root: string, repository: Repository, beforeDispatch: ReturnType<typeof observedGate>["guard"], vendor: GenerationProvider) {
  return createProductionGenerationSubmission({
    repository, beforeDispatch, projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, intentMacKey: "test-intent-key", provider: vendor,
    materializeOutput: async ({ providerTaskId }) => ({ artifactId: `artifact-${providerTaskId}`, kind: "video", contentHash: `hash-${providerTaskId}`, projectRelativePath: `.nomi/out/${providerTaskId}.mp4` }),
    now,
  });
}

const jobOf = (repository: Repository, shotId: string) =>
  repository.read(PROJECT, RUN)!.jobs.find((job) => job.metadata?.shotId === shotId)!;

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("the production dispatch gate runs before anything about the attempt is persisted", () => {
  it.each([
    // 急停：第 1 镜收尾后这一趟驱动把 pausing 收成 paused（多镜批次以前永远停在 pausing）。
    ["pause", "paused"],
    ["cancel", "cancelled"],
  ] as const)("%s pressed while shot 1 is at the provider: shots 2 and 3 are refused with nothing reserved or intended", async (action, stopped) => {
    const { root, repository } = setup([shotEntry("shot-1"), shotEntry("shot-2"), shotEntry("shot-3")]);
    const submits: string[] = [];
    const gate = observedGate(repository);
    const press = () => {
      const run = repository.read(PROJECT, RUN)!;
      applyRunControl(repository, PROJECT, RUN, run, { commandId: `user-${action}`, expectedRevision: run.revision, type: "run.control", payload: { action }, issuedAt: now() });
    };
    const vendor = provider(submits, () => { if (submits.length === 1) press(); });

    await createMultiShotBatchScheduler({ repository, landShots: landingThatBinds(repository), submission: submission(root, repository, gate.guard, vendor), projectId: PROJECT, runId: RUN,
      now }).runToQuiescence();

    expect(submits, "only shot 1 was already at the provider when the user stopped the batch").toHaveLength(1);
    expect(submits[0]).toContain("shot-1");
    expect(repository.read(PROJECT, RUN)?.status).toBe(stopped);
    for (const shotId of ["shot-2", "shot-3"]) {
      const job = jobOf(repository, shotId);
      expect(job.status, `${shotId} never got a submit intent`).toBe("authorized");
      expect(reservationOf(repository, job), `${shotId} never reserved budget`).toBeUndefined();
    }
    // 闸在真实调用顺序里看到的是落盘之前的状态：每一镜都还是 authorized、还没有预留。
    expect(gate.seen).toEqual([
      { shotId: "shot-1", status: "authorized", reserved: false },
      { shotId: "shot-2", status: "authorized", reserved: false },
      { shotId: "shot-3", status: "authorized", reserved: false },
    ]);
    // 没派出去的镜这时归画布：用户可以在画布上自己生成第 2 镜，制作不会再生成它一次。
    expect(decideShotClaim(repository.read(PROJECT, RUN), "shot-2", "canvas")).toMatchObject({ granted: true, holder: "canvas" });
    expect(decideShotClaim(repository.read(PROJECT, RUN), "shot-2", "production")).toMatchObject({ granted: false });
  });

  it("a single-shot generation (its job carries no shot id) passes the gate at its pre-persist state and is submitted once", async () => {
    const { root, repository } = setup();
    const submits: string[] = [];
    const gate = observedGate(repository);

    await submission(root, repository, gate.guard, provider(submits)).start({ projectId: PROJECT, operationId: RUN, admission: await landedAdmission(repository, PROJECT, RUN) });

    expect(submits).toHaveLength(1);
    expect(gate.seen).toEqual([{ shotId: "cand-single", status: "authorized", reserved: false }]);
    expect(repository.read(PROJECT, RUN)?.jobs[0]?.status).toBe("provider_accepted");
  });
});
