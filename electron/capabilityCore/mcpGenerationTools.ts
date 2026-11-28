import { refuseArgument } from "./transportFailure";
import { pinAssetReference } from "./semanticGenerationCandidate";
import { presentStoryboardAuthoring, patchStoryboardAuthoring, addShotsGuidance } from './mcpGenerationMultiShot';
import { createDocumentPlanAuthoring } from './generationDocumentPlan';
import { GenerationOperationNotFoundError } from '../productionRun/productionRunErrors';
import { generationTaskReference } from '../shared/agentCapabilities/taskReference';
import type { GenerationInvocationContext } from '../shared/agentCapabilities/generationInvocationContext';
import { shotsOnOffer } from "../shared/agentCapabilities/generationShotScope";
import crypto from "node:crypto";
import { hasMentions } from "../shared/storyboard/promptMentions";
import {
  compileExecutionContract,
  type PlanCandidate,
} from "./executionContract";
import {
  deriveShotPrice,
  type ShotPrice,
} from "../productionRun/shotPricing";
import {
  createMultiShotCreateHelpers,
  resolveGateScope,
  type GenerationOperationDraftShot,
} from "./mcpGenerationMultiShot";
import {
  candidatesForCurrentVideoModel,
  normalizeVideoCandidate,
  videoCompileOptions,
  videoRecommendationInput,
} from "./mcpGenerationVideoResolve";
import type { GenerationCallCatalog, GenerationCatalogSource } from "./liveGenerationRuntime";
import type { ProjectLeaseV2 } from "./projectLease";
import type { CatalogOwned, GenerationPlanningAuthorizationInput, GenerationPlanningCallDependenciesOf, GenerationPlanningCoreDependencies } from "./generationPlanningDependencies";
import type { ProjectAgentApprovalPolicy } from "../shared/agentCapabilities/capabilityApprovalPolicy";
import { GenerationProviderCapabilityError } from "./generationRuntimeAdapter";
import { resolveGenerationPlan } from "../shared/videoCapabilities/planResolver";
import { generationResolveInputSchema } from "../shared/agentCapabilities/generation";
import { executeCanvasPlanPatchBatch, normalizeStoredDraft } from "./generationPlanPatch";
import { declaredDefaultDeviations } from "./semanticGenerationCandidate";
import { buildCreatedDraftReceipt, createDraftAdmission } from "./generationDraftAdmission";
import type { DraftParameterAdjustment } from "./generationAuthoredDuration";
import type { ResolvedModelName } from "../shared/agentCapabilities/modelHandle";
import { projectGenerationOperationPreview } from "./mcpGenerationPreview";
import { generationCandidateSchema } from "../shared/agentCapabilities/generationPlanSchemas";
import { resolveProviderReadiness } from "./mcpGenerationProviderReadiness";
import {
  buildMultiShotGateProjectionFor,
  buildMultiShotGateReceipt,
  buildSingleShotGateReceipt,
  coldstartEtaForGate,
  gateRowsFor,
  handleContextQuery,
  handleReadOperation,
  readinessReceiptFields,
} from "./generationGateProjections";

export { coldstartEtaForGate, gateRowsFor };

/**
 * The semantic MCP surface is deliberately data-only.  These tools are the
 * same vocabulary a GUI adapter uses; neither the catalog nor this handler
 * knows a vendor-specific parameter or calls a provider.
 *
 * 面收敛（surface-16-collapse）：generation-operation 的 8 步 CRUD + get_context 塌成 5 个贴生命周期的工具。
 * get_context 收进 nomi_read（target=generation_context）不在此。收敛只在 catalog 层：build 按 phase/action 分派
 * 到**原 method 字面量**（能力核 handler 的 capability 分支逐字不动，付费 seam 一行不碰）；多态工具带
 * resolveMethod(args)→内部路由键（SEMANTIC_GENERATION_ROUTES 据此选 capability）。
 */

export type { GenerationOperationDraftShot, GenerationSealMultiShot, StoryboardShotDraft, StoryboardPlanResult } from "./mcpGenerationMultiShot";
export type { GenerationOperationState, GenerationOperationShot, GenerationOperation, GenerationAuthorizationPreparation, GenerationOperationStore } from "./generationOperationTypes";
import type { GenerationAuthorizationPreparation, GenerationOperation } from "./generationOperationTypes";

type ReconcileOutcome = Parameters<NonNullable<GenerationPlanningHandlerDependencies["reconcile"]>>[1];

/** 规划逻辑在**一次调用之内**用的全部依赖：目录那几样已经是这次调用入口取的那一版。 */
export type GenerationPlanningCallDependencies = GenerationPlanningCallDependenciesOf<ReconcileOutcome>;

/**
 * 装配规划逻辑要交的东西。目录只有一个入口 `catalog`：每次工具调用在入口 `openCall()` 取一版，
 * 规划读它，宿主在调用里做的三件事（准备授权 / 开拍 / 核对）也在最后一个参数上收到同一版——
 * 没有「不带这一版也能调」的写法，所以不存在调用里悄悄读到另一版目录的路。
 */
