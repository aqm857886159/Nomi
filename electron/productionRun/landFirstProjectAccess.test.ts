import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import { createCanvasLandingHost } from "./canvasLandingHost";
import { createLandingProjectAccess, refuseLandingWithoutRenderer } from "./landingProjectAccess";
import type { MaterializeShotsWirePayload } from "./multiShotCanvasLanding";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { createProductionRunRepository } from "./productionRunRepository";
import { startSingleShotProduction } from "./singleShotProductionStart";

// 架构③ Q1（用户 2026-10-09 拍板 A + C′）：派发前落地要的项目没打开时——
//   C′：主窗口本来就隐藏、用户从没叫出来（MCP 冷启的后台实例）→ 让它打开目标项目，再落地、派发；
//   A (a)：用户看得见的窗口开着别的项目 → 拒，**绝不切换他正在看的项目**；
//   A (b)：没有渲染层的旧进程内 stdio 路 → 拒。
// 拒绝 = 不派（供应商 0 次）、停在 landing_failed、回给 Agent「需要在 Nomi 里打开项目「X」后再继续」。
// 另：Q3「确认即落」——文稿来源的计划在派发前落地时真建节点（投影 / 对账仍然不替用户放）。

const NOW = "2026-10-09T00:00:00.000Z";
const PROJECT = "project-1";
const OTHER = "project-other";
const RUN = "op-access";
const roots: string[] = [];

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot", version: "1.0.0", inputKinds: ["text"], outputKinds: ["image"], modes: ["text-to-image"],
  parameterSchema: { aspectRatio: { type: "string" } }, assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{ providerId: "fixture-provider", models: [{ modelId: "fixture-model", modes: ["text-to-image"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } }] }],
}]);

const candidate = (): PlanCandidate => ({
  candidateId: "candidate-1", revision: 1, moduleId: "generation.single-shot", providerId: "fixture-provider", modelId: "fixture-model",
  mode: "text-to-image", prompt: "A paper boat", parameters: { aspectRatio: "16:9" }, references: [],
});

