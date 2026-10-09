import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// 一批里有一镜被画布拿走（删了它的节点 / 画布接手），其余镜全部出片后这一批必须收尾：调度器报完成 → Run 交给
// 审片与粗剪 → 任务卡不再挂「进行中」。2026-09-29 #921 零额度彩排：被拿走的那一镜的 job 是 detached，调度器却把它数成
// 「在跑」，批次永远凑不满完成数，Run 一直停在 running。两条路都走真入口：删节点经渲染层上报 → 真 IPC；
// 画布接手经画布付费口（appIntegrationCanvasShot）准入里的认领；收尾经 appIntegration 同款 onBatchComplete → advanceSemanticProduction。

const handlers = new Map<string, (...args: unknown[]) => unknown>();

const harness = vi.hoisted(() => {
  const MAIN_FRAME_ROUTING_ID = 7;
  const APP_ENTRY_URL = "file:///app/index.html";
  const byContents = new Map<object, object>();
  class FakeBrowserWindow {
    readonly webContents: { mainFrame: { routingId: number }; isDestroyed(): boolean; getURL(): string };
    constructor() {
      this.webContents = { mainFrame: { routingId: MAIN_FRAME_ROUTING_ID }, isDestroyed: () => false, getURL: () => APP_ENTRY_URL };
      byContents.set(this.webContents, this);
    }
    isDestroyed(): boolean {
      return false;
    }
    static fromWebContents(contents: object): object | null {
      return byContents.get(contents) ?? null;
    }
  }
  return { FakeBrowserWindow, MAIN_FRAME_ROUTING_ID, APP_ENTRY_URL };
});

vi.mock("electron", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  BrowserWindow: harness.FakeBrowserWindow,
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) },
}));

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import { setMainWindow } from "../appWindowRegistry";
import { reportDetachedShotNodes, type DetachReportApi } from "../../src/workbench/production/reportDetachedShotNodes";
import { buildProductionRunView } from "../../src/workbench/production/productionRunView";
import { setupCanvasShots } from "../capabilityCore/canvasShotTestUtils";
import { createMultiShotBatchScheduler } from "./multiShotBatchScheduler";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { applyRunControl } from "./productionRunControl";
import { registerProductionRunIpc } from "./productionRunIpc";
import { createProductionRunRepository } from "./productionRunRepository";
import { createProductionRunService } from "./productionRunService";
import { registerProductionRunService, resetRegisteredProductionRunService } from "./productionRunServiceRegistry";
import type { ProductionGenerationShot, ProductionRun, RunCommand, RunCommandResult } from "./productionRunTypes";
import { createProductionShotDispatchGuard } from "./productionShotDispatchGuard";
import { landingThatBinds } from "./landFirstTestUtils";

const PROJECT = "project-1";
const RUN = "op-settle";
const NODE = { "shot-1": "gen-v2-video-shot1-node", "shot-2": "gen-v2-video-shot2-node" } as const;
const roots: string[] = [];
const now = () => "2026-09-29T00:00:00.000Z";

type Repository = ReturnType<typeof createProductionRunRepository>;

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot", version: "1.0.0", inputKinds: ["text", "image"], outputKinds: ["video"],
  modes: ["image-to-video"], parameterSchema: {}, assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{ providerId: "apimart", models: [{ modelId: "video-model", modes: ["image-to-video"], parameterSchema: {},
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true } }] }],
}]);

function shotEntry(shotId: string, prompt: string): ProductionGenerationShot {
  const candidate: PlanCandidate = { candidateId: `cand-${shotId}`, revision: 1, moduleId: "generation.single-shot", providerId: "apimart", modelId: "video-model", mode: "image-to-video", prompt, parameters: {}, references: [] };
  const contract = compileExecutionContract(candidate, registry);
  return { shotId, candidate: { ...candidate, sealedContractHash: contract.contractHash }, contract, approvedReceiptId: "receipt-plan", updatedAt: now() };
}