export type GenerationPlanningHandlerDependencies<Call extends GenerationCallCatalog = GenerationCallCatalog> =
  Omit<GenerationPlanningCoreDependencies, CatalogOwned> & {
    catalog: GenerationCatalogSource<Call>;
    prepareAuthorization?: (input: GenerationPlanningAuthorizationInput, catalog: Call) => GenerationAuthorizationPreparation | Promise<GenerationAuthorizationPreparation>;
    start?: (operation: GenerationOperation, lease: ProjectLeaseV2, catalog: Call) => unknown | Promise<unknown>;
    reconcile?: (operation: GenerationOperation, outcome: "found" | "not_found", lease: ProjectLeaseV2, catalog: Call) => unknown | Promise<unknown>;
  };

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuseArgument(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function candidateFrom(value: unknown): PlanCandidate {
  return generationCandidateSchema.parse(value);
}

type DocumentPlansAuthoring = ReturnType<typeof createDocumentPlanAuthoring>;
type PlanningInput = Parameters<GenerationPlanningHandler>[0];
type MultiShotHelpers = ReturnType<typeof createMultiShotCreateHelpers>;
type DraftAdmissionHelpers = ReturnType<typeof createDraftAdmission>;

type PlanningCallContext = {
  deps: GenerationPlanningCallDependencies;
  documentPlans: DocumentPlansAuthoring;
  now: () => string;
  priceForCandidate: (candidate: PlanCandidate) => ShotPrice;
  contractFor: (candidate: PlanCandidate, projectId: string) => ReturnType<typeof compileExecutionContract>;
  resolvePatchReferences: (projectId: string, value: unknown) => PlanCandidate["references"];
  extendedReceipt: (
    operation: GenerationOperation,
    shots: readonly GenerationOperationDraftShot[],
    names: { modelNamesResolved?: readonly ResolvedModelName[]; adjustments?: readonly DraftParameterAdjustment[] },
    note?: string,
  ) => Promise<Record<string, unknown>>;
  sealMultiShotFor: MultiShotHelpers["sealMultiShotFor"];
  admitDraftShots: DraftAdmissionHelpers["admitDraftShots"];
  admitSingleCandidate: DraftAdmissionHelpers["admitSingleCandidate"];
};

/**
 * 一份候选 → 一份执行合同。**全仓唯一的编译口**（preview / gate_request / 多镜密封都走它）。
 *
 * 两件投影必须在同一处发生，否则「报价看到的」和「密封发出去的」会是两份东西：
 *  · 参数表投影（视频候选按档案模式的控件声明，其余按目录派生的线缆声明）；
 *  · 提示词投影（`@[asset:url]` → `@image1`，规则住共享层，与手动画布那条路同一份）。
 * 提示词里没有 @ 标记时不去解析素材（绝大多数镜头，逐字节不变）；有标记却解析不出源地址 → 报错，
 * 不是原样发出去。
 */
function compileCandidateContract(
  deps: GenerationPlanningCallDependencies,
  candidate: PlanCandidate,
  projectId: string,
) {
  const referenceSourceUrls = hasMentions(candidate.prompt) && deps.resolveStoryboardReferenceUrl
    ? candidate.references.map((reference) => deps.resolveStoryboardReferenceUrl!(projectId, reference))
    : undefined;
  return compileExecutionContract(candidate, deps.registry, {
    ...videoCompileOptions(candidate, deps.videoModelCandidates),
    ...(referenceSourceUrls ? { referenceSourceUrls } : {}),
  });
}

/** patch 入口的参考素材身份补齐。与 create 那条同一个解析器，只是调用点不同。 */
function resolvePatchReferencesFor(
  deps: GenerationPlanningCallDependencies,
  projectId: string,
  value: unknown,
): PlanCandidate["references"] {
  if (!Array.isArray(value)) refuseArgument("references must be an array of asset ids.");
  const resolve = deps.resolveAssetReferenceIdentity;
  return generationCandidateSchema.shape.references.parse(
    value.map((item) => pinAssetReference(item, resolve ? (assetId: string) => resolve(projectId, assetId) : undefined)),
  ) as PlanCandidate["references"];
}

function resolvePlanAdvisory(deps: GenerationPlanningCallDependencies, params: Record<string, unknown>): unknown {
  // Generation Strategy Resolver — stateless advisory pass (no durable
  // operation, no seal, no gate): validate/clamp every shot's model/mode/
  // params against real capability facts and propose merge/split/duration
  // structure before any plan is formed (2026-09-06 planResolver).
  //
  // Input parsing is the capability contract's zod schema, not a hand-rolled
  // coercion loop: GUI narrow IPC and the agent/MCP face must accept exactly
  // the same inputs, and there is one place that says what those are
  // (GENERATION_RESOLVE_CAPABILITY.inputSchema — rebuild plan §1.2 K1).
  const parsed = generationResolveInputSchema.safeParse(params);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path?.length ? ` at ${first.path.join(".")}` : "";
    throw Object.assign(new Error(`resolve input is invalid${where}: ${first?.message ?? "unknown"}`), { code: "generation_input_invalid" });
  }
  const planResolution = resolveGenerationPlan({
    // 不再 `as PlanShotInput[]`：schema 与类型逐键对账（generation.ts），这里让编译器再核一遍值能赋过去。
    shots: parsed.data.shots,
    candidates: deps.videoModelCandidates ?? [],
    ...(parsed.data.goals ? { goals: parsed.data.goals } : {}),
  });
  return {
    resolvedShots: planResolution.shots.map((shot) => ({
      id: shot.id,
      modelKey: shot.candidate?.modelKey ?? null,
      modeId: shot.modeId,
      modeLabel: shot.modeLabel,
      durationMin: shot.durationMin,
      durationMax: shot.durationMax,
      params: shot.params,
      issues: shot.issues,
    })),
    mergeProposals: planResolution.mergeProposals,
    splitProposals: planResolution.splitProposals,
    planIssues: planResolution.issues,
    nextAction: "create",
  };
}

