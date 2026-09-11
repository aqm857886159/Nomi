import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createApprovalReceiptAuthority } from "./approvalReceipt";
import { createModuleRegistry } from "./moduleRegistry";
import { createGenerationRuntimeAdapter, type GenerationProvider } from "./generationRuntimeAdapter";
import { createGenerationPlanningHandler, type GenerationOperation, type GenerationOperationStore } from "./mcpGenerationTools";
import { PROJECT_LEASE_ALGORITHM, PROJECT_LEASE_AUDIENCE, PROJECT_LEASE_VERSION, type ProjectLeaseV2 } from "./projectLease";
import { createRunOwnedGenerationGateAuthority } from "./runOwnedGenerationGateAuthority";
import { createPendingSpendActions } from "./appIntegrationSpendConfirm";
import { createCanvasLandingHost } from "../productionRun/canvasLandingHost";
import { canvasLandingOperationId, type MaterializeShotsWirePayload } from "../productionRun/multiShotCanvasLanding";
import { createProductionGenerationOperationStore } from "../productionRun/productionGenerationOperationStore";
import { createProductionGenerationSubmission } from "../productionRun/productionGenerationSubmission";
import { prepareProductionGenerationAuthorization } from "../productionRun/prepareProductionGenerationAuthorization";
import { createProductionRunRepository } from "../productionRun/productionRunRepository";
import type { ModelPricing } from "../productionRun/shotPricing";

// 「确认 → 真的开始生成」的端到端夹具（P1.1a · 2026-09-11）。
//
// 这条链此前**一个测试都没有**：`appIntegrationSpendConfirm.ts` 是付费卡按钮背后的全部编排
// （改参数 → 撤旧授权 → 重新封印开门 → 主进程手势 → 铸收据 → 决门 → 消费收据 → start），
// 而它只被 `appIntegration` 的启动 try 装配，没有任何断言看着它。这里补上，零额度：
// 只有远端供应商是本机 loopback HTTP，其余（durable Run、封印/收据/门、提交-轮询-落库、画布落地口）全是真的。
//
// 三条核心断言（对应本轮验收）：
//   ① **执行的参数就是卡上改后的那份**——供应商真正收到的 body 带改后的值，收据的上限也按新价重算；
//   ② **收据绑定的候选版本 = 执行时的候选版本**——改参数会把候选推一版、撤掉旧授权，
//      所以「用户照着点头的那份」和「供应商跑的那份」结构上不可能分叉；
//   ③ **画布落地幂等**——建草稿 / 改参数 / 确认即落三个时机共用同一个 `canvas-landing:{runId}` 章，
//      落三次仍然只有一个节点（换一个章就会堆出重复节点，这正是该章存在的理由）。

const NOW_BASE = Date.parse("2026-09-11T00:00:00.000Z");
const roots: string[] = [];
let clock = NOW_BASE;
const now = () => new Date(clock).toISOString();

const PROJECT_ID = "project-1";
const OPERATION_ID = "op-spend";
const CANDIDATE_ID = "cand-hexagon";
/** 目录价目：基价 0.30，命中 `size:1536x1024` 再加 0.20 —— 改参数会把价格从 0.30 推到 0.50。 */
const PRICING: ModelPricing = { cost: 0.3, enabled: true, specCosts: [{ specKey: "size:1536x1024", cost: 0.2, enabled: true }] };

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text", "image"],
  outputKinds: ["image"],
  modes: ["text-to-image"],
  // 尺寸是这个模型档案真的认识的参数：它必须一路活到冻结的合同里，不然「卡上改了」就是句空话。
  parameterSchema: { size: { type: "string", enum: ["1024x1024", "1536x1024"] } },
  assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{
    providerId: "apimart",
    models: [
      { modelId: "image-model", modes: ["text-to-image"], parameterSchema: { size: { type: "string", enum: ["1024x1024", "1536x1024"] } }, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true } },
      { modelId: "image-model-pro", modes: ["text-to-image"], parameterSchema: { size: { type: "string", enum: ["1024x1024", "1536x1024"] } }, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true } },
    ],
  }],
}]);

