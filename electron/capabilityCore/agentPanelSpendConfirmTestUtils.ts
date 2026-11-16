import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createModuleRegistry } from "./moduleRegistry";
import { createGenerationPlanningHandler, type GenerationOperationStore } from "./mcpGenerationTools";
import type { GenerationProvider } from "./generationRuntimeAdapter";
import { prepareProductionGenerationAuthorizationWithReferences } from "../productionRun/prepareProductionGenerationAuthorization";
import { createGenerationReferenceScopeGuard } from "./generationReferenceScope";
import { resolveProductionReferenceUrls } from "./productionReferenceUrls";
import { PROJECT_LEASE_ALGORITHM, PROJECT_LEASE_AUDIENCE, PROJECT_LEASE_VERSION, type ProjectLeaseV2 } from "./projectLease";
import { createPendingSpendActions } from "./appIntegrationSpendConfirm";
import { createPiGenerationTransportAdapter } from "./generationTransportAdapters";
import { residentRunFacts } from "./residentGenerationAdapterFactory";
import { installCanvasShotRuns, withdrawQueuedHandOvers, type CanvasConsentShot } from "./appIntegrationCanvasShot";
import { createCanvasHandOver } from "./canvasHandOver";
import { HAND_OVER_SHOTS_OP } from "../shared/contracts/canvasHandOver";
import { setupCanvasShots } from "./canvasShotTestUtils";
import type { CanvasTransport } from "./canvasTransportProvider";
import type { ProjectAgentApprovalPolicy } from "../shared/agentCapabilities/capabilityApprovalPolicy";
import type { DirectorPreviewSpendBlockReason } from "../shared/director/directorPreviewStatus";
import type { PendingSpendConfirm } from "../shared/contracts/pendingSpendConfirm";
import { createCanvasLandingHost } from "../productionRun/canvasLandingHost";
import type { MaterializeShotsWirePayload } from "../productionRun/multiShotCanvasLanding";
import { createProductionGenerationOperationStore } from "../productionRun/productionGenerationOperationStore";
import { createProductionRunRepository } from "../productionRun/productionRunRepository";
import { createProductionRunService } from "../productionRun/productionRunService";
import { withEventTap } from "../productionRun/productionRunEventTap";
import type { GenerationHandOverFailure, ProductionRun } from "../productionRun/productionRunTypes";
import { watchSpendCardClose } from "../agentLane/laneSpendCardClose";
import type { ModelPricing } from "../productionRun/shotPricing";
import type { PlanCandidate } from "./executionContract";
import { resolveIndexedReferencePreview, type SpendReferenceAssets } from "./pendingSpendReferences";

// Agent 面板付费卡的端到端夹具（D2 第③步：卡 = 指向元素 + 一行只读摘要 + 主按钮；一台发动机）。
//
// 卡上点「生成」只做一件事：把这几镜交给画布，逐镜走画布单节点提交那一条路。所以这里搭的是**生产同一份接线**：
//   · 一个账本（真 durable Run 仓库 + 事件旁路：制作 Run 与画布单镜 Run 同住一处，变更订阅与生产同形）；
//   · 真操作存储、真落地宿主、真画布付费口（`createCanvasShotRuns`，经 `setupCanvasShots`：真收据、真提交出口、真派发闸）、
//     真画布交接编排（`createCanvasHandOver`）、真卡上动作（`createPendingSpendActions`）、真常驻传输（`createPiGenerationTransportAdapter`
//     + 工厂同一份 `residentRunFacts`）；排队交接的收回挂在账本的变更订阅上（`withdrawQueuedHandOvers`），和 appIntegration 一样；
//   · 只有两样是替身：画布那台的传输（进程内假供应商，`vendor.executes` 记下供应商真正收到的每一份请求），和渲染层。
//
// 渲染层替身只实现契约里写着的那几件事：落地（每个 `(materializationOperationId, shotId)` 至多一个节点，节点上记下候选——
// 节点就是一镜要发什么的唯一来源），和 `production.hand-over-shots`（读节点 → 本机判得出发不出去的跳过并说原因 → 为其余的开出带
// 制作链接的画布同意 → 回话 → 之后照画布批量那一条路逐镜「交」）。所以「卡上摘要 = 节点 = 供应商收到的」在这里能逐项对上。