async function createMultiShotDraftOperation(
  ctx: PlanningCallContext,
  input: PlanningInput,
  lease: ProjectLeaseV2,
  operationId: string,
  normalizedShots: readonly GenerationOperationDraftShot[],
  namesReceipt: { modelNamesResolved?: readonly ResolvedModelName[]; adjustments?: readonly DraftParameterAdjustment[] },
): Promise<unknown> {
  const { params } = input;
  // 顶层 candidate = 第一个 shot 的 candidate (reducer seal 硬要顶层 contract 匹配顶层 draft candidate,
  // productionRunReducer.ts generation.seal). 与 S4 e2e setup 同构 (top = shots[0]).
  const operation = await ctx.deps.operations.create({
    operationId,
    projectId: lease.projectId,
    candidate: normalizedShots[0].candidate,
    shots: normalizedShots,
    now: ctx.now(),
    origin: input.origin,
    ...(params.cardHidden === true ? { cardHidden: true } : {}),
    ...(input.approvalPolicy ? { policySnapshot: input.approvalPolicy } : {}),
  });
  const savedPlan = await ctx.documentPlans.saveDocumentPlan(lease.projectId, input.origin?.sourceDocument, operation.operationId, normalizedShots, input.storyboardTarget);
  const authored = Array.isArray(params.shots) ? params.shots : undefined;
  return buildCreatedDraftReceipt({
    operation,
    savedPlan,
    namesReceipt,
    deviations: authored ? declaredDefaultDeviations(normalizedShots.map((shot, i) => ({ shotId: shot.shotId, params: (authored[i] ?? {}) as Record<string, unknown>, candidate: shot.candidate })), ctx.deps.defaultModelForTaskKind, input.modelNames) : [],
    anchorsOnly: normalizedShots.every((shot) => shot.role === "anchor"),
  });
}

async function createSingleShotDraftOperation(
  ctx: PlanningCallContext,
  input: PlanningInput,
  lease: ProjectLeaseV2,
  operationId: string,
  noteName: (entry: ResolvedModelName) => void,
  noteAdjustment: (entry: DraftParameterAdjustment) => void,
  namesReceipt: () => { modelNamesResolved?: readonly ResolvedModelName[]; adjustments?: readonly DraftParameterAdjustment[] },
): Promise<unknown> {
  const { params } = input;
  const normalizedSingle = ctx.admitSingleCandidate(lease.projectId, operationId, params, ctx.deps.registry, noteName, noteAdjustment);
  const operation = await ctx.deps.operations.create({
    operationId,
    projectId: lease.projectId,
    candidate: normalizedSingle,
    now: ctx.now(),
    origin: input.origin,
    ...(params.cardHidden === true ? { cardHidden: true } : {}),
    ...(input.approvalPolicy ? { policySnapshot: input.approvalPolicy } : {}),
  });
  const savedSingle = await ctx.documentPlans.saveDocumentPlan(
    lease.projectId,
    input.origin?.sourceDocument,
    operation.operationId,
    [{ shotId: normalizedSingle.candidateId, candidate: normalizedSingle, storyboard: params.storyboard as GenerationOperationDraftShot["storyboard"] }],
    input.storyboardTarget,
  );
  return buildCreatedDraftReceipt({
    operation,
    savedPlan: savedSingle,
    namesReceipt: namesReceipt(),
    deviations: declaredDefaultDeviations([{ params, candidate: normalizedSingle }], ctx.deps.defaultModelForTaskKind, input.modelNames),
  });
}