const lease: ProjectLeaseV2 = {
  version: PROJECT_LEASE_VERSION,
  keyId: "key-1",
  algorithm: PROJECT_LEASE_ALGORITHM,
  issuer: "nomi-main",
  nonce: "nonce-1",
  scopeHash: "scope-hash-1",
  mac: "mac-1",
  projectId: PROJECT_ID,
  immutableProjectUuid: "project-uuid-1",
  projectGeneration: 1,
  canonicalRootDigest: "root-1",
  manifestDigest: "manifest-1",
  issuedAt: "2026-09-11T00:00:00.000Z",
  expiresAt: "2026-09-11T01:00:00.000Z",
  audience: PROJECT_LEASE_AUDIENCE,
  leasePrincipal: "mcp:agent-panel",
  sessionId: "session-1",
  connectionNonce: "connection-1",
  revocationEpoch: 0,
  scopeSet: ["generation:create", "generation:plan", "generation:preview", "generation:gate", "generation:submit", "generation:read"],
};

/** 真 loopback 供应商（零额度）：收下任务、报 succeeded、回一个可解码的 data URL，并记下每次请求体。 */
async function startLoopbackVendor() {
  const bodies: Array<Record<string, unknown>> = [];
  const pngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try { bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { bodies.push({}); }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ created: 1, data: [{ task_id: `task-${bodies.length}`, status: "succeeded", url: pngDataUrl }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as { port: number };
  return { origin: `http://127.0.0.1:${port}`, bodies, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/**
 * 供应商适配器。`buildRequest` 把**合同里冻着的那份载荷**原样带出来，`submit` 原样发给 loopback ——
 * 于是 `vendor.bodies` 里躺着的就是「供应商真正收到的参数」，而不是我们复述的一份。
 */
function loopbackProvider(origin: string, submits: string[]): GenerationProvider {
  return {
    providerId: "apimart",
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true },
    buildRequest: (input) => input,
    submit: async (request, idempotencyKey) => {
      submits.push(idempotencyKey);
      const contract = (request ?? {}) as { modelId?: string; parameters?: Record<string, unknown> };
      const res = await fetch(`${origin}/v1/images/generations`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey, model: contract.modelId, parameters: contract.parameters ?? {} }),
      });
      const json = await res.json() as { data: Array<{ task_id: string }> };
      return { providerTaskId: json.data[0].task_id, raw: json };
    },
    query: async (providerTaskId) => ({ status: "succeeded", raw: { id: providerTaskId, status: "succeeded" } }),
    materialize: async ({ providerTaskId }) => ({ outputs: [{ kind: "image", url: `nomi-local://asset/${PROJECT_ID}/${providerTaskId}.png` }] }),
  };
}

function candidate(modelId: string, parameters: Record<string, unknown>) {
  return {
    candidateId: CANDIDATE_ID, revision: 1, moduleId: "generation.single-shot", providerId: "apimart",
    modelId, mode: "text-to-image", prompt: "一个悬浮的六棱柱，柔和的演播室灯光", parameters, references: [],
  };
}

/**
 * 渲染层替身：它只实现那条**契约里写着的**去重不变量（`materializationStamp.ts`）——
 * 每个 `(materializationOperationId, shotId)` 至多一个节点。所以「同一次生成落了两个节点」
 * 只可能来自宿主每次换了一个章，而这正是这条断言要抓的东西。
 */
