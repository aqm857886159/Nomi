import { hardenedFetch } from '../hardenedFetch';
import fs from "node:fs";
import { createMultiShotBatchScheduler } from "../productionRun/multiShotBatchScheduler";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { createApprovalReceiptAuthority } from "./approvalReceipt";
import { createModuleRegistry } from "./moduleRegistry";
import { createGenerationRuntimeAdapter, type GenerationProvider } from "./generationRuntimeAdapter";
import { createGenerationPlanningHandler, type GenerationOperation, type GenerationOperationStore } from "./mcpGenerationTools";
import { PROJECT_LEASE_ALGORITHM, PROJECT_LEASE_AUDIENCE, PROJECT_LEASE_VERSION, type ProjectLeaseV2 } from "./projectLease";
import { createRunOwnedGenerationGateAuthority } from "./runOwnedGenerationGateAuthority";
import { createPendingSpendActions } from "./appIntegrationSpendConfirm";
import { createPiGenerationTransportAdapter } from "./generationTransportAdapters";
import type { ProjectAgentApprovalPolicy } from "../shared/agentCapabilities/capabilityApprovalPolicy";
import { createCanvasLandingHost } from "../productionRun/canvasLandingHost";
import { type MaterializeShotsWirePayload } from "../productionRun/multiShotCanvasLanding";
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
      res.writeHead(200, { "content-type": "application/json", connection: "close" });
      res.end(JSON.stringify({ created: 1, data: [{ task_id: `task-${bodies.length}`, status: "succeeded", url: pngDataUrl }] }));
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
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
      const res = await hardenedFetch(`${origin}/v1/images/generations`, {
        // Exact origin belongs to this test server; redirects remain forbidden.
        allowedPrivateOrigins: [origin],
        allowContentTypes: ["application/json"],
        method: "POST",
        body: JSON.stringify({ idempotencyKey, model: contract.modelId, parameters: contract.parameters ?? {} }),
      });
      const json = JSON.parse(res.bytes.toString("utf8")) as { data: Array<{ task_id: string }> };
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
    isProjectOpen: () => true,
  });
  const operations = createProductionGenerationOperationStore(owner as never, {
    onPlanChanged: (projectId, operationId) => canvasLanding.landDraftOnCanvas(projectId, operationId),
  }) as GenerationOperationStore;
  return { root, repository, owner, operations, renderer, canvasLanding };
}