async function handleCreateOperation(
  ctx: PlanningCallContext,
  input: PlanningInput,
  lease: ProjectLeaseV2,
  operationId: string,
): Promise<unknown> {
  const { params } = input;
  // 这一次调用的目录在入口已经取定（`catalog.openCall()`），所有镜头都按这一版解析。
  const draftRegistry = ctx.deps.registry;
  // 点名的模型不是一字不差落下的（大小写 / 别名 / 同名多家按默认落）：每认一次记一条，回执里原样交给助手——
  // 与 lane draft_shots 的 modelNamesResolved 同一个形状，由同一个名字主人给（resolvedModelNameOf）。
  const resolvedNames: ResolvedModelName[] = [];
  const adjustments: DraftParameterAdjustment[] = [];
  const noteName = (entry: ResolvedModelName) => { resolvedNames.push(entry); };
  const noteAdjustment = (entry: DraftParameterAdjustment) => { adjustments.push(entry); };
  const namesReceipt = () => ({
    ...(resolvedNames.length ? { modelNamesResolved: [...resolvedNames] } : {}),
    ...(adjustments.length ? { adjustments: [...adjustments] } : {}),
  });
  // P4 S6.5 生产入口: a multi-shot draft is created from `shots` (client gives每镜 plan) or `scriptText`
  // (storyboard planner 拟稿). Both land the same durable draft.shots that S1 patch/preview address and
  // gate_request seals. Neither `shots` nor `scriptText` → single-shot (today, byte-identical).
  const normalizedShots = await ctx.admitDraftShots(lease.projectId, params, draftRegistry, noteName, [], noteAdjustment);
  // 一次请求一份方案（D5，宿主保证）：这一请求已经起草过文稿方案，这次又不带 operationId——补到那一份上。
  const sameRequestPlan = ctx.documentPlans.planToExtend(lease.projectId, input.origin?.sourceDocument, input.storyboardTarget, params.newPlan === true);
  const requestPlan = sameRequestPlan ? await ctx.deps.operations.read(lease.projectId, sameRequestPlan) : undefined;
  if (requestPlan?.sourceDocumentId === input.origin?.sourceDocument?.documentId && requestPlan?.sourceDocumentId) {
    const shots = normalizedShots ?? [{
      shotId: "shot-1",
      candidate: ctx.admitSingleCandidate(lease.projectId, operationId, params, draftRegistry, noteName, noteAdjustment),
      ...(params.storyboard ? { storyboard: params.storyboard as GenerationOperationDraftShot["storyboard"] } : {}),
    }];
    return ctx.extendedReceipt(requestPlan, shots, namesReceipt(), `Added to plan ${requestPlan.operationId}, which this request already drafted, instead of starting a second plan. ${addShotsGuidance(requestPlan.operationId)}`);
  }
  if (normalizedShots) {
    return createMultiShotDraftOperation(ctx, input, lease, operationId, normalizedShots, namesReceipt());
  }
  return createSingleShotDraftOperation(ctx, input, lease, operationId, noteName, noteAdjustment, namesReceipt);
}

async function handleExtendOperation(
  ctx: PlanningCallContext,
  current: GenerationOperation,
  lease: ProjectLeaseV2,
  params: Record<string, unknown>,
): Promise<unknown> {
  // 在一份已有的文稿方案后面补镜头 / 参考卡（「再加两镜」）。只有文稿方案有「补」：画布草稿改一镜带 shotId，另起一份不带 operationId。
  if (!current.sourceDocumentId) refuseArgument("Adding shots works on a storyboard plan saved on a document. This is a canvas draft: change one of its shots with its shotId, or start a new draft without operationId.");
  const resolvedNames: ResolvedModelName[] = [];
  const adjustments: DraftParameterAdjustment[] = [];
  const shots = await ctx.admitDraftShots(
    lease.projectId,
    { shots: params.shots },
    ctx.deps.registry,
    (entry) => { resolvedNames.push(entry); },
    current.shots ?? [],
    (entry) => { adjustments.push(entry); },
  );
  if (!shots) refuseArgument("Adding to a plan needs the new shots.");
  return ctx.extendedReceipt(current, shots, {
    ...(resolvedNames.length ? { modelNamesResolved: resolvedNames } : {}),
    ...(adjustments.length ? { adjustments } : {}),
  });
}

async function handlePresentOperation(
  ctx: PlanningCallContext,
  current: GenerationOperation,
  input: PlanningInput,
  lease: ProjectLeaseV2,
  operationId: string,
): Promise<unknown> {
  if (current.sourceDocumentId) return presentStoryboardAuthoring(current, lease.projectId, operationId, input.params.shotIds, ctx.deps.requestRendererDecision);
  // `generate` 动词：把草稿摆到用户面前。草稿一字不动，只让报价卡可投影；点头/花钱仍是用户在卡上的动作。
  // The durable owner validates lifecycle and preserves prior execution evidence.
  // 2026-09-22 上午这里有一条「被 × 过的 operationId 不许再 present」的拒绝。当天下午用户改窄了裁决 D：
  // × 收回的是**这一次出价**，不是那份计划——对同一份草稿再 `generate` 就是重新出价，必须放行。
  // 2026-10-27：`shotIds` 原样交给 Run 主人，摆哪几镜只在 `presentGenerationPlan` 按出价账算（不点名 = 最近一张卡上还没定的，
  // 一镜不剩就拒）；这里不预解析。回执的 `shots` 就是这一次出价摆的镜。
  const operation = await ctx.deps.operations.present(lease.projectId, operationId, ctx.now(), input.params.shotIds, input.storyboardTarget, input.approvalPolicy);
  const shots = shotsOnOffer(operation);
  return { operation, taskRef: generationTaskReference(operation.operationId), shots, nextAction: "await_user" };
}