function recordingRenderer() {
  const payloads: MaterializeShotsWirePayload[] = [];
  const nodes = new Map<string, string>();
  const resultsByNode = new Map<string, { url: string }>();
  let nodeSequence = 0;
  const requestRenderer = async (op: string, payload: unknown): Promise<unknown> => {
    if (op !== "production.materialize-shots") return null;
    const wire = payload as MaterializeShotsWirePayload;
    payloads.push(structuredClone(wire));
    const bindings = wire.shots.map((shot) => {
      const key = `${wire.materializationOperationId}::${shot.shotId}`;
      const existing = nodes.get(key);
      const nodeId = existing ?? `node-${++nodeSequence}`;
      if (!existing) nodes.set(key, nodeId);
      if (shot.result) resultsByNode.set(nodeId, { url: shot.result.url });
      return { shotId: shot.shotId, nodeId };
    });
    return { bindings };
  };
  return { payloads, nodes, resultsByNode, requestRenderer };
}

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-spend-confirm-e2e-"));
  roots.push(root);
  const repository = createProductionRunRepository({ projectDirResolver: (p) => (p === PROJECT_ID ? root : null), now });
  const owner = {
    createGenerationDraft: repository.createGenerationDraft,
    readFull: (projectId: string, operationId: string) => {
      const run = repository.read(projectId, operationId);
      if (!run) throw new Error(`Run not found: ${operationId}`);
      return run;
    },
    command: async (projectId: string, operationId: string, command: Parameters<typeof repository.execute>[2]) => repository.execute(projectId, operationId, command),
  };
  const renderer = recordingRenderer();
  const canvasLanding = createCanvasLandingHost({
    readRun: (projectId, runId) => repository.read(projectId, runId),
    command: async (projectId, runId, command) => repository.execute(projectId, runId, command as Parameters<typeof repository.execute>[2]),
    requestRenderer: renderer.requestRenderer,
    resolveProjectRoot: () => root,
    previewSecret: () => "preview-secret",
    isProjectOpen: () => true,
  });
  const operations = createProductionGenerationOperationStore(owner as never, {
    onPlanChanged: (projectId, operationId) => canvasLanding.landDraftOnCanvas(projectId, operationId),
  }) as GenerationOperationStore;
  return { root, repository, owner, operations, renderer, canvasLanding };
}

function buildActions(base: ReturnType<typeof harness>, vendorOrigin: string, submits: string[]) {
  const { root, repository, owner, operations, canvasLanding } = base;
  const provider = loopbackProvider(vendorOrigin, submits);
  createGenerationRuntimeAdapter({ providers: [provider] }); // sanity: the real adapter accepts this provider
  const submission = createProductionGenerationSubmission({
    repository, projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1,
    projectRevision: 0, intentMacKey: "test-intent-key", providers: [provider],
    materializeOutput: async ({ providerTaskId }) => {
      // 真写一个字节到项目里：落地时的产物投影要读得到这个文件，读不到就只落占位、不回填 result。
      const relative = path.join(".nomi", "out", `${providerTaskId}.png`);
      fs.mkdirSync(path.join(root, ".nomi", "out"), { recursive: true });
      fs.writeFileSync(path.join(root, relative), Buffer.from("89504e470d0a1a0a", "hex"));
      return { artifactId: `artifact-${providerTaskId}`, kind: "image" as const, contentHash: `hash-${providerTaskId}`, projectRelativePath: relative };
    },
    now,
  });
  const handler = createGenerationPlanningHandler({
    registry,
    operations,
    resolveModelPricing: () => PRICING,
    now,
    prepareAuthorization: ({ lease: projectLease, operation, contract, multiShot }) => prepareProductionGenerationAuthorization({
      lease: projectLease, projectRevision: 0, operation, contract,
      ...(multiShot ? { multiShot } : {}),
      providers: [provider],
      resolveShotPrice: (shotContract) => {
        // 价格按**合同里冻着的那份参数**算，不是按草稿现有的：改完参数重新封印之后，收据的上限
        // 必须跟着新规格走，否则「印在卡上的数」和「冻进合同的数」会分叉。
        const spec = shotContract.parameters ?? {};
        const bump = PRICING.specCosts.filter((entry) => entry.enabled && Object.entries(spec).some(([key, value]) => entry.specKey === `${key}:${String(value)}` || entry.specKey === String(value))).reduce((sum, entry) => sum + entry.cost, 0);
        return { known: true, amount: PRICING.cost + bump };
      },
      now: now(),
    }),
    // appIntegration 的**单镜 start 分支**原样搬过来：start → 确认即落 → 观察到底（这里无需等待，
    // loopback 一次就 succeeded）。多镜那条由 multiShotBatchScheduler 的 e2e 覆盖。
    start: async (operation: GenerationOperation) => {
      const started = await submission.start({ projectId: PROJECT_ID, operationId: operation.operationId }) as { nextAction: string };
      await canvasLanding.landCanvasBestEffort(PROJECT_ID, operation.operationId);
      if (started.nextAction === "observe") {
        const polled = await submission.poll({ projectId: PROJECT_ID, operationId: operation.operationId }) as { nextAction: string };
        if (polled.nextAction === "materialize") await submission.materialize({ projectId: PROJECT_ID, operationId: operation.operationId });
        await canvasLanding.landCanvasBestEffort(PROJECT_ID, operation.operationId);
      }
      return started;
    },
  });
  let receiptSequence = 0;
  const receipts = createApprovalReceiptAuthority({
    filePath: path.join(root, "approval-receipts.json"),
    macKey: "test-receipt-key",
    storeMacKey: "test-receipt-store-key",
    keyId: "test-receipt-v1",
    now,
    randomId: () => `receipt-sequence-${++receiptSequence}`,
  });
  const authority = createRunOwnedGenerationGateAuthority({ owner: owner as never, operations, planning: handler, receipts, projectRevisionResolver: () => 0, now });
  const actions = (rendererTarget: () => { webContentsId: number; frameId: number; origin: string } | null) => createPendingSpendActions({
    isProjectOpen: () => true,
    runs: { read: (projectId, runId) => repository.read(projectId, runId), list: (projectId) => repository.list(projectId) },
    operations,
    planning: handler,
    requestGenerationGate: authority.requestGenerationGate,
    authorizeGeneration: authority.authorizeGeneration,
    receipts,
    rendererTarget,
    committedBinding: () => ({ projectId: PROJECT_ID, immutableProjectUuid: "project-uuid-1", projectGeneration: 1 }),
    leaseFor: async () => lease,
    resolvePricing: () => PRICING,
    now,
  });
  const window = () => ({ webContentsId: 1, frameId: 0, origin: "app://nomi" });
  return { actions, withWindow: actions(window), withoutWindow: actions(() => null), submission, handler, receipts };
}