function provider(submits: string[]): GenerationProvider {
  return {
    providerId: "apimart",
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true },
    buildRequest: (input) => input,
    submit: async (_request, idempotencyKey) => { submits.push(idempotencyKey); return { providerTaskId: `task-${submits.length}` }; },
    query: async (providerTaskId) => ({ status: "succeeded", raw: { id: providerTaskId, status: "succeeded" } }),
    materialize: async ({ providerTaskId }) => ({ outputs: [{ kind: "video", url: `nomi-local://asset/${PROJECT}/${providerTaskId}.mp4` }] }),
  };
}

/** 两镜整批已确认、已提交，各自绑着画布上的占位节点；收尾链路（审片 / 排粗剪）接一个假渲染端。 */
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-batch-settle-"));
  roots.push(root);
  const repository = createProductionRunRepository({ projectDirResolver: (projectId) => (projectId === PROJECT ? root : null), now });
  const shots = [shotEntry("shot-1", "清晨渔港"), shotEntry("shot-2", "码头的猫")];
  repository.createGenerationDraft({ operationId: RUN, projectId: PROJECT, origin: { host: "semantic-mcp" }, candidate: shots[0].candidate, shots,
    policy: { trustedHosts: ["semantic-mcp"], allowedProviders: ["apimart"], allowedModels: ["video-model"], maxSpend: null, maxAttemptsPerJob: 3 } });
  sealAndApproveProductionGeneration({
    repository, projectId: PROJECT, operationId: RUN, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, projectRevision: 0,
    candidate: shots[0].candidate, contract: shots[0].contract!, providers: [provider([])],
    multiShot: { shots, scope: shots.filter((shot) => shot.included !== false).map((shot) => shot.shotId), planHash: "plan-hash-settle" }, resolveShotPrice: () => ({ known: true, amount: 6 }), receiptId: "receipt-plan", now: now(),
  });
  let run = repository.read(PROJECT, RUN)!;
  run = repository.execute(PROJECT, RUN, { commandId: "submit", expectedRevision: run.revision, type: "generation.submit", payload: {}, issuedAt: now() }).run;
  repository.execute(PROJECT, RUN, { commandId: "bind", expectedRevision: run.revision, type: "plan.bind-shot-nodes",
    payload: { bindings: Object.entries(NODE).map(([shotId, nodeId]) => ({ shotId, nodeId })) }, issuedAt: now() });
  registerProductionRunIpc(repository);
  const reviewed: string[][] = [];
  const service = createProductionRunService({
    repository,
    projectRootResolver: () => root,
    requestRenderer: async (op, payload) => {
      const shotNodeIds = (payload as { shotNodeIds?: string[] }).shotNodeIds ?? [];
      if (op === "production.verify-shots") {
        reviewed.push(shotNodeIds);
        return { reviewedShotIds: shotNodeIds, verdicts: shotNodeIds.map((shotNodeId) => ({ shotNodeId, passed: true })) };
      }
      if (op === "production.arrange") return { arranged: shotNodeIds.length, total: shotNodeIds.length, timelineContract: { version: 1, clips: shotNodeIds } };
      throw new Error(`unexpected renderer operation ${op}`);
    },
    executeProductionExport: async () => { throw new Error("export is not part of this test"); },
  });
  registerProductionRunService(service);
  return { root, repository, service, reviewed };
}

function trustedEvent(): { sender: unknown; senderFrame: unknown } {
  const win = new harness.FakeBrowserWindow();
  setMainWindow(win as never);
  return { sender: win.webContents, senderFrame: { routingId: harness.MAIN_FRAME_ROUTING_ID, url: harness.APP_ENTRY_URL } };
}

/** 渲染层的两个口，接到真 IPC 处理器上（和 preload 里 productionRuns.read / command 同一对通道）。 */
const ipcApi: DetachReportApi = {
  read: async (projectId, runId) => await handlers.get("nomi:production-runs:read")!(trustedEvent(), { projectId, runId }) as ProductionRun | null,
  command: async (projectId, runId, command: RunCommand) =>
    await handlers.get("nomi:production-runs:command")!(trustedEvent(), { projectId, runId, command }) as RunCommandResult,
};