async function handlePlanPatchOperation(
  ctx: PlanningCallContext,
  current: GenerationOperation,
  input: PlanningInput,
  lease: ProjectLeaseV2,
  operationId: string,
): Promise<unknown> {
  const { params } = input;
  if (current.sourceDocumentId) {
    await patchStoryboardAuthoring(current, params, lease.projectId, operationId, ctx.resolvePatchReferences, ctx.deps.resolveStoryboardReferenceUrl, ctx.deps.requestRenderer);
    return { operation: current, taskRef: generationTaskReference(operationId), nextAction: "preview" };
  }
  return executeCanvasPlanPatchBatch({
    current,
    params,
    projectId: lease.projectId,
    operationId,
    now: ctx.now,
    registry: ctx.deps.registry,
    videoModelCandidates: ctx.deps.videoModelCandidates,
    defaultModelForTaskKind: ctx.deps.defaultModelForTaskKind,
    resolvePatchReferences: ctx.resolvePatchReferences,
    applyPatch: (patch, now, shotId) => ctx.deps.operations.patch(lease.projectId, operationId, patch, now, shotId, input.storyboardTarget),
  });
}

function handlePreviewOperation(
  ctx: PlanningCallContext,
  current: GenerationOperation,
  lease: ProjectLeaseV2,
  operationId: string,
  storedLeftovers: readonly unknown[],
): unknown {
  if (current.sourceDocumentId) return { operation: current, taskRef: generationTaskReference(operationId), nextAction: "present" };
  const candidate = normalizeVideoCandidate(current.candidate, ctx.deps.videoModelCandidates);
  const contract = ctx.contractFor(candidate, lease.projectId);
  const readiness = resolveProviderReadiness(ctx.deps, candidate);
  const resolved = ctx.deps.registry.resolve({
    moduleId: candidate.moduleId,
    providerId: candidate.providerId,
    modelId: candidate.modelId,
    mode: candidate.mode,
  });
  const recommendationInput = resolved.outputKinds.includes("video") ? videoRecommendationInput(candidate) : null;
  const recommendation = recommendationInput && ctx.deps.recommendVideoGeneration && ctx.deps.videoModelCandidates
    ? ctx.deps.recommendVideoGeneration(recommendationInput, candidatesForCurrentVideoModel(candidate, ctx.deps.videoModelCandidates))
    : undefined;
  // P4 S2: this is a pure, provider-free projection; multi-shot plans use
  // every included video row and single-shot keeps the legacy one-row shape.
  const projection = projectGenerationOperationPreview(current, candidate, ctx.deps);
  return {
    operationId,
    candidateRevision: current.candidate.revision,
    contract,
    ...(storedLeftovers.length ? { clearedParameters: storedLeftovers } : {}),
    ...(recommendation ? { recommendation } : {}),
    pricing: projection,
    ...readinessReceiptFields(readiness),
    // Keep the established action vocabulary for renderer/MCP clients;
    // an unknown price remains visible in `pricing.total`，门照开、卡上如实写「价格未知」。
    ...(readiness.providerReady ? { nextAction: "request_gate" } : { nextAction: "provider_configure" }),
  };
}