/** Agent 在面板里建的那份草稿（origin.host='nomi' 才会投影成面板上的付费卡）。 */
async function draft(base: ReturnType<typeof harness>): Promise<void> {
  await base.operations.create({
    operationId: OPERATION_ID, projectId: PROJECT_ID, candidate: candidate("image-model", { size: "1024x1024" }),
    now: now(), origin: { host: "nomi", actorId: "agent-panel" },
  });
  await base.canvasLanding.settleCanvasLanding(PROJECT_ID);
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  clock = NOW_BASE;
});

describe("Agent 面板付费卡：确认 → 真的开始生成（零额度 loopback）", () => {
  it("卡上改参数 → 按主按钮 → 重新封印/铸收据/决门/开跑 → 供应商收到的就是改后那份，产物落回同一个画布节点", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const { withWindow } = buildActions(base, vendor.origin, submits);
    try {
      await draft(base);

      // ── 卡出现了，印的是草稿此刻的样子 ──
      const before = withWindow.listPendingSpend(PROJECT_ID);
      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject({ operationId: OPERATION_ID, candidateRevision: 1, unknownShotCount: 0 });
      expect(before[0].shots[0]).toMatchObject({ modelId: "image-model", parameters: { size: "1024x1024" } });
      expect(before[0].knownSubtotal).toBeCloseTo(0.3, 6);
      // 草稿一建就落了画布（用户当场看得见 agent 要生成什么），一个节点。
      expect(base.renderer.nodes.size).toBe(1);
      const nodeId = [...base.renderer.nodes.values()][0];

      // ── 用户在卡上换模型 + 改尺寸，然后按主按钮 ──
      // `confirm` 之前的 `revise` 是面板 hook 在按下那一刻做的同一件事（useAgentPanelSpendConfirm.confirm）。
      clock += 1000;
      const revised = await withWindow.revisePendingSpend({
        projectId: PROJECT_ID, operationId: OPERATION_ID,
        patch: { parameters: { size: "1536x1024" } },
      });
      expect(revised).toMatchObject({ ok: true, code: "revised" });
      await base.canvasLanding.settleCanvasLanding(PROJECT_ID);

      const afterEdit = withWindow.listPendingSpend(PROJECT_ID)[0];
      // 改参数把候选推了一版，价格按目录重算（0.30 基价 + 0.20 规格加价）。数只有宿主一个产地。
      expect(afterEdit.candidateRevision).toBe(2);
      expect(afterEdit.shots[0]).toMatchObject({ modelId: "image-model", parameters: { size: "1536x1024" } });
      expect(afterEdit.knownSubtotal).toBeCloseTo(0.5, 6);

      clock += 1000;
      const confirmed = await withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID });
      expect(confirmed).toMatchObject({ ok: true, code: "spend_confirmed" });
      await base.canvasLanding.settleCanvasLanding(PROJECT_ID);

      // ── ① 供应商真正收到的就是卡上改后那一份 ──
      expect(submits).toHaveLength(1);
      expect(vendor.bodies).toHaveLength(1);
      expect(vendor.bodies[0]).toMatchObject({ model: "image-model", parameters: { size: "1536x1024" } });

      const run = base.repository.read(PROJECT_ID, OPERATION_ID)!;
      const plan = run.generationPlan!;
      expect(plan.state).toBe("submitted");

      // ── ② 收据绑定的候选版本 = 执行时的候选版本 ──
      // 门是在**改完之后**才开的，所以信封里冻着的 candidateRevision 只可能是改后那一版；
      // 决门的那张收据就绑在这个 gateId + digest 上（对不上批不动）。
      const envelopeTargets = (plan.authorizationEnvelope?.jobs ?? []).map((job) => job.target as { candidateRevision?: number });
      expect(envelopeTargets).toHaveLength(1);
      expect(envelopeTargets[0].candidateRevision).toBe(2);
      expect(plan.candidate.revision).toBe(2);
      const gate = run.gates.find((entry) => entry.gateId === plan.authorizationGateId)!;
      expect(gate.status).toBe("approved");
      expect(gate.receiptId).toBeTruthy();
      expect(gate.authorizationDigest).toBe(plan.authorizationDigest);
      // 执行出来的那个 job 也绑在同一份合同上（收据 = 实际执行，不是注释保证的）。
      const job = run.jobs[0]!;
      expect(job.status === "ready" || job.status === "adopted").toBe(true);
      expect(run.artifacts.filter((artifact) => artifact.status === "ready" && artifact.jobId === job.jobId)).toHaveLength(1);

      // ── ③ 画布落地幂等 + 产物回到**同一个**节点 ──
      // 建草稿 / 改参数 / start 后各落了一次，三次共用 `canvas-landing:{runId}` 一个章 → 仍然一个节点。
      expect(base.renderer.payloads.length).toBeGreaterThanOrEqual(3);
      expect(new Set(base.renderer.payloads.map((entry) => entry.materializationOperationId))).toEqual(
        new Set([canvasLandingOperationId(OPERATION_ID)]),
      );
      expect(base.renderer.nodes.size).toBe(1);
      expect([...base.renderer.nodes.values()][0]).toBe(nodeId);
      expect(base.renderer.resultsByNode.get(nodeId)?.url).toMatch(/^nomi-local:\/\//);
    } finally {
      await vendor.close();
    }
  });

  it("没有窗口代表真人时，确认 fail-closed：一次供应商请求都不发生", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const { withoutWindow } = buildActions(base, vendor.origin, submits);
    try {
      await draft(base);
      const result = await withoutWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID });
      expect(result).toMatchObject({ ok: false, code: "unavailable" });
      expect(submits).toHaveLength(0);
      expect(vendor.bodies).toHaveLength(0);
      expect(base.repository.read(PROJECT_ID, OPERATION_ID)!.generationPlan!.state).toBe("draft");
    } finally {
      await vendor.close();
    }
  });

  it("确认过一次之后卡就不再出现，重复按也不会再发一次生成（幂等，不重复扣费）", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const { withWindow } = buildActions(base, vendor.origin, submits);
    try {
      await draft(base);
      clock += 1000;
      expect(await withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID })).toMatchObject({ ok: true });
      await base.canvasLanding.settleCanvasLanding(PROJECT_ID);
      expect(submits).toHaveLength(1);

      // 卡消失了：`submitted` 不再投影成「等你点头」（已经答过的问题不再问第二遍）。
      expect(withWindow.listPendingSpend(PROJECT_ID)).toHaveLength(0);
      clock += 1000;
      const again = await withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID });
      expect(again.ok).toBe(false);
      expect(submits).toHaveLength(1);
      expect(vendor.bodies).toHaveLength(1);
    } finally {
      await vendor.close();
    }
  });
  /**
   * #748 记下的已知缺口，本轮修好，断言随之翻成正面（不是删掉它）。
   *
   * 缺口是什么：Run 的 policy `allowedModels` 在**建草稿那一刻**从候选身份冻下来，
   * 于是用户在卡上换个模型再确认，会撞上一句「模型未加入白名单」——而他做的只是
   * 在下拉里选了另一个模型。冻它本是为了拦 **agent** 偷换模型（agent 走
   * `generation.patch`，那条路一个字没改）；`generation.revise` 只有付费卡这一个入口。
   *
   * 现在放行的边界是**同一个任务类别**（`candidate.mode`）。跨类别仍然 fail-closed。
   */
  it("卡上换模型 → 确认 → 供应商收到的就是换后那个模型（#748 缺口已修）", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const { withWindow } = buildActions(base, vendor.origin, submits);
    try {
      await draft(base);
      const nodeId = [...base.renderer.nodes.values()][0];

      clock += 1000;
      expect(await withWindow.revisePendingSpend({
        projectId: PROJECT_ID, operationId: OPERATION_ID, patch: { modelId: "image-model-pro" },
      })).toMatchObject({ ok: true, code: "revised" });
      await base.canvasLanding.settleCanvasLanding(PROJECT_ID);

      // 卡上印的已经是换后那个模型，价格按同一条算式重算（这个模型同价：0.30）。
      const afterEdit = withWindow.listPendingSpend(PROJECT_ID)[0];
      expect(afterEdit.shots[0]).toMatchObject({ modelId: "image-model-pro" });
      expect(afterEdit.knownSubtotal).toBeCloseTo(0.3, 6);

      clock += 1000;
      expect(await withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID }))
        .toMatchObject({ ok: true, code: "spend_confirmed" });
      await base.canvasLanding.settleCanvasLanding(PROJECT_ID);

      // 供应商真正收到的是换后那个模型——不是「没被拒」而已。
      expect(submits).toHaveLength(1);
      expect(vendor.bodies).toHaveLength(1);
      expect(vendor.bodies[0]).toMatchObject({ model: "image-model-pro" });

      const run = base.repository.read(PROJECT_ID, OPERATION_ID)!;
      expect(run.generationPlan!.state).toBe("submitted");
      // 白名单认下了新模型，**旧的没被顶掉**（用户还能换回去），而那笔钱的闸一个都没松。
      expect(run.policy.allowedModels).toContain("image-model-pro");
      expect(run.policy.allowedModels).toContain("image-model");
      // 换模型没有多开一个画布节点：还是草稿一建就落的那一个。
      expect(base.renderer.nodes.size).toBe(1);
      expect([...base.renderer.nodes.values()][0]).toBe(nodeId);
    } finally {
      await vendor.close();
    }
  });

  it("跨任务类别换模型仍被白名单挡下：那换掉的是整个花钱量级，不叫「改一下」", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const { withWindow } = buildActions(base, vendor.origin, submits);
    try {
      await draft(base);
      clock += 1000;
      expect(await withWindow.revisePendingSpend({
        projectId: PROJECT_ID, operationId: OPERATION_ID,
        patch: { modelId: "video-model", mode: "image-to-video" },
      })).toMatchObject({ ok: true });
      clock += 1000;
      const confirmed = await withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID });
      expect(confirmed.ok).toBe(false);
      // 被拒得干净：没花钱，草稿还在，用户还能改回去。
      expect(submits).toHaveLength(0);
      expect(vendor.bodies).toHaveLength(0);
      expect(withWindow.listPendingSpend(PROJECT_ID)).toHaveLength(1);
    } finally {
      await vendor.close();
    }
  });
});