function buildActions(base: ReturnType<typeof harness>, vendorOrigin: string, submits: string[], hooks: {
  beforeAuthorize?: () => Promise<void>;
  afterAuthorize?: () => Promise<void>;
  /**
   * 目录一条价都没填的那台机器（干净装机上的 100% 默认状态）。开着它，整条链上的价格全是
   * `{ known: false }`——付费卡、门、账本、供应商请求都得在「算不出价」下跑通，
   * 且任何一处都不许出现代表未知的 0（2026-09-21 未知价开闸）。
   */
  unpriced?: boolean;
} = {}) {
  const { root, repository, owner, operations, canvasLanding } = base;
  const provider = loopbackProvider(vendorOrigin, submits);
  createGenerationRuntimeAdapter({ providers: [provider] }); // sanity: the real adapter accepts this provider
  const submission = createProductionGenerationSubmission({
    repository, projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1,
    projectRevision: 0, intentMacKey: "test-intent-key", providers: [provider],
    materializeOutput: async ({ providerTaskId }) => {
      // 真写一个字节到项目里：落地时的产物投影要读得到这个文件，读不到就只落占位、不回填 result。
      // 项目相对路径恒为 posix 形状（真物化器 writeDeterministicAsset 用的就是 path.posix.join）；
      // 用 path.join 在 Windows 上会写出反斜杠，产物投影当场拒收，结果回填不了。
      const relative = path.posix.join(".nomi", "out", `${providerTaskId}.png`);
      fs.mkdirSync(path.join(root, ".nomi", "out"), { recursive: true });
      fs.writeFileSync(path.join(root, relative), Buffer.from("89504e470d0a1a0a", "hex"));
      return { artifactId: `artifact-${providerTaskId}`, kind: "image" as const, contentHash: `hash-${providerTaskId}`, projectRelativePath: relative };
    },
    now,
  });
  /** 授权必须站在真实 Run 上（`run` 现在是必填）。读不到就在这里停，而不是悄悄退回 attempt=1。 */
  const requiredHarnessRun = (projectId: string, operationId: string) => {
    const run = repository.read(projectId, operationId);
    if (!run) throw new Error(`Harness has no durable Run for ${operationId}`);
    return run;
  };
  const handler = createGenerationPlanningHandler({
    registry,
    operations,
    resolveModelPricing: () => (hooks.unpriced ? undefined : PRICING),
    now,
    prepareAuthorization: ({ lease: projectLease, operation, contract, multiShot }) => prepareProductionGenerationAuthorization({
      lease: projectLease, projectRevision: 0, operation, contract,
      run: requiredHarnessRun(operation.projectId, operation.operationId),
      maximumSpend: requiredHarnessRun(operation.projectId, operation.operationId).policy.maxSpend,
      ...(multiShot ? { multiShot } : {}),
      providers: [provider],
      resolveShotPrice: (shotContract) => {
        if (hooks.unpriced) return { known: false };
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
      if (operation.shots?.length) {
        const run = repository.read(PROJECT_ID, operation.operationId)!;
        if (run.generationPlan?.state === "sealed") repository.execute(PROJECT_ID, operation.operationId, {
          commandId: `fixture:submit:v${run.planVersion}`, expectedRevision: run.revision,
          type: "generation.submit", payload: {}, issuedAt: now(),
        });
        const scheduler = createMultiShotBatchScheduler({
          repository, submission, projectId: PROJECT_ID, runId: operation.operationId,
          perShotPrice: () => (hooks.unpriced ? { known: false } : { known: true, amount: PRICING.cost }), now,
        });
        await scheduler.runToQuiescence();
        await canvasLanding.landCanvasBestEffort(PROJECT_ID, operation.operationId);
        return { operationId: operation.operationId, state: "submitted", nextAction: "observe" };
      }
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
    authorizeGeneration: async input => {
      await hooks.beforeAuthorize?.();
      const result = await authority.authorizeGeneration(input);
      await hooks.afterAuthorize?.();
      return result;
    },
    receipts,
    rendererTarget,
    committedBinding: () => ({ projectId: PROJECT_ID, immutableProjectUuid: "project-uuid-1", projectGeneration: 1 }),
    leaseFor: async () => lease,
    resolvePricing: () => (hooks.unpriced ? undefined : PRICING),
    now,
  });
  const window = () => ({ webContentsId: 1, frameId: 0, origin: "app://nomi" });
  /**
   * 模型那一侧真正用的传输适配器。「全自动」那条免卡放行就长在它里面（`preview` 之后），
   * 所以这条链必须由**同一个夹具**驱动——另起一份夹具就等于在测一个我们自己编的世界。
   */
  const transport = (mode: ProjectAgentApprovalPolicy["mode"]) => createPiGenerationTransportAdapter(
    { projectId: PROJECT_ID, immutableProjectUuid: "project-uuid-1", projectGeneration: 1 },
    {
      planning: handler,
      requestGenerationGate: authority.requestGenerationGate,
      authorizeGeneration: authority.authorizeGeneration,
      approvalReceiptAuthority: receipts,
      leaseFor: () => lease,
      approvalPolicy: () => ({ mode, spend: "confirm" }),
    },
  );
  return { actions, withWindow: actions(window), withoutWindow: actions(() => null), submission, handler, receipts, authority, transport };
}

/** 模型那一侧的一次调用（`tryExecute` 的入参形状）。 */
async function callTool(
  transport: ReturnType<ReturnType<typeof buildActions>["transport"]>,
  toolName: string,
  args: Record<string, unknown>,
) {
  return transport.tryExecute({ toolCallId: `call-${toolName}`, toolName, args }, new AbortController().signal);
}

/** Agent 在面板里建的那份草稿（origin.host='nomi' 才会投影成面板上的付费卡）。 */
async function draft(base: ReturnType<typeof harness>): Promise<void> {
  await base.operations.create({
    operationId: OPERATION_ID, projectId: PROJECT_ID, candidate: candidate("image-model", { size: "1024x1024" }),
    now: now(), origin: { host: "nomi", actorId: "agent-panel" },
  });
  await base.canvasLanding.settleCanvasLanding(PROJECT_ID);
}

export function resetSpendFixture() {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  clock = NOW_BASE;
}
export function advanceClock(milliseconds: number) { clock += milliseconds; }
export { PROJECT_ID, OPERATION_ID, CANDIDATE_ID, PRICING, registry, lease, now, candidate, startLoopbackVendor, harness, buildActions, callTool, draft };