async function handleGateRequestOperation(
  ctx: PlanningCallContext,
  current: GenerationOperation,
  lease: ProjectLeaseV2,
  operationId: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  if (current.sourceDocumentId) refuseArgument("This draft came from a storyboard; use the original storyboard confirmation instead of requesting a gate here.");
  // 逐镜（2026-09-30）：这一次封哪几镜——点到的那几镜；不点名 = 最近一张卡上还没定、也还没封的（2026-10-27，一镜不剩就拒）。
  // 一次没点完、盖着别的镜的那份等人授权先撤掉（只解封它盖着的镜），再按这一次的范围封（`resolveGateScope`）。
  let base = current;
  let decision = resolveGateScope(base, params.shotIds);
  if (decision.kind === "abandon-then-seal") {
    if (!ctx.deps.operations.abandonWaitingAuthorization) throw Object.assign(new Error("generation_scope_invalid"), { code: "generation_scope_invalid" });
    base = await ctx.deps.operations.abandonWaitingAuthorization(lease.projectId, operationId, ctx.now()) as typeof current;
    decision = resolveGateScope(base, params.shotIds);
  }
  const needsSeal = decision.kind === "seal";
  const scope = decision.kind === "abandon-then-seal" ? undefined : decision.scope;
  const candidate = normalizeVideoCandidate(base.candidate, ctx.deps.videoModelCandidates);
  // 已经在跑的计划再封一镜：顶层那份合同在第一次封印时就冻住了，原样沿用（封过的候选不许再编译一遍）。
  const contract = base.contract && base.candidate.sealedContractHash === base.contract.contractHash
    ? base.contract
    : ctx.contractFor(candidate, lease.projectId);
  const readiness = resolveProviderReadiness(ctx.deps, candidate);
  if (!readiness.providerReady) throw new GenerationProviderCapabilityError(contract.providerId, readiness.missingForSubmit.length ? readiness.missingForSubmit : ["configured_provider"]);
  const gateResolved = ctx.deps.registry.resolve({ moduleId: candidate.moduleId, providerId: candidate.providerId, modelId: candidate.modelId, mode: candidate.mode }); // J06
  // Seal compiled execution facts; raw editor candidates remain owned by the draft.
  // P4 S6.5: a multi-shot draft seals its per-shot sub-contracts + planHash (built from the draft
  // shots) alongside the top-level contract. `sealMultiShotFor` compiles each included shot's contract
  // and the plan hash; the store forwards them to the reducer (which freezes the batch + hard cap). A
  // single-shot draft passes no bundle (byte-identical to today). Top contract = shots[0]'s contract
  // (顶层 candidate = shots[0].candidate), so the reducer's top-level match holds.
  const multiShotSeal = needsSeal && scope ? ctx.sealMultiShotFor(base, lease.projectId, scope) : undefined;
  // 2026-09-21：这里从前逐镜 `assertKnownShotPrice`，价格算不出就整批拒绝
  // （`generation_pricing_unknown`）。用户拍板删掉：内置 204 个模型一条 pricing 都没有，
  // 这条拒绝等于「我们没建价格标尺 → 你不准干活」。要防的「未知被当成 0 元」由授权信封的
  // 类型守（`price.maximum: number | null` + `budget.unknownJobCount`），不靠拒绝生成来防。
  const price = ctx.priceForCandidate(candidate);
  const authorization = needsSeal && ctx.deps.prepareAuthorization
    ? await ctx.deps.prepareAuthorization({ lease, operation: base, contract, ...(multiShotSeal ? { multiShot: multiShotSeal } : {}) })
    : undefined;
  const sealed = needsSeal
    ? await ctx.deps.operations.seal(lease.projectId, operationId, contract, ctx.now(), multiShotSeal, authorization)
    : base;
  // P4 S2: the receipt's cost ceiling is the known derived price. 价格算不出 → `null`，
  // 卡上走「暂时算不出价格」那一档；**永远不是 ¥0**。
  const expiresAt = new Date(Date.parse(ctx.now()) + 10 * 60 * 1000).toISOString();
  // P4 S4: for a multi-shot operation, build the real display.shots (the S3a card's data) and use the
  // PLAN-LEVEL cost as the receipt ceiling. A single-shot op omits `shots` → flat card, unchanged.
  const multiShot = buildMultiShotGateProjectionFor(ctx.deps, ctx.priceForCandidate, sealed, scope);
  if (multiShot) {
    return buildMultiShotGateReceipt({ sealed, operationId, projectId: lease.projectId, contract, multiShotSeal, multiShot, outputKinds: gateResolved.outputKinds, expiresAt, readiness });
  }
  return buildSingleShotGateReceipt({ sealed, operationId, projectId: lease.projectId, contract, price, expiresAt, readiness });
}

function handleStartOperation(
  deps: GenerationPlanningCallDependencies,
  current: GenerationOperation,
  lease: ProjectLeaseV2,
  operationId: string,
): unknown {
  // The Host gate adapter starts immediately after the verified receipt is
  // committed. A model may still issue its explicit start tool on the next
  // turn; treat that replay as an observation instead of attempting a
  // second provider submission.
  // 单镜只发一次：已提交就是观察。多镜每点一次批一份（2026-09-30 逐镜）：已在跑的计划又批了一镜，要再推一下调度器——
  // 它只派有任务、批过的镜，同一镜不会派两次，所以重放也只是观察。
  if (current.state === "submitted" && !current.shots?.length) return { operation: current, taskRef: generationTaskReference(operationId), operationId, nextAction: "observe" };
  if ((current.state !== "sealed" && current.state !== "submitted") || !current.contract || current.authorization?.status !== "approved") refuseArgument("Confirm the generation plan before starting: the user has not approved this draft yet.");
  return deps.start?.(current, lease) ?? { operationId, state: current.state, nextAction: "provider_not_configured" };
}