/** 调度器一轮：接线与 appIntegration 相同——同一个闸，批次做完交给 advanceSemanticProduction。 */
async function driveBatch(root: string, repository: Repository, service: ReturnType<typeof createProductionRunService>, submits: string[]) {
  const submission = createProductionGenerationSubmission({
    repository, beforeDispatch: createProductionShotDispatchGuard({ readRun: (projectId, runId) => repository.read(projectId, runId) ?? undefined }),
    projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, intentMacKey: "test-intent-key",
    provider: provider(submits),
    materializeOutput: async ({ providerTaskId }) => ({ artifactId: `artifact-${providerTaskId}`, kind: "video", contentHash: `hash-${providerTaskId}`, projectRelativePath: `.nomi/out/${providerTaskId}.mp4` }),
    now,
  });
  return await createMultiShotBatchScheduler({
    repository, landShots: landingThatBinds(repository), submission, projectId: PROJECT, runId: RUN, now,
    onBatchComplete: () => service.advanceSemanticProduction(PROJECT, RUN),
  }).runToQuiescence();
}

const jobOf = (repository: Repository, shotId: string) =>
  repository.read(PROJECT, RUN)!.jobs.find((job) => job.metadata?.shotId === shotId)!;

function expectSettled(repository: Repository, outcome: Awaited<ReturnType<typeof driveBatch>>, submits: string[], reviewed: string[][]) {
  expect(submits, "production submitted shot 1 only").toHaveLength(1);
  expect(submits[0]).toContain("shot-1");
  expect(outcome.progress, "the batch counts only the shot it still owes").toEqual({ total: 1, completed: 1, inFlight: 0, pending: 0 });
  const run = repository.read(PROJECT, RUN)!;
  expect(run.status, "the batch settled and handed the run to QA / rough cut").toBe("awaiting_rough_cut_review");
  expect(reviewed, "QA reviewed exactly the shot production made").toEqual([[NODE["shot-1"]]]);
  expect(buildProductionRunView(run).group, "the task card no longer says 进行中").not.toBe("running");
}

afterEach(() => {
  handlers.clear();
  resetRegisteredProductionRunService();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("a batch settles once a shot leaves it for the canvas", () => {
  it("deleting a queued shot's node: the other shot lands and the batch hands the run on", async () => {
    const { root, repository, service, reviewed } = setup();
    await expect(reportDetachedShotNodes(PROJECT, RUN, [NODE["shot-2"]], ipcApi)).resolves.toBe("detached");
    expect(jobOf(repository, "shot-2")).toMatchObject({ status: "detached", errorCode: "canvas_detached" });

    const submits: string[] = [];
    const outcome = await driveBatch(root, repository, service, submits);

    expectSettled(repository, outcome, submits, reviewed);
  });

  it("the canvas taking over a queued shot while the batch is paused: after resuming, the batch settles without it", async () => {
    const { root, repository, service, reviewed } = setup();
    let run = repository.read(PROJECT, RUN)!;
    run = repository.execute(PROJECT, RUN, { commandId: "batch-start", expectedRevision: run.revision, type: "run.status", payload: { status: "running" }, issuedAt: now() }).run;
    run = applyRunControl(repository, PROJECT, RUN, run, { commandId: "user-pause", expectedRevision: run.revision, type: "run.control", payload: { action: "pause" }, issuedAt: now() }).run;
    expect(run.status).toBe("paused");

    await setupCanvasShots({ root, repository, now }).submit(NODE["shot-2"], "run-canvas-1", "shot-2", { productionRunId: RUN, productionShotId: "shot-2" });
    expect(jobOf(repository, "shot-2")).toMatchObject({ status: "detached", errorCode: "canvas_claimed" });
    run = repository.read(PROJECT, RUN)!;
    applyRunControl(repository, PROJECT, RUN, run, { commandId: "user-resume", expectedRevision: run.revision, type: "run.control", payload: { action: "resume" }, issuedAt: now() });

    const submits: string[] = [];
    const outcome = await driveBatch(root, repository, service, submits);

    expectSettled(repository, outcome, submits, reviewed);
  });
});
