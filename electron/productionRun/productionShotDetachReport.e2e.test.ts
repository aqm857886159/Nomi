import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// 用户在画布上删掉一个「已授权、还没派出」的镜头节点 → 渲染层上报 → **真的 IPC 校验层** → Run 记下 detached →
// 调度器不再派它。2026-09-29 #921 真额度验收：上报的命令号过不了 IPC 校验、错误又被吞，被删的那一镜照样派发扣费。
// 这里不往仓库直接写 detach：上报走渲染层那一份代码（reportDetachedShotNodes），经 registerProductionRunIpc 注册的
// 真处理器（projectRunPayload → rendererCommand → identifier）落到真仓库，再让真调度器跑一轮。

const handlers = new Map<string, (...args: unknown[]) => unknown>();

// 已加固通道（assertTrustedSender）只认「当前登记的主窗口主帧」：先立一个假主窗口，再用它发来的事件调处理器。
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
import { createMultiShotBatchScheduler } from "./multiShotBatchScheduler";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { registerProductionRunIpc } from "./productionRunIpc";
import { createProductionRunRepository } from "./productionRunRepository";
import type { ProductionGenerationShot, ProductionRun, RunCommand, RunCommandResult } from "./productionRunTypes";
import { createProductionShotDispatchGuard } from "./productionShotDispatchGuard";
import { landingThatBinds } from "./landFirstTestUtils";

const PROJECT = "project-1";
const RUN = "op-batch";
const NODE = { "shot-1": "gen-v2-video-shot1-node", "shot-2": "gen-v2-video-shot2-node" } as const;
const roots: string[] = [];
const clock = Date.parse("2026-09-29T00:00:00.000Z");
const now = () => new Date(clock).toISOString();

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

/** 一个真供应商形状的内存提交面：每次 submit 记一笔（与 loopback 夹具同一个适配器入口，只是不走网络）。 */
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

/** 两镜整批已确认、已提交：两个 job 都「已授权、没提交」，各自绑着画布上的占位节点。 */
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-detach-report-"));
  roots.push(root);
  const repository = createProductionRunRepository({ projectDirResolver: (projectId) => (projectId === PROJECT ? root : null), now });
  const shots = [shotEntry("shot-1", "清晨渔港"), shotEntry("shot-2", "码头的猫")];
  repository.createGenerationDraft({ operationId: RUN, projectId: PROJECT, origin: { host: "semantic-mcp" }, candidate: shots[0].candidate, shots,
    policy: { trustedHosts: ["semantic-mcp"], allowedProviders: ["apimart"], allowedModels: ["video-model"], maxSpend: null, maxAttemptsPerJob: 3 } });
  sealAndApproveProductionGeneration({
    repository, projectId: PROJECT, operationId: RUN, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, projectRevision: 0,
    candidate: shots[0].candidate, contract: shots[0].contract!, providers: [provider([])],
    multiShot: { shots, scope: shots.filter((shot) => shot.included !== false).map((shot) => shot.shotId), planHash: "plan-hash-batch" }, resolveShotPrice: () => ({ known: true, amount: 6 }), receiptId: "receipt-plan", now: now(),
  });
  let run = repository.read(PROJECT, RUN)!;
  run = repository.execute(PROJECT, RUN, { commandId: "submit", expectedRevision: run.revision, type: "generation.submit", payload: {}, issuedAt: now() }).run;
  repository.execute(PROJECT, RUN, { commandId: "bind", expectedRevision: run.revision, type: "plan.bind-shot-nodes",
    payload: { bindings: Object.entries(NODE).map(([shotId, nodeId]) => ({ shotId, nodeId })) }, issuedAt: now() });
  registerProductionRunIpc(repository);
  return { root, repository };
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

async function runScheduler(root: string, repository: ReturnType<typeof createProductionRunRepository>, submits: string[]) {
  const submission = createProductionGenerationSubmission({
    repository, beforeDispatch: createProductionShotDispatchGuard({ readRun: (projectId, runId) => repository.read(projectId, runId) ?? undefined }),
    projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, intentMacKey: "test-intent-key",
    provider: provider(submits),
    materializeOutput: async ({ providerTaskId }) => ({ artifactId: `artifact-${providerTaskId}`, kind: "video", contentHash: `hash-${providerTaskId}`, projectRelativePath: `.nomi/out/${providerTaskId}.mp4` }),
    now,
  });
  await createMultiShotBatchScheduler({ repository, landShots: landingThatBinds(repository), submission, projectId: PROJECT, runId: RUN, now }).runToQuiescence();
}

const shot2 = (run: ProductionRun | null) => ({
  plan: run?.generationPlan?.shots?.find((shot) => shot.shotId === "shot-2"),
  job: run?.jobs.find((job) => job.metadata?.shotId === "shot-2"),
});

afterEach(() => {
  handlers.clear();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("canvas node deletion reaches the production Run through the real IPC boundary", () => {
  it("a queued shot deleted from the canvas is detached by the Run and never submitted", async () => {
    const { root, repository } = setup();
    expect(shot2(repository.read(PROJECT, RUN)).job?.status).toBe("authorized");

    await expect(reportDetachedShotNodes(PROJECT, RUN, [NODE["shot-2"]], ipcApi)).resolves.toBe("detached");

    const detached = shot2(repository.read(PROJECT, RUN));
    expect(detached.plan).toMatchObject({ canvasDetached: true });
    expect(detached.job).toMatchObject({ status: "detached", errorCode: "canvas_detached" });
    const submits: string[] = [];
    await runScheduler(root, repository, submits);
    expect(submits, "only shot 1 reaches the provider").toHaveLength(1);
    expect(submits[0]).toContain("shot-1");
    expect(shot2(repository.read(PROJECT, RUN)).job?.providerTaskId).toBeUndefined();
  });

  it("a deletion that races a scheduler write still lands (same renderer command path as every other production command)", async () => {
    const { repository } = setup();
    // 删节点的那一刻调度器正在连写派发记录：渲染层读到的 revision 在它发命令之前就旧了（只抢这一次）。
    let raced = false;
    const racing: DetachReportApi = {
      read: async (projectId, runId) => {
        const snapshot = await ipcApi.read(projectId, runId);
        if (!raced) {
          raced = true;
          const current = repository.read(PROJECT, RUN)!;
          repository.execute(PROJECT, RUN, { commandId: "scheduler-write", expectedRevision: current.revision, type: "run.status", payload: { status: "running" }, issuedAt: now() });
        }
        return snapshot;
      },
      command: ipcApi.command,
    };
    await expect(reportDetachedShotNodes(PROJECT, RUN, [NODE["shot-2"]], racing)).resolves.toBe("detached");
    expect(shot2(repository.read(PROJECT, RUN)).job).toMatchObject({ status: "detached", errorCode: "canvas_detached" });
  });
});