async function dispatchStoredOperationCapability(
  ctx: PlanningCallContext,
  input: PlanningInput,
  lease: ProjectLeaseV2,
  operationId: string,
  current: GenerationOperation,
  storedLeftovers: readonly unknown[],
): Promise<unknown> {
  const { params } = input;
  switch (input.capability) {
    case "extend":
      return handleExtendOperation(ctx, current, lease, params);
    case "present":
      return handlePresentOperation(ctx, current, input, lease, operationId);
    case "plan":
      return handlePlanPatchOperation(ctx, current, input, lease, operationId);
    case "preview":
      return handlePreviewOperation(ctx, current, lease, operationId, storedLeftovers);
    case "gate_request":
      return handleGateRequestOperation(ctx, current, lease, operationId, params);
    case "gate_decide":
      throw new Error("Generation gate decisions must use the Run-owned authorization seam");
    case "start":
      return handleStartOperation(ctx.deps, current, lease, operationId);
    case "withdraw": {
      // 宿主内部用（不在任何模型可见的方法表里）：问这句话的那个回合没了 → 收回这一次出价，计划留着。
      if (current.sourceDocumentId) return { operation: current, taskRef: generationTaskReference(operationId), nextAction: "present" };
      const reason = params.reason === "user_wrote" || params.reason === "stopped" ? params.reason : "user_closed";
      return { operation: await ctx.deps.operations.withdraw(lease.projectId, operationId, ctx.now(), reason), taskRef: generationTaskReference(operationId), nextAction: "present" };
    }
    case "cancel":
      return { operation: await ctx.deps.operations.cancel(lease.projectId, operationId, ctx.now()), nextAction: "create" };
    case "reconcile": {
      const outcome = params.outcome === "found" || params.outcome === "not_found" ? params.outcome : null;
      if (!outcome) refuseArgument("Reconciliation needs an outcome: pass \"found\" or \"not_found\".");
      return ctx.deps.reconcile?.(current, outcome, lease) ?? { operationId, outcome, nextAction: outcome === "found" ? "observe" : "manual_review" };
    }
    case "read":
    case "events":
    case "steer":
      return handleReadOperation(ctx.deps, current, lease, operationId);
    default:
      throw new Error(`Unsupported semantic generation capability: ${input.capability}`);
  }
}

/**
 * 一次调用的规划逻辑。这里面不许放跨调用要记住的状态——每次调用都重新绑一遍；
 * 要记的（同一请求起草出的方案）由外面建好传进来。
 */
function planningForCall(deps: GenerationPlanningCallDependencies, documentPlans: DocumentPlansAuthoring) {
  const now = deps.now ?? (() => new Date().toISOString());
  // P4 S2: derive a candidate's real per-shot price from the catalog pricing. Unknown (never a
  // fabricated 0) when there is no resolver, no pricing row, disabled pricing, or no base cost.
  const priceForCandidate = (candidate: PlanCandidate): ShotPrice =>
    deriveShotPrice({ candidate, resolvePricing: (providerId, modelId) => deps.resolveModelPricing?.(providerId, modelId) });
  const contractFor = (candidate: PlanCandidate, projectId: string) => compileCandidateContract(deps, candidate, projectId);
  const resolvePatchReferences = (projectId: string, value: unknown) => resolvePatchReferencesFor(deps, projectId, value);
  /** 补进一份文稿方案后的回执：草稿还是那份（id 不变），补上的行与它们的 id 在 `storyboardExtended` 里。 */
  const extendedReceipt = async (operation: GenerationOperation, shots: readonly GenerationOperationDraftShot[], names: { modelNamesResolved?: readonly ResolvedModelName[] }, note?: string) => {
    const storyboardExtended = await documentPlans.extendDocumentPlan(operation.projectId, operation.sourceDocumentId!, operation.operationId, shots);
    return { operation, taskRef: generationTaskReference(operation.operationId), nextAction: "preview", storyboardExtended, ...names, ...(note ? { note } : {}) };
  };
  // P4 S6.5 生产入口: the multi-shot create/seal helpers (resolveCreateShots + sealMultiShotFor) live in
  // mcpGenerationMultiShot.ts; wire them with this handler's shared derivations (all single source of truth).
  const { resolveCreateShots, sealMultiShotFor } = createMultiShotCreateHelpers({
    registry: deps.registry,
    ...(deps.planStoryboard ? { planStoryboard: deps.planStoryboard } : {}),
    parsers: { candidateFrom, record },
    normalizeVideoCandidate: (candidate) => normalizeVideoCandidate(candidate, deps.videoModelCandidates),
    compileContract: contractFor,
    priceForCandidate,
    ...(deps.defaultModelForTaskKind ? { defaultModelForTaskKind: deps.defaultModelForTaskKind } : {}),
    ...(deps.assertReferencesResolvable ? { assertReferencesResolvable: deps.assertReferencesResolvable } : {}),
    ...(deps.resolveAssetReferenceIdentity ? { resolveAssetReferenceIdentity: deps.resolveAssetReferenceIdentity } : {}),
  });
  /** 起草准入（多镜 / 补镜 / 单镜同一套：合成 → 归一 → 身份 → 参数值），住 `generationDraftAdmission.ts`。 */
  const { admitDraftShots, admitSingleCandidate } = createDraftAdmission({ ...deps, candidateFrom, resolveCreateShots });
  const ctx: PlanningCallContext = {
    deps, documentPlans, now, priceForCandidate, contractFor, resolvePatchReferences, extendedReceipt, sealMultiShotFor, admitDraftShots, admitSingleCandidate,
  };

  return async (input: PlanningInput): Promise<unknown> => {
    // resolve = stateless advisory pass（generation strategy resolver）：纯计算、不落 durable
    // operation、不触生成，本就不需要项目租赁凭证（GUI 窄 IPC 也是无 lease 进来）→ 提前返回。
    // 其余 capability（context/create/preview/gate_*/start…）一律要求已核验 lease。
    if (input.capability === "resolve") return resolvePlanAdvisory(deps, input.params);
    if (!input.lease) throw new Error("A verified project lease is required");
    if (input.capability === "context") return handleContextQuery(deps, input.lease);
    const operationId = typeof input.params.operationId === "string" && input.params.operationId.trim()
      ? input.params.operationId.trim()
      : `op-${crypto.randomUUID()}`;
    if (input.capability === "create") return handleCreateOperation(ctx, input, input.lease, operationId);
    const stored = await deps.operations.read(input.lease.projectId, operationId);
    if (!stored) throw new GenerationOperationNotFoundError();
    // 读盘归一（**唯一**的存量残留清理点）：所有 capability 都经这里，所以读出来的就是干净的、
    // 而且已落盘。逐入口补会漏——上一轮就漏在 gate_request 上（预览看得见、点确认时炸）。
    const normalizedDraft = await normalizeStoredDraft({
      operation: stored,
      projectId: input.lease.projectId,
      operationId,
      now: now(),
      registry: deps.registry,
      videoModelCandidates: deps.videoModelCandidates,
      patch: (projectId, id, patch, at, shotId) => deps.operations.patch(projectId, id, patch, at, shotId),
    });
    return dispatchStoredOperationCapability(ctx, input, input.lease, operationId, normalizedDraft.operation as typeof stored, normalizedDraft.clearedParameters);
  };
}