function setup(origin: { host: string; sourceDocument?: { documentId: string; revision: number; contentHash: string } } = { host: "nomi" }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-land-access-"));
  roots.push(root);
  const repository = createProductionRunRepository({
    projectDirResolver: (projectId) => (projectId === PROJECT ? root : null), now: () => NOW,
    randomId: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  const planCandidate = candidate();
  const contract = compileExecutionContract(planCandidate, registry);
  repository.createGenerationDraft({
    operationId: RUN, projectId: PROJECT, origin, candidate: planCandidate,
    policy: { trustedHosts: [origin.host], allowedProviders: ["fixture-provider"], allowedModels: ["fixture-model"], maxSpend: 0, maxAttemptsPerJob: 2 },
  });
  const submit = vi.fn(async () => ({ providerTaskId: "provider-task-1" }));
  const provider: GenerationProvider = {
    providerId: "fixture-provider", capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    buildRequest: (input) => input, submit: submit as unknown as GenerationProvider["submit"],
  };
  sealAndApproveProductionGeneration({
    repository, projectId: PROJECT, operationId: RUN, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, projectRevision: 0,
    candidate: planCandidate, contract, providers: [provider], now: NOW,
  });
  const submission = createProductionGenerationSubmission({
    repository, beforeDispatch: () => undefined, projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1,
    intentMacKey: "test-intent-key", provider, now: () => NOW,
  });
  return { root, repository, submission, submit };
}

type Setup = ReturnType<typeof setup>;

type AppWindow = { openProject: string | null; hiddenFromUser: boolean; epoch?: number };
type AppHooks = Readonly<{
  /** 隐藏窗口打开项目要几拍才认下（hydrate 是异步的）。缺省 = 当场认下。 */
  hydrateTicks?: number;
  /** 等它认下的每一拍里发生的事（窗口被叫出来、用户切项目、窗口重建）。 */
  duringHydrate?: (tick: number, window: AppWindow) => void;
  /** 项目认下之后、请渲染层落地之前（host 读 Run 的那一刻）发生的事。 */
  beforeMaterialize?: (window: AppWindow) => void;
  /** 写回绑定（plan.bind-shot-nodes）的 await 期间发生的事。 */
  duringBind?: (window: AppWindow) => void;
}>;

/** 一个只有一个主窗口的 App：它此刻开着哪个项目、用户看不看得见它、第几代。渲染层只在目标项目开着时落得下来。 */
function app(base: Setup, window: AppWindow, hooks: AppHooks = {}) {
  const payloads: MaterializeShotsWirePayload[] = [];
  const opened: string[] = [];
  let pendingOpen: { projectId: string; ticks: number } | null = null;
  let tick = 0;
  let readsAfterOpen = 0;
  const committedProjectId = () => window.openProject;
  const host = createCanvasLandingHost({
    readRun: (projectId, runId) => {
      if (window.openProject === PROJECT && opened.length > 0 && readsAfterOpen++ === 0) hooks.beforeMaterialize?.(window);
      return base.repository.read(projectId, runId);
    },
    command: async (projectId, runId, command) => {
      const result = base.repository.execute(projectId, runId, command as Parameters<typeof base.repository.execute>[2]);
      if ((command as { type?: string }).type === "plan.bind-shot-nodes") hooks.duringBind?.(window);
      return result;
    },
    requestRenderer: async (_op, payload) => {
      const wire = payload as MaterializeShotsWirePayload;
      if (window.openProject !== wire.projectId) throw new Error("storyboard_project_changed");
      payloads.push(structuredClone(wire));
      return { bindings: wire.existingOnly ? [] : wire.shots.map((shot) => ({ shotId: shot.shotId, nodeId: `node-${shot.shotId}` })) };
    },
    resolveProjectRoot: () => base.root,
    isProjectOpen: (projectId) => window.openProject === projectId,
    openProjectForLanding: createLandingProjectAccess({
      committedProjectId,
      mainWindowHiddenFromUser: () => window.hiddenFromUser,
      windowEpoch: () => window.epoch ?? 0,
      // 隐藏主窗口经 deep-link 打开项目：渲染层 hydrate 若干拍之后，主进程才认下它。
      openInHiddenWindow: (projectId) => {
        opened.push(projectId);
        if (!hooks.hydrateTicks) window.openProject = projectId;
        else pendingOpen = { projectId, ticks: hooks.hydrateTicks };
      },
      projectName: () => "雨夜",
      sleep: async () => {
        tick += 1;
        hooks.duringHydrate?.(tick, window);
        if (pendingOpen && --pendingOpen.ticks <= 0) {
          // 渲染层只会把自己正在 hydrate 的那个项目认下；用户中途切走了，它认下的是用户那个（见 duringHydrate）。
          if (window.openProject === OTHER || window.openProject === null) window.openProject = pendingOpen.projectId;
          pendingOpen = null;
        }
      },
      pollMs: 1,
      timeoutMs: 50,
    }),
  });
  return { host, payloads, opened };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("land first when the project is not open (A + C′)", () => {
  it("C′: a hidden main window the user never saw opens the project, lands, and the provider is called exactly once", async () => {
    const base = setup();
    const window = { openProject: OTHER as string | null, hiddenFromUser: true };
    const { host, opened } = app(base, window);

    const result = await startSingleShotProduction({ repository: base.repository, submission: base.submission, landShots: host.landBeforeDispatch, projectId: PROJECT, runId: RUN, now: () => NOW });

    expect(opened).toEqual([PROJECT]);
    expect(result).toMatchObject({ nextAction: "observe" });
    expect(base.submit).toHaveBeenCalledTimes(1);
    expect(base.repository.read(PROJECT, RUN)!.generationPlan!.nodeId).toBe(`node-${candidate().candidateId}`);
  });

  it("A (a): a window the user can see showing another project is never switched; zero dispatch, landing_failed, the notice names the project", async () => {
    const base = setup();
    const window = { openProject: OTHER as string | null, hiddenFromUser: false };
    const { host, opened, payloads } = app(base, window);

    const result = await startSingleShotProduction({ repository: base.repository, submission: base.submission, landShots: host.landBeforeDispatch, projectId: PROJECT, runId: RUN, now: () => NOW });

    expect(window.openProject).toBe(OTHER);
    expect(opened).toEqual([]);
    expect(payloads).toEqual([]);
    expect(base.submit).toHaveBeenCalledTimes(0);
    expect(base.repository.read(PROJECT, RUN)!.stop?.reason).toBe("landing_failed");
    expect(result).toMatchObject({ nextAction: "canvas_landing_failed", landingFailure: { code: "landing_project_not_open", projectName: "雨夜" } });
    expect((result as { notice: string }).notice).toContain("需要在 Nomi 里打开项目「雨夜」后再继续");
    expect((result as { notice: string }).notice).not.toMatch(/扣|费|钱/);
  });

  it("A (b): the in-process stdio path has no renderer — zero dispatch, landing_failed, English notice names the project", async () => {
    const base = setup();
    const result = await startSingleShotProduction({
      repository: base.repository, submission: base.submission, landShots: async (projectId) => { await refuseLandingWithoutRenderer(() => "Rain Night")(projectId); },
      projectId: PROJECT, runId: RUN, now: () => NOW, locale: "en",
    });
    expect(base.submit).toHaveBeenCalledTimes(0);
    expect(base.repository.read(PROJECT, RUN)!.stop?.reason).toBe("landing_failed");
    expect((result as { notice: string }).notice).toContain('Open the project "Rain Night" in Nomi');
    expect((result as { notice: string }).notice).not.toMatch(/charge|credit|refund/i);
  });

  it("Q3 confirm = place: a document-sourced plan really lands before dispatch, while projection/reconcile still leave it off the canvas", async () => {
    const base = setup({ host: "nomi", sourceDocument: { documentId: "doc-1", revision: 1, contentHash: "hash" } });
    const window = { openProject: PROJECT as string | null, hiddenFromUser: false };
    const { host, payloads } = app(base, window);

    expect(await host.reconcileExistingCanvas(PROJECT, RUN)).toBe(false);
    expect(payloads).toEqual([]);

    await startSingleShotProduction({ repository: base.repository, submission: base.submission, landShots: host.landBeforeDispatch, projectId: PROJECT, runId: RUN, now: () => NOW });

    expect(payloads[0]?.existingOnly).toBeUndefined();
    expect(base.submit).toHaveBeenCalledTimes(1);
  });
});

// #1139 对抗评审 B2：C′ 只在入口查一次「窗口隐藏」不够——打开项目、hydrate、认下、落地之间隔着好几个 await。
// 租约记下「窗口代次 + 仍隐藏 + 开着的项目」，发 deep-link 前、认下之后、落地前、写回绑定前都再核；任一项变了就取消：
// landing_failed、派发 0 次、渲染层一次落地请求都不收。
describe("C′ lease: anything that changes while the hidden window is opening the project cancels the landing", () => {
  const start = (base: Setup, host: ReturnType<typeof app>["host"]) =>
    startSingleShotProduction({ repository: base.repository, submission: base.submission, landShots: host.landBeforeDispatch, projectId: PROJECT, runId: RUN, now: () => NOW });

  it("the user brings the window up while it is still hydrating → cancelled, zero dispatch, nothing materialized", async () => {
    const base = setup();
    const window: AppWindow = { openProject: OTHER, hiddenFromUser: true };
    const { host, payloads, opened } = app(base, window, { hydrateTicks: 3, duringHydrate: (tick, w) => { if (tick === 1) w.hiddenFromUser = false; } });

    const result = await start(base, host);

    expect(opened).toEqual([PROJECT]);
    expect(payloads).toEqual([]);
    expect(base.submit).toHaveBeenCalledTimes(0);
    expect(base.repository.read(PROJECT, RUN)!.stop?.reason).toBe("landing_failed");
    expect(result).toMatchObject({ nextAction: "canvas_landing_failed", landingFailure: { code: "landing_lease_revoked" } });
  });

  it("the user switches to another project in the middle of hydrate → cancelled, zero dispatch, his project is left alone", async () => {
    const base = setup();
    const window: AppWindow = { openProject: OTHER, hiddenFromUser: true };
    const { host, payloads } = app(base, window, { hydrateTicks: 3, duringHydrate: (tick, w) => { if (tick === 1) w.openProject = "project-he-picked"; } });

    const result = await start(base, host);

    // 是租约当场取消（不是等到超时才拒）。
    expect(result).toMatchObject({ nextAction: "canvas_landing_failed", landingFailure: { code: "landing_lease_revoked" } });

    expect(window.openProject).toBe("project-he-picked");
    expect(payloads).toEqual([]);
    expect(base.submit).toHaveBeenCalledTimes(0);
    expect(base.repository.read(PROJECT, RUN)!.stop?.reason).toBe("landing_failed");
  });

  it("the window is recreated (new generation) while hydrating → cancelled, zero dispatch", async () => {
    const base = setup();
    const window: AppWindow = { openProject: OTHER, hiddenFromUser: true, epoch: 1 };
    const { host, payloads } = app(base, window, { hydrateTicks: 2, duringHydrate: (tick, w) => { if (tick === 1) w.epoch = 2; } });

    await start(base, host);

    expect(payloads).toEqual([]);
    expect(base.submit).toHaveBeenCalledTimes(0);
    expect(base.repository.read(PROJECT, RUN)!.stop?.reason).toBe("landing_failed");
  });

  it("hydrate finished, then the window is shown right before materialize → the host fence cancels, zero dispatch, nothing materialized", async () => {
    const base = setup();
    const window: AppWindow = { openProject: OTHER, hiddenFromUser: true };
    const { host, payloads } = app(base, window, { hydrateTicks: 2, beforeMaterialize: (w) => { w.hiddenFromUser = false; } });

    await start(base, host);

    expect(window.openProject).toBe(PROJECT);
    expect(payloads).toEqual([]);
    expect(base.submit).toHaveBeenCalledTimes(0);
    expect(base.repository.read(PROJECT, RUN)!.stop?.reason).toBe("landing_failed");
  });

  it("control: hydrate takes a few ticks with nothing changing → lands and dispatches exactly once", async () => {
    const base = setup();
    const window: AppWindow = { openProject: OTHER, hiddenFromUser: true };
    const { host, payloads } = app(base, window, { hydrateTicks: 3 });

    await start(base, host);

    expect(payloads).toHaveLength(1);
    expect(base.submit).toHaveBeenCalledTimes(1);
  });
});

// 第二轮复审遗漏 1：写回绑定的 await 期间窗口被叫出来——租约在落地写完、绑定写回之后再核一次，失效就这一趟 0 派发、
// landing_failed；节点已经在画布上（绑定也在），之后「继续 / 再开一次」直接认它再派。租约只管到这里为止（设计卡）。
describe("C′ lease after the bind is written back", () => {
  it("the window is shown while the bind is being written → this round sends nothing; the placed node stays and the next start sends exactly once", async () => {
    const base = setup();
    const window: AppWindow = { openProject: OTHER, hiddenFromUser: true };
    const { host, payloads } = app(base, window, { hydrateTicks: 2, duringBind: (w) => { w.hiddenFromUser = false; } });

    const first = await startSingleShotProduction({ repository: base.repository, submission: base.submission, landShots: host.landBeforeDispatch, projectId: PROJECT, runId: RUN, now: () => NOW });

    expect(payloads).toHaveLength(1);
    expect(base.submit).toHaveBeenCalledTimes(0);
    expect(first).toMatchObject({ nextAction: "canvas_landing_failed", landingFailure: { code: "landing_lease_revoked" } });
    const run = base.repository.read(PROJECT, RUN)!;
    expect(run.stop?.reason).toBe("landing_failed");
    expect(run.generationPlan!.nodeId).toBe("node-candidate-1");

    // 用户现在看着这个项目（窗口已叫出、项目开着）：再开一次不再落地，认那个已放好的节点直接派。
    const second = await startSingleShotProduction({ repository: base.repository, submission: base.submission, landShots: host.landBeforeDispatch, projectId: PROJECT, runId: RUN, now: () => NOW });
    expect(second).toMatchObject({ nextAction: "observe" });
    expect(base.submit).toHaveBeenCalledTimes(1);
    expect(payloads).toHaveLength(1);
  });
});