const NOW_BASE = Date.parse("2026-10-24T00:00:00.000Z");
const roots: string[] = [];
let clock = NOW_BASE;
const now = () => new Date(clock).toISOString();

const PROJECT_ID = "project-1";
const OPERATION_ID = "op-spend";
const CANDIDATE_ID = "cand-paper-boat";
/** 画布那台的供应商（`setupCanvasShots` 只认这一家）。 */
const VENDOR = "acme";

const IMAGE_SCHEMA = { size: { type: "string", enum: ["1024x1024", "1536x1024"] } } as const;
const VIDEO_SCHEMA = { duration: { type: "number" }, aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1"] }, resolution: { type: "string", enum: ["480p", "720p"] } } as const;
const CAPABILITIES = { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true } as const;

const registry = createModuleRegistry([
  {
    moduleId: "generation.single-shot", version: "1.0.0", inputKinds: ["text", "image"], outputKinds: ["image"], modes: ["text_to_image"],
    parameterSchema: IMAGE_SCHEMA, assetInputSchema: { references: { kind: "image", max: 4 } },
    providers: [{ providerId: VENDOR, models: [{ modelId: "img-model", modes: ["text_to_image"], parameterSchema: IMAGE_SCHEMA, capabilities: CAPABILITIES }] }],
  },
  {
    moduleId: "generation.video", version: "1.0.0", inputKinds: ["text", "image"], outputKinds: ["video"], modes: ["text_to_video"],
    parameterSchema: VIDEO_SCHEMA, assetInputSchema: { references: { kind: "image", max: 4 } },
    providers: [{ providerId: VENDOR, models: [{ modelId: "vid-model", modes: ["text_to_video"], parameterSchema: VIDEO_SCHEMA, capabilities: CAPABILITIES }] }],
  },
]);

const lease: ProjectLeaseV2 = {
  version: PROJECT_LEASE_VERSION, keyId: "key-1", algorithm: PROJECT_LEASE_ALGORITHM, issuer: "nomi-main", nonce: "nonce-1",
  scopeHash: "scope-hash-1", mac: "mac-1", projectId: PROJECT_ID, immutableProjectUuid: "uuid-1", projectGeneration: 1,
  canonicalRootDigest: "root-1", manifestDigest: "manifest-1", issuedAt: "2026-10-24T00:00:00.000Z", expiresAt: "2099-10-24T00:00:00.000Z",
  audience: PROJECT_LEASE_AUDIENCE, leasePrincipal: "mcp:agent-panel", sessionId: "session-1", connectionNonce: "connection-1", revocationEpoch: 0,
  scopeSet: ["generation:create", "generation:plan", "generation:preview", "generation:gate", "generation:submit", "generation:read"],
};

function candidate(modelId = "img-model", parameters: Record<string, unknown> = { size: "1024x1024" }, prompt = "一只纸船在雨后的水洼里慢慢漂"): PlanCandidate {
  const video = modelId === "vid-model";
  return {
    candidateId: CANDIDATE_ID, revision: 1, moduleId: video ? "generation.video" : "generation.single-shot", providerId: VENDOR,
    modelId, mode: video ? "text_to_video" : "text_to_image", prompt, parameters, references: [],
  };
}

/** 画布上的一个节点（渲染层替身的那一份）：一镜要发什么只住在这里——卡上摘要读它、交的时候也读它。 */
export type FakeNode = {
  nodeId: string;
  runId: string;
  shotId: string;
  kind: "image" | "video";
  prompt: string;
  vendor: string;
  modelKey: string;
  mode: string;
  candidateRevision: number;
  parameters: Record<string, string | number | boolean>;
  references: Array<{ url: string; kind: string; role?: string }>;
};

export type SpendWorldOptions = Readonly<{
  /** 目录价目（缺省 = 一条价都没有：干净装机的默认状态，哪儿都不许出现代表未知的 0）。 */
  pricing?: ModelPricing;
  /** 换掉画布那台的传输（「没发出去」矩阵接真的 vendorHttp → appFetch）。 */
  canvasTransport?: CanvasTransport;
  /** 3D-BOX 预演闸的回话（缺省 = 没挡）。 */
  previewBlock?: DirectorPreviewSpendBlockReason | "unrecognized" | null;
  /**
   * 渲染层本机就判得出发不出去的那几镜（必填项缺 / 参考不在 / 节点不可用 / 本机参考要匿名托管而这一下没带托管同意）：
   * 跳过、说原因，主进程记成没发出去（债 a）。
   */
  validateNode?: (node: FakeNode) => GenerationHandOverFailure | null;
  /** 一开始就把派发扣住（开好同意、回过话，交的那一下等 `releaseDispatch()`）。 */
  holdDispatch?: boolean;
  /** 起草路要的目录（缺省 = 本文件那份 acme 目录）与视频档案候选。 */
  registry?: ReturnType<typeof createModuleRegistry>;
  videoModelCandidates?: Parameters<typeof createGenerationPlanningHandler>[0]["videoModelCandidates"];
  /**
   * 项目素材库（缺省 = 没有：起草钉住的参考一条都不过线）。给了就走生产同一组解析口：起草时钉住参考的身份
   * （计划处理器的 `resolveAssetReferenceIdentity`，生产里与它同一个 `resolveProjectAssetReferenceIdentity`）+ 落地时的地址
   * （`resolveIndexedReferencePreview`）。
   */
  assets?: SpendReferenceAssets;
  /** Agent generate 封信封时的参考地址解析；测试可换成真实的延迟 multipart 上传。 */
  resolveReferences?: Parameters<typeof prepareProductionGenerationAuthorizationWithReferences>[1];
}>;

const authorizationProvider: GenerationProvider = {
  providerId: VENDOR,
  capabilities: CAPABILITIES,
  buildRequest: (input) => structuredClone(input),
  submit: async (_request, idempotencyKey) => ({ providerTaskId: `authorization-${idempotencyKey}` }),
};

function rendererDouble(validateNode: SpendWorldOptions["validateNode"]) {
  const nodes = new Map<string, FakeNode>();
  /** 收到的每一份落地报文（原样，铁律 ⑩ 的宿主矩阵从这里接着走渲染层落节点那几步）。 */
  const payloads: MaterializeShotsWirePayload[] = [];
  const byShot = new Map<string, string>();
  const handOverCalls: Array<Readonly<{ runId: string; shots: Array<{ shotId: string; nodeId: string }> }>> = [];
  const dispatchErrors: unknown[] = [];
  let nodeSequence = 0;
  let recordSequence = 0;
  let landingFailing = false;
  let handOverFailing = false;
  let holding = false;
  const queue: Array<() => Promise<void>> = [];
  let pump: Promise<void> = Promise.resolve();
  let canvas: ReturnType<typeof setupCanvasShots> | undefined;
  let beforeConsent: (() => void | Promise<void>) | undefined;

  const pumpQueue = (): void => {
    pump = pump.then(async () => {
      while (!holding && queue.length > 0) {
        const next = queue.shift()!;
        await next();
      }
    });
  };

  /** 交一镜：和画布节点 ↑ / 批量卡同一个付费口（`submit`），请求从节点读。 */
  const submitNode = async (node: FakeNode, runRecordId: string): Promise<unknown> => {
    if (!canvas) throw new Error("canvas runs not attached");
    return canvas.runs.submit({
      projectId: PROJECT_ID, nodeId: node.nodeId, runRecordId, vendor: node.vendor, gesture: canvas.gesture, senderId: canvas.senderId,
      request: {
        kind: node.mode, prompt: node.prompt,
        extras: {
          nodeId: node.nodeId, projectId: PROJECT_ID, modelKey: node.modelKey, idempotencyKey: runRecordId,
          productionRunId: node.runId, productionShotId: node.shotId,
          ...node.parameters,
          ...(node.references.length ? { references: node.references.map((reference) => ({ ...reference })) } : {}),
        },
      },
    });
  };

  const requestRenderer = async (op: string, payload: unknown): Promise<unknown> => {
    if (op === "production.materialize-shots") {
      if (landingFailing) throw new Error("Nomi window unavailable");
      const wire = payload as MaterializeShotsWirePayload;
      payloads.push(structuredClone(wire));
      const bindings = wire.shots.flatMap((shot) => {
        const key = `${wire.materializationOperationId}::${shot.shotId}`;
        let nodeId = byShot.get(key);
        if (!nodeId) {
          if (wire.existingOnly || shot.existingOnly) return [];
          nodeId = `node-${++nodeSequence}`;
          byShot.set(key, nodeId);
        }
        const existing = nodes.get(nodeId);
        const incoming = shot.candidate;
        // 第一次落 / Agent 改了稿（候选版本变了）才写节点；同一版的重放一个字不动（用户在节点上的手改留着）。
        if (incoming && (!existing || incoming.revision > existing.candidateRevision)) {
          nodes.set(nodeId, {
            nodeId, runId: wire.runId, shotId: shot.shotId, kind: shot.kind ?? (incoming.mode.includes("video") ? "video" : "image"),
            prompt: shot.prompt ?? existing?.prompt ?? "", vendor: incoming.vendor, modelKey: incoming.modelKey, mode: incoming.mode,
            candidateRevision: incoming.revision, parameters: { ...(incoming.parameters ?? {}) },
            references: (incoming.references ?? []).map((reference) => ({ ...reference })),
          });
        }
        return [{ shotId: shot.shotId, nodeId }];
      });
      return { bindings };
    }
    if (op === HAND_OVER_SHOTS_OP) {
      const input = payload as { projectId: string; runId: string; shots: Array<{ shotId: string; nodeId: string }> };
      handOverCalls.push(structuredClone(input));
      if (handOverFailing) throw Object.assign(new Error("Nomi window unavailable"), { name: "RendererUnavailableError" });
      await beforeConsent?.();
      const skipped: Array<{ shotId: string; failure: GenerationHandOverFailure }> = [];
      const ready: Array<{ node: FakeNode; runRecordId: string }> = [];
      for (const target of input.shots) {
        const node = nodes.get(target.nodeId);
        if (!node) { skipped.push({ shotId: target.shotId, failure: { kind: "not_sent", code: "canvas_node_missing" } }); continue; }
        const invalid = validateNode?.(node);
        if (invalid) { skipped.push({ shotId: target.shotId, failure: invalid }); continue; }
        ready.push({ node, runRecordId: `rr-${node.nodeId}-${++recordSequence}` });
      }
      if (ready.length > 0) {
        if (!canvas) throw new Error("canvas runs not attached");
        const shots: CanvasConsentShot[] = ready.map(({ node, runRecordId }) => ({
          nodeId: node.nodeId, runRecordId, vendor: node.vendor, modelKey: node.modelKey, kind: node.kind,
          production: { runId: input.runId, shotId: node.shotId },
        }));
        canvas.runs.consent({ projectId: input.projectId, shots, senderId: canvas.senderId });
        for (const entry of ready) {
          queue.push(async () => {
            try { await submitNode(entry.node, entry.runRecordId); } catch (error) { dispatchErrors.push(error); }
          });
        }
        pumpQueue();
      }
      return { skipped };
    }
    if (op === "director.preview-blocks") return null;
    return null;
  };

  return {
    nodes,
    payloads,
    handOverCalls,
    dispatchErrors,
    requestRenderer,
    attach: (attached: ReturnType<typeof setupCanvasShots>) => { canvas = attached; },
    /** 落不到画布上（窗口不在 / 项目不对）：materialize-shots 当场抛，与生产 requestRenderer 失败同形。 */
    setLandingFailing: (value: boolean) => { landingFailing = value; },
    /** 交接那一问渲染层不在（窗口关了）。 */
    setHandOverFailing: (value: boolean) => { handOverFailing = value; },
    /** 渲染层开同意之前插一刀（× 晚到、用户打字……落在「记了决定、还没绑上画布」那一段）。 */
    setBeforeConsent: (hook: (() => void | Promise<void>) | undefined) => { beforeConsent = hook; },
    holdDispatch: () => { holding = true; },
    releaseDispatch: () => { holding = false; pumpQueue(); },
    /** 排队的派发跑完（扣着的不算）。 */
    drain: async () => { pumpQueue(); await pump; },
    queuedDispatches: () => queue.length,
    nodeOf: (shotId: string, runId: string = OPERATION_ID) => [...nodes.values()].find((node) => node.runId === runId && node.shotId === shotId),
    /** 用户在节点上改了参数 / 换了模型（节点就是一镜要发什么的唯一来源）。 */
    editNode: (nodeId: string, edit: Partial<Pick<FakeNode, "prompt" | "modelKey" | "parameters">>) => {
      const node = nodes.get(nodeId);
      if (!node) throw new Error(`no node ${nodeId}`);
      nodes.set(nodeId, { ...node, ...edit, parameters: { ...node.parameters, ...(edit.parameters ?? {}) } });
    },
    /** 用户在节点上直接点 ↑（单节点提交：不经卡、不开同意）。 */
    nodeUp: (nodeId: string) => {
      const node = nodes.get(nodeId);
      if (!node) throw new Error(`no node ${nodeId}`);
      return submitNode(node, `rr-up-${node.nodeId}-${++recordSequence}`);
    },
  };
}

/** 夹具账本的变更订阅（生产里是 `subscribeProductionRunChanges`：仓库 execute 的事件旁路，每一条写入同步回调一次）。 */
type RunListener = (run: ProductionRun) => void;

export function spendWorld(options: SpendWorldOptions = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-spend-card-e2e-"));
  roots.push(root);
  const listeners = new Set<RunListener>();
  const repository = withEventTap(
    createProductionRunRepository({ projectDirResolver: (projectId) => (projectId === PROJECT_ID ? root : null), now }),
    (_events, run) => { for (const listener of [...listeners]) listener(run); },
  );
  const subscribe = (listener: RunListener) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const renderer = rendererDouble(options.validateNode);
  if (options.holdDispatch) renderer.holdDispatch();
  const canvas = setupCanvasShots({ root, repository, now, ...(options.canvasTransport ? { transport: options.canvasTransport } : {}), ...(options.previewBlock !== undefined ? { previewBlock: options.previewBlock } : {}) });
  renderer.attach(canvas);
  installCanvasShotRuns(canvas.runs);
  // 草稿账本的主人：生产同一个 Run 服务（找不到计划时抛的是带码的错，模型那一侧据它说「没有这个任务」）。
  const owner = createProductionRunService({ repository, projectRootResolver: () => root, previewSecret: "test", requestRenderer: renderer.requestRenderer });
  const canvasLanding = createCanvasLandingHost({
    readRun: (projectId, runId) => repository.read(projectId, runId),
    command: async (projectId, runId, command) => repository.execute(projectId, runId, command as Parameters<typeof repository.execute>[2]),
    requestRenderer: renderer.requestRenderer,
    resolveProjectRoot: () => root,
    isProjectOpen: () => true,
    ...(options.assets ? { resolveReferenceUrl: (projectId: string, reference: Parameters<typeof resolveIndexedReferencePreview>[1]) => resolveIndexedReferencePreview(projectId, reference, options.assets) } : {}),
  });
  const operations = createProductionGenerationOperationStore(owner, {
    onPlanChanged: (projectId, operationId) => canvasLanding.landDraftOnCanvas(projectId, operationId),
  }) as GenerationOperationStore;
  // 与 appIntegration 同一条订阅：Agent 那一次出价从哪条路关的，排队的交接都当场收回。
  subscribe((run) => withdrawQueuedHandOvers(run));
  const handOver = createCanvasHandOver({
    runs: { read: (projectId, runId) => repository.read(projectId, runId), execute: (projectId, runId, command) => repository.execute(projectId, runId, command) },
    landShots: canvasLanding.landBeforeDispatch,
    requestRenderer: renderer.requestRenderer,
    subscribe,
    now,
  });
  let projectOpen = true;
  const card = createPendingSpendActions({
    isProjectOpen: () => projectOpen,
    runs: { read: (projectId, runId) => repository.read(projectId, runId), list: (projectId) => repository.list(projectId) },
    operations,
    handOver: handOver.handOver,
    now,
  });
  const handler = createGenerationPlanningHandler({
    registry: options.registry ?? registry,
    operations,
    ...(options.videoModelCandidates ? { videoModelCandidates: options.videoModelCandidates } : {}),
    ...(options.assets ? { resolveAssetReferenceIdentity: options.assets.identity } : {}),
    resolveModelPricing: () => options.pricing,
    now,
    prepareAuthorization: async ({ lease: projectLease, operation, contract, multiShot }) => {
      const initialRun = repository.read(operation.projectId, operation.operationId);
      if (!initialRun) throw new Error("Generation authorization requires the current Run snapshot");
      const assertCurrent = createGenerationReferenceScopeGuard({
        lease: projectLease,
        operation,
        contract,
        ...(multiShot ? { multiShot } : {}),
        initialRun,
        readProject: () => ({ id: PROJECT_ID, immutableProjectUuid: "uuid-1", projectGeneration: 1 }),
        readRun: () => repository.read(operation.projectId, operation.operationId),
      });
      const resolveReferences = options.resolveReferences ?? (async (input) => resolveProductionReferenceUrls(input, {
        assets: options.assets ?? { list: () => [], identity: () => undefined },
        localize: async (_providerId, urls) => urls,
      }));
      return prepareProductionGenerationAuthorizationWithReferences({
        lease: projectLease,
        projectRevision: 0,
        operation,
        contract,
        ...(multiShot ? { multiShot } : {}),
        providers: [authorizationProvider],
        resolveShotPrice: () => options.pricing ? { known: true, amount: options.pricing.cost } : { known: false },
        run: initialRun,
        now: now(),
        assertCurrent,
      }, resolveReferences);
    },
  });
  const runFacts = residentRunFacts(owner);
  /** 模型那一侧真正用的传输（和常驻工厂同一份依赖：读写 Run 的三件来自 `residentRunFacts`，代答交给同一台画布交接）。 */
  const transport = (mode?: ProjectAgentApprovalPolicy["mode"]) => createPiGenerationTransportAdapter(
    { projectId: PROJECT_ID, immutableProjectUuid: "uuid-1", projectGeneration: 1 },
    {
      planning: handler,
      approvalReceiptAuthority: canvas.receipts,
      leaseFor: () => lease,
      ...(mode ? { approvalPolicy: () => ({ mode }) } : {}),
      ...runFacts,
      draftLanding: canvasLanding.draftLandingOutcome,
      handOverToCanvas: handOver,
    },
  );

  /** 卡此刻的样子（介入槽只出第一张）。 */
  const pending = (): PendingSpendConfirm | undefined => card.listPendingSpend(PROJECT_ID)[0];
  const identityOf = (shown: PendingSpendConfirm) => ({
    projectId: shown.projectId, operationId: shown.operationId, quoteId: shown.quoteId,
    ...(shown.presentationId ? { presentationId: shown.presentationId } : {}),
    ...(shown.presentationEpoch !== undefined ? { presentationEpoch: shown.presentationEpoch } : {}),
    planVersion: shown.planVersion,
  });
  /** 主按钮那一下递的镜：卡上还在等决定的（没决定的 + 确定没发出去的），也就是「生成」/「全部生成（N）」/「生成剩下 N 段」/「再试一次」。 */
  const remainingOn = (shown: PendingSpendConfirm) => shown.shots.filter((shot) => shot.offer === "undecided" || shot.offer === "not_sent").map((shot) => shot.shotId);

  return {
    root, repository, operations, canvasLanding, canvas, renderer, handOver, card, handler, transport, subscribe,
    vendor: canvas.vendor,
    receipts: canvas.receipts,
    pending,
    identityOf,
    remainingOn,
    setProjectOpen: (value: boolean) => { projectOpen = value; },
    /** 卡上点主按钮（`shown` 缺省 = 此刻那一张；`shotIds` 缺省 = 主按钮递的那一叠）。 */
    generate: (shotIds?: readonly string[], shown: PendingSpendConfirm | undefined = pending()) => {
      if (!shown) throw new Error("no card on screen");
      return card.handOverShots({ ...identityOf(shown), shotIds: shotIds ?? remainingOn(shown) });
    },
    cancel: (shown: PendingSpendConfirm | undefined = pending()) => {
      if (!shown) throw new Error("no card on screen");
      return card.discardPendingSpend(identityOf(shown));
    },
    remove: (shotId: string, shown: PendingSpendConfirm | undefined = pending()) => {
      if (!shown) throw new Error("no card on screen");
      return card.removeShot({ ...identityOf(shown), shotId });
    },
    restore: (shotId: string, shown: PendingSpendConfirm | undefined = pending()) => {
      if (!shown) throw new Error("no card on screen");
      return card.restoreShot({ ...identityOf(shown), shotId });
    },
    run: (operationId: string = OPERATION_ID) => repository.read(PROJECT_ID, operationId)!,
    /** 每一镜交到画布之后，供应商收到的那几份请求（`extras.productionShotId` 认是哪一镜）。 */
    sentShots: () => canvas.vendor.executes.map((entry) => String(entry.request.extras?.productionShotId ?? entry.request.extras?.nodeId)),
  };
}

export type SpendWorld = ReturnType<typeof spendWorld>;

/** 模型那一侧的一次调用（`tryExecute` 的入参形状）。 */
export async function callTool(transport: ReturnType<SpendWorld["transport"]>, toolName: string, args: Record<string, unknown>) {
  return transport.tryExecute({ toolCallId: `call-${toolName}-${clock}`, toolName, args }, new AbortController().signal);
}

/** Agent 在面板里建的那份单镜草稿（origin.host='nomi' 才会投影成面板上的付费卡；卡当场开着）。 */
export async function draft(world: SpendWorld, modelId = "img-model", parameters: Record<string, unknown> = { size: "1024x1024" }): Promise<void> {
  await world.operations.create({
    operationId: OPERATION_ID, projectId: PROJECT_ID, candidate: candidate(modelId, parameters),
    now: now(), origin: { host: "nomi", actorId: "agent-panel" },
  });
  await world.canvasLanding.settleCanvasLanding(PROJECT_ID);
}

export type DraftShot = Readonly<{ modelId?: string; parameters?: Record<string, unknown>; prompt?: string; references?: PlanCandidate["references"]; role?: "anchor" | "shot" }>;

/**
 * Agent 起草的几镜（`draft_shots`：落画布、不出卡），然后 `generate` 把它们摆到卡上。缺省 = 三张纸船图。
 * `shots` 给了就按它起草（任务 B：两段竖版视频 + 一段横版）。
 */
export async function shotsDraft(world: SpendWorld, shots: readonly DraftShot[] = [{}, {}, {}], present = true): Promise<void> {
  const drafted = shots.map((shot, offset) => {
    const index = offset + 1;
    const modelId = shot.modelId ?? "img-model";
    return {
      shotId: `shot-${index}`,
      role: shot.role ?? "shot",
      candidate: {
        ...candidate(modelId, shot.parameters ?? (modelId === "vid-model" ? { duration: 5, aspect_ratio: "16:9", resolution: "480p" } : { size: "1024x1024" }), shot.prompt ?? `第 ${index} 镜：纸船漂过水洼`),
        candidateId: `candidate-${index}`,
        references: shot.references ?? [],
      },
    };
  });
  await world.operations.create({ operationId: OPERATION_ID, projectId: PROJECT_ID, candidate: drafted[0].candidate, shots: drafted,
    cardHidden: true, origin: { host: "nomi", actorId: "agent-panel" }, now: now() });
  await world.canvasLanding.settleCanvasLanding(PROJECT_ID);
  if (present) await world.handler({ capability: "present", params: { operationId: OPERATION_ID }, lease });
}

/**
 * 回合那一侧怎么知道卡关了（生产里 = `laneDesktopSpend.whenCardCloses`）：同一个纯函数，看的是夹具账本。
 * `closed()` 在兑现后的那个微任务里变真，断言前 `await settleMicrotasks()`。
 */
export function watchCardForTurn(world: SpendWorld, options: { settlingGraceMs?: number; operationId?: string } = {}) {
  const operationId = options.operationId ?? OPERATION_ID;
  const read = () => world.repository.read(PROJECT_ID, operationId)?.generationPlan;
  const watch = watchSpendCardClose({
    read,
    subscribe: (listener) => world.subscribe(() => listener(read())),
    ...(options.settlingGraceMs !== undefined ? { settlingGraceMs: options.settlingGraceMs } : {}),
  });
  let closed = false;
  void watch.closed.then(() => { closed = true; });
  return { closed: () => closed, whenClosed: watch.closed, dispose: watch.dispose };
}

export async function settleMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

/** 一镜的手势收据：谁批的那一份（`decidedBy` / `humanActor`）。 */
export function receiptOfCanvasRun(world: SpendWorld, canvasRunId: string) {
  const approval = world.repository.readApprovals(PROJECT_ID, canvasRunId)[0];
  if (!approval?.receiptId) return undefined;
  return world.receipts.verifyReceipt(world.receipts.resolveReceiptToken(approval.receiptId));
}

export function resetSpendFixture() {
  installCanvasShotRuns(null);
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  clock = NOW_BASE;
}
export function advanceClock(milliseconds: number) { clock += milliseconds; }
export { PROJECT_ID, OPERATION_ID, CANDIDATE_ID, VENDOR, registry, lease, now, candidate };