export function createGenerationPlanningHandler<Call extends GenerationCallCatalog>(deps: GenerationPlanningHandlerDependencies<Call>) {
  const { catalog, prepareAuthorization, start, reconcile, ...shared } = deps;
  // 跨调用要记住的只有这一样（同一请求先后两次起草，补在同一份方案上）。
  const documentPlans = createDocumentPlanAuthoring({
    ...(shared.requestRenderer ? { requestRenderer: shared.requestRenderer } : {}),
    ...(shared.resolveStoryboardReferenceUrl ? { resolveStoryboardReferenceUrl: shared.resolveStoryboardReferenceUrl } : {}),
  });
  return (input: Parameters<GenerationPlanningHandler>[0]): Promise<unknown> => {
    // 这次调用的那一版目录：只在这里取一次，往下全是传值。
    const call = catalog.openCall();
    const inCall: Pick<GenerationPlanningCallDependencies, "prepareAuthorization" | "start" | "reconcile"> = {};
    if (prepareAuthorization) inCall.prepareAuthorization = (prepare) => prepareAuthorization(prepare, call);
    if (start) inCall.start = (operation, lease) => start(operation, lease, call);
    if (reconcile) inCall.reconcile = (operation, outcome, lease) => reconcile(operation, outcome, lease, call);
    return planningForCall({
      ...shared,
      registry: call.registry,
      providerReadiness: call.providerReadiness,
      resolveModelPricing: call.resolveModelPricing,
      defaultModelForTaskKind: call.defaultModelForTaskKind,
      get videoModelCandidates() { return call.videoModelCandidates; },
      ...inCall,
    }, documentPlans)(input);
  };
}

/** 已装配的 planning seam 可调用面（agent/MCP 与 GUI 窄 IPC 共用同一实例 → 候选集/决策天然同源）。
 *  返回类型取松散版（unknown | Promise）以兼容 authorities 注入的 DispatchContext 版 seam。 */
export type GenerationPlanningHandler = (input: {
  capability: string;
  params: Record<string, unknown>;
  lease?: ProjectLeaseV2;
  origin?: { host: string; actorId?: string; sourceDocument?: { documentId: string; revision: number; contentHash: string } };
  storyboardTarget?: GenerationInvocationContext['storyboardTarget'];
  modelNames?: GenerationInvocationContext['modelNames'];
  approvalPolicy?: ProjectAgentApprovalPolicy;
}) => unknown | Promise<unknown>;

export { createInMemoryGenerationOperationStore } from "./mcpGenerationOperationMemoryStore";
