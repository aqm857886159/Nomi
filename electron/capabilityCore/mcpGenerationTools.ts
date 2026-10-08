import { GENERATION_ARGUMENT_REFUSAL, refuseToModel } from "./transportFailure";
import { pinAssetReference, type AssetReferenceIdentity } from "./semanticGenerationCandidate";
import { presentStoryboardAuthoring, patchStoryboardAuthoring, addShotsGuidance } from './mcpGenerationMultiShot';
import { createDocumentPlanAuthoring } from './generationDocumentPlan';
import { GenerationOperationNotFoundError } from '../productionRun/productionRunErrors';
import { generationTaskReference } from '../shared/agentCapabilities/taskReference';
import type { GenerationInvocationContext } from '../shared/agentCapabilities/generationInvocationContext';
import { resolveGenerationShotScope } from "../shared/agentCapabilities/generationShotScope";
import crypto from "node:crypto";
import { hasMentions } from "../shared/storyboard/promptMentions";
import {
  compileExecutionContract,
  type ExecutionContractV1,
  type PlanCandidate,
} from "./executionContract";
import {
  buildMultiShotGateProjection,
  deriveShotPrice,
  type ModelPricing,
  type MultiShotGateProjection,
  type ShotPrice,
} from "../productionRun/shotPricing";
import {
  createMultiShotCreateHelpers,
  resolveGateScope,
  type AssertReferencesResolvable,
  type GenerationOperationDraftShot,
  type GenerationSealMultiShot,
  type StoryboardPlanResult,
} from "./mcpGenerationMultiShot";
import {
  candidateHasCharacterReference,
  candidatesForCurrentVideoModel,
  modelSupportsReferenceImage,
  normalizeAuthoredCandidate,
  normalizeVideoCandidate,
  shotDurationSeconds,
  videoCandidateForPlan,
  videoCompileOptions,
  videoRecommendationInput,
} from "./mcpGenerationVideoResolve";
import type { ModuleRegistry } from "./moduleRegistry";
import type { LiveGenerationRuntimeScope } from "./liveGenerationRuntime";
import type { ProjectLeaseV2 } from "./projectLease";
import type { ProjectAgentApprovalPolicy } from "../shared/agentCapabilities/capabilityApprovalPolicy";
import { GenerationProviderCapabilityError } from "./generationRuntimeAdapter";
import type {
  VideoGenerationRecommendationInput,
  VideoGenerationRecommendationResult,
  VideoModelCandidate,
} from "../shared/videoCapabilities/recommendation";
import { effectiveVideoModes } from "../shared/videoCapabilities/recommendation";
import { resolveGenerationPlan } from "../shared/videoCapabilities/planResolver";
import { generationResolveInputSchema } from "../shared/agentCapabilities/generation";
import { normalizeStoredDraft, resolvePlanPatch } from "./generationPlanPatch";
import type { GenerationDefaultTaskKind } from "../settings/generationModelDefaultsContract";
import { DECLARED_DEFAULT_DEVIATION_NOTE, admitShotIdentity, declaredDefaultDeviations, semanticCandidateFromParams } from "./semanticGenerationCandidate";
import { projectGenerationOperationPreview } from "./mcpGenerationPreview";
import { generationCandidateSchema } from "../shared/agentCapabilities/generationPlanSchemas";
import { resolveProviderReadiness } from "./mcpGenerationProviderReadiness";

// J06 — 诚实 ETA：冷启动给区间（low/high），不再硬编 40/180s 点值。
// 历史 P50/P90 落盘后可切 etaBasis='historical'；当前全部为 coldstart。
// 基线（APIMart 生产 2026-09-03）：video 4-10min / image 10-60s / audio 15-90s。
const COLDSTART_ETA_BY_KIND: Record<string, { low: number; high: number }> = {
  video: { low: 240, high: 600 }, image: { low: 10, high: 60 },
  audio: { low: 15, high: 90 },  model3d: { low: 120, high: 300 },
};
const DEFAULT_BATCH_CONCURRENCY = 6;
/** J06 — shotCount × kind → { waitSeconds, waitSecondsHigh, etaBasis }. */
export function coldstartEtaForGate(outputKinds: readonly string[], shotCount: number, concurrency = 1): { waitSeconds: number; waitSecondsHigh: number; etaBasis: 'coldstart' } {
  const primaryKind = outputKinds.find((k) => k === "video") ?? outputKinds[0] ?? "image";
  const { low, high } = COLDSTART_ETA_BY_KIND[primaryKind] ?? { low: 120, high: 360 };
  const rounds = Math.max(1, Math.ceil(Math.max(0, shotCount) / Math.max(1, Math.floor(concurrency))));
  return { waitSeconds: Math.round(low * rounds), waitSecondsHigh: Math.round(high * rounds), etaBasis: "coldstart" as const };
}

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
export type { GenerationOperationState, GenerationOperationShot, GenerationOperation, GenerationAuthorizationPreparation, GenerationOperationStore, GenerationReviseInput } from "./generationOperationTypes";
import type { GenerationAuthorizationPreparation, GenerationOperation, GenerationOperationStore } from "./generationOperationTypes";


export type GenerationPlanningHandlerDependencies = {
  registry: Pick<ModuleRegistry, "resolve"> & Partial<Pick<ModuleRegistry, "snapshot">>;
  /** Capture one immutable catalog registry at the start of a draft_shots call. */
  createDraftScope?: () => LiveGenerationRuntimeScope;
  operations: GenerationOperationStore;
  now?: () => string;
  resolveStoryboardReferenceUrl?: (projectId: string, reference: PlanCandidate["references"][number]) => string;
  requestRendererDecision?: (op: string, payload: unknown) => Promise<unknown>;
  /**
   * Bounded narrow RPC to the renderer. A document-admitted storyboard's author body is owned by
   * the project record (the same `storyboardDesign` a hand-made plan uses) — this is how the main
   * process hands it over. No deadline-free variant here: nobody is pressing a button.
   */
  requestRenderer?: (op: string, payload: unknown, timeoutMs: number) => Promise<unknown>;
  context?: (input: { projectId: string; lease: ProjectLeaseV2 }) => unknown | Promise<unknown>;
  /**
   * Recovery capabilities are descriptive only. This resolver answers the
   * separate question of whether an executable adapter + credential exists for
   * the selected provider/model. Keeping that seam separate means a provider
   * without native recovery is still allowed to submit normally.
   */
  providerReadiness?: (input: {
    providerId: string;
    modelId: string;
    moduleId: string;
    mode: string;
  }) => { providerReady: boolean; missingForSubmit?: string[] };
  videoModelCandidates?: readonly VideoModelCandidate[];
  /** Catalog-backed saved defaults used when scriptText leaves model fields unset. */
  defaultModelForTaskKind?: (taskKind: GenerationDefaultTaskKind) => {
    moduleId: string;
    providerId: string;
    modelId: string;
    mode: string;
  } | undefined;
  recommendVideoGeneration?: (
    input: VideoGenerationRecommendationInput,
    candidates: readonly VideoModelCandidate[],
  ) => VideoGenerationRecommendationResult;
  /**
   * P4 S2: resolve the catalog pricing row for a provider/model identity (candidate.providerId maps
   * to the catalog vendorKey). preview derives per-shot single prices from it; gate_request feeds the
   * derived amount into the receipt's maximumCost (replacing the ¥0 placeholder). Omitted → preview
   * 与 gate_request 都如实报「价格未知」（`maximumCost: null` + `unknownShotCount`），生成照常进行；
   * an unknown price is never represented as a zero ceiling.
   */
  resolveModelPricing?: (providerId: string, modelId: string) => ModelPricing | undefined;
  /**
   * P4 S6.5 `scriptText` 入口: turn a script into a shot list (the storyboard planner — an LLM拟稿). Called
   * only when `create` is given `scriptText` instead of `shots`. Returns per-shot declarations the handler
   * maps into draft shots. Omitted → the `scriptText` entrance is unavailable (throws a human error). Kept
   * as a seam (not inlined) so the zero-credit E2E stubs a fixed board and only the `plan` entrance runs真.
   */
  planStoryboard?: (input: {
    projectId: string;
    scriptText: string;
    minimumShots?: number;
    targetDurationSeconds?: number;
  }) => StoryboardPlanResult | Promise<StoryboardPlanResult>;
  /**
   * P4 §5.1.4 锚复用授权面: 校验 create 里引用的参考素材（复用锚 = 已有资产作 character 参考）存在且属于本项目。
   * 单镜与多镜 create 都过它（一个入口两路都堵，P2 通用性）。抛人话 Error 即拒。Omitted → 不校验（向后兼容）。
   */
  assertReferencesResolvable?: AssertReferencesResolvable;
  /**
   * assetId → 可引用身份（内容哈希 + 版本）。生产装配点绑 `resolveProjectAssetReferenceIdentity`。
   * 模型只知道 assetId（`look_at_media` 返回的就是它），身份归项目素材库管——这条 seam 就是
   * 2026-09-18「宿主要求动词给不出的字段」那一类的解法，与多镜候选合成同一条纪律。
   */
  resolveAssetReferenceIdentity?: (projectId: string, assetId: string) => AssetReferenceIdentity | undefined;
  prepareAuthorization?: (input: {
    lease: ProjectLeaseV2;
    operation: GenerationOperation;
    contract: ExecutionContractV1;
    multiShot?: GenerationSealMultiShot;
  }) => GenerationAuthorizationPreparation | Promise<GenerationAuthorizationPreparation>;
  start?: (operation: GenerationOperation, lease: ProjectLeaseV2) => unknown | Promise<unknown>;
  reconcile?: (operation: GenerationOperation, outcome: "found" | "not_found", lease: ProjectLeaseV2) => unknown | Promise<unknown>;
  /** 这份操作对应的制作里，提交结果未知的镜（读任务状态时逐镜告诉 Agent 别再 generate）。缺省 = 读不到制作，不加这段。 */
  unknownShotsOf?: (operation: GenerationOperation, lease: ProjectLeaseV2) => readonly string[];
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuseToModel(GENERATION_ARGUMENT_REFUSAL, `${label} must be an object.`);
  return value as Record<string, unknown>;
}

function candidateFrom(value: unknown): PlanCandidate {
  return generationCandidateSchema.parse(value);
}

/**
 * 报价卡上**哪些镜成为价格行、哪些成为锚 chip**。一条规则，一个家。
 *
 * 常规批次：行 = 非锚镜，锚在 `anchorChips` 里各自标价（它们也要花钱，只是不占行）。
 * **只有参考卡的批次**（2026-09-22 起合法）：行 = 那些锚本身。
 * 此前这一支返回 undefined，而 present/seal 的范围**本来就含锚**——卡会静默退回单镜路、
 * 只把第一张摆出来，其余照样跑、照样扣钱。**每一笔要花的钱都必须在卡上看得见**，
 * 这是钱那条路的不变量，不是显示偏好。
 */
export function gateRowsFor<T extends { role?: "anchor" | "shot"; included?: boolean }>(
  shots: readonly T[],
): { rows: readonly T[]; anchorChipShots: readonly T[] } {
  const included = shots.filter((shot) => shot.included !== false);
  const nonAnchors = included.filter((shot) => shot.role !== "anchor");
  return nonAnchors.length > 0
    ? { rows: nonAnchors, anchorChipShots: included.filter((shot) => shot.role === "anchor") }
    : { rows: included, anchorChipShots: [] };
}

/**
 * 一条参考素材的身份是否已经钉住。缺 `contentHash`/`version` 的（模型只会给 assetId）由宿主补。
 * 与 `semanticCandidateFromParams` 里那一段是同一条规则的两个调用点：create 走合成器，patch 走这里。
 */
function pinReference(
  projectId: string,
  value: unknown,
  resolve: ((projectId: string, assetId: string) => AssetReferenceIdentity | undefined) | undefined,
): unknown {
  return pinAssetReference(value, resolve ? (assetId: string) => resolve(projectId, assetId) : undefined);
}

export function createGenerationPlanningHandler(deps: GenerationPlanningHandlerDependencies) {
  const now = deps.now ?? (() => new Date().toISOString());
  // P4 S2: derive a candidate's real per-shot price from the catalog pricing. Unknown (never a
  // fabricated 0) when there is no resolver, no pricing row, disabled pricing, or no base cost.
  const priceForCandidate = (candidate: PlanCandidate): ShotPrice =>
    deriveShotPrice({ candidate, resolvePricing: (providerId, modelId) => deps.resolveModelPricing?.(providerId, modelId) });

  /** Human "provider · model（mode）" string for the card — the renderer never re-joins provider/model. */
  const providerModelText = (candidate: PlanCandidate): string => {
    const label = deps.videoModelCandidates ? videoCandidateForPlan(candidate, deps.videoModelCandidates)?.videoCandidate.label : undefined;
    const model = label || candidate.modelId;
    return candidate.mode ? `${candidate.providerId} · ${model}（${candidate.mode}）` : `${candidate.providerId} · ${model}`;
  };

  // P4 S6.5 生产入口: the multi-shot create/seal helpers (resolveCreateShots + sealMultiShotFor) live in
  // mcpGenerationMultiShot.ts; wire them with this handler's shared derivations (all single source of truth).
  /**
   * 一份候选 → 一份执行合同。**全仓唯一的编译口**（preview / gate_request / 多镜密封都走它）。
   *
   * 两件投影必须在同一处发生，否则「报价看到的」和「密封发出去的」会是两份东西：
   *  · 参数表投影（视频候选按档案模式的控件声明，其余按目录派生的线缆声明）；
   *  · 提示词投影（`@[asset:url]` → `@image1`，规则住共享层，与手动画布那条路同一份）。
   * 提示词里没有 @ 标记时不去解析素材（绝大多数镜头，逐字节不变）；有标记却解析不出源地址 → 报错，
   * 不是原样发出去。
   */
  const referenceSourceUrlsFor = (projectId: string, candidate: PlanCandidate): readonly (string | undefined)[] | undefined => {
    if (!hasMentions(candidate.prompt)) return undefined;
    const resolve = deps.resolveStoryboardReferenceUrl;
    if (!resolve) return undefined;
    return candidate.references.map((reference) => resolve(projectId, reference));
  };

  /**
   * **编译执行合同的唯一那一处**（preview / gate_request / 多镜密封都走它）。
   *
   * 参数表与变体清单由 `videoCompileOptions` 这一个 seam 给（它认不出视频档案时会退回通用档案判据，
   * 所以 image/audio/3D 也有参数表可校验）；`referenceSourceUrls` 是本刀这一路独有的 @ 投影输入。
   * 谁在别处再写一次 `compileExecutionContract(...)`，谁就是第二台发动机。
   */
  const contractFor = (candidate: PlanCandidate, projectId: string) => {
    const referenceSourceUrls = referenceSourceUrlsFor(projectId, candidate);
    return compileExecutionContract(candidate, deps.registry, {
      ...videoCompileOptions(candidate, deps.videoModelCandidates),
      ...(referenceSourceUrls ? { referenceSourceUrls } : {}),
    });
  };

  /** patch 入口的参考素材身份补齐。与 create 那条同一个解析器，只是调用点不同。 */
  const resolvePatchReferences = (projectId: string, value: unknown): PlanCandidate["references"] => {
    if (!Array.isArray(value)) refuseToModel(GENERATION_ARGUMENT_REFUSAL, "references must be an array of asset ids.");
    // 补完身份后过一次候选自己的 schema：钉住的形状是执行契约签名的那一份，不能只靠类型断言说它齐了。
    return generationCandidateSchema.shape.references.parse(
      value.map((item) => pinReference(projectId, item, deps.resolveAssetReferenceIdentity)),
    ) as PlanCandidate["references"];
  };

  /** 文稿方案的落地、补镜头与「一次请求一份方案」（`generationDocumentPlan.ts`）。 */
  const documentPlans = createDocumentPlanAuthoring({
    ...(deps.requestRenderer ? { requestRenderer: deps.requestRenderer } : {}),
    ...(deps.resolveStoryboardReferenceUrl ? { resolveStoryboardReferenceUrl: deps.resolveStoryboardReferenceUrl } : {}),
  });

  /** 起草的每一镜：同一套准入（候选合成 → 归一 → 身份核对）。首建与补镜头都过这一处，不另写一台。 */
  const admitDraftShots = async (
    projectId: string,
    params: Record<string, unknown>,
    registry: GenerationPlanningHandlerDependencies["registry"] = deps.registry,
  ): Promise<GenerationOperationDraftShot[] | undefined> => {
    const draftShots = await resolveCreateShots(projectId, params, registry);
    if (!draftShots) return undefined;
    const normalizedShots = draftShots.map((shot) => ({ ...shot, candidate: normalizeAuthoredCandidate(shot.candidate, registry, deps.videoModelCandidates) }));
    // 每一镜的「模型 + 模式」落盘前就对过账：矛盾的镜头当场拒绝，不留到付费卡上点下去才发现（第 9 条）。
    for (const shot of normalizedShots) admitShotIdentity(shot.candidate, registry, shot.role);
    return normalizedShots;
  };

  /** 单镜起草（一句话生成一张图）的准入。新建单镜草稿与「补一镜到这一请求的方案」共用。 */
  const admitSingleCandidate = (
    projectId: string,
    operationId: string,
    params: Record<string, unknown>,
    registry: GenerationPlanningHandlerDependencies["registry"] = deps.registry,
  ): PlanCandidate => {
    // A natural-language create request only needs `prompt`.  Keep the
    // explicit candidate path intact, but compile the short path at this
    // boundary so the model never has to invent internal candidate IDs or
    // provider wiring (the previous behavior surfaced as a false refusal).
    const singleCandidate = semanticCandidateFromParams({
      operationId,
      params,
      candidateFrom,
      ...(deps.defaultModelForTaskKind ? { defaultModelForTaskKind: deps.defaultModelForTaskKind } : {}),
      ...(registry.snapshot ? { registry } : {}),
      ...(deps.resolveAssetReferenceIdentity
        ? { resolveAssetReferenceIdentity: (assetId: string) => deps.resolveAssetReferenceIdentity!(projectId, assetId) }
        : {}),
    });
    // P4 §5.1.4 锚复用授权面（单镜同守，P2 通用性）：单镜引用外来/不存在资产也当场拒——references 有三个入口，
    // 单镜 candidate 是其一，不能只堵多镜。多镜路已在 resolveCreateShots 内校验过。
    if (deps.assertReferencesResolvable && singleCandidate.references.length > 0) {
      deps.assertReferencesResolvable(projectId, singleCandidate.references);
    }
    const normalizedSingle = normalizeAuthoredCandidate(singleCandidate, registry, deps.videoModelCandidates);
    admitShotIdentity(normalizedSingle, registry);
    return normalizedSingle;
  };

  /** 补进一份文稿方案后的回执：草稿还是那份（id 不变），补上的行与它们的 id 在 `storyboardExtended` 里。 */
  const extendedReceipt = async (operation: GenerationOperation, shots: readonly GenerationOperationDraftShot[], note?: string) => {
    const storyboardExtended = await documentPlans.extendDocumentPlan(operation.projectId, operation.sourceDocumentId!, operation.operationId, shots);
    return { operation, taskRef: generationTaskReference(operation.operationId), nextAction: "preview", storyboardExtended, ...(note ? { note } : {}) };
  };

  const { resolveCreateShots, sealMultiShotFor } = createMultiShotCreateHelpers({
    registry: deps.registry,
    videoModelCandidates: deps.videoModelCandidates,
    ...(deps.planStoryboard ? { planStoryboard: deps.planStoryboard } : {}),
    parsers: { candidateFrom, record },
    normalizeVideoCandidate: (candidate) => normalizeVideoCandidate(candidate, deps.videoModelCandidates),
    compileContract: contractFor,
    priceForCandidate,
    effectiveVideoModes,
    ...(deps.defaultModelForTaskKind ? { defaultModelForTaskKind: deps.defaultModelForTaskKind } : {}),
    ...(deps.assertReferencesResolvable ? { assertReferencesResolvable: deps.assertReferencesResolvable } : {}),
    ...(deps.resolveAssetReferenceIdentity ? { resolveAssetReferenceIdentity: deps.resolveAssetReferenceIdentity } : {}),
  });

  /**
   * P4 S4 — build the real multi-shot display.shots (the ASSEMBLY the S3a card was waiting on;
   * mcpGenerationTools.ts:616 "scales once shots[] is threaded through"). Projects the operation's
   * INCLUDED video shots (anchors ride separately as chips) into the serializable gate projection using
   * the same S2 pricing/degradation single source of truth. Returns undefined for a single-shot op.
   */
  const multiShotGateProjectionFor = (operation: GenerationOperation, scope?: readonly string[]): MultiShotGateProjection | undefined => {
    if (!operation.shots || operation.shots.length === 0) return undefined;
    // 这一道门只盖这一次点到的那几镜：签进挑战里的展示就是它们，不是整份草稿。
    const { rows: includedVideo, anchorChipShots: anchors } = gateRowsFor(scope ? operation.shots.filter((shot) => scope.includes(shot.shotId)) : operation.shots);
    if (includedVideo.length === 0) return undefined;
    const normalized = (candidate: PlanCandidate) => normalizeVideoCandidate(candidate, deps.videoModelCandidates);
    const durationValues = includedVideo.map((shot) => shotDurationSeconds(normalized(shot.candidate)));
    const totalDurationSeconds = durationValues.every((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0)
      ? durationValues.reduce((sum, value) => sum + value, 0)
      : undefined;
    return buildMultiShotGateProjection({
      shots: includedVideo.map((shot) => {
        const candidate = normalized(shot.candidate);
        return {
          shotId: shot.shotId,
          // 用户在这一刻要决定花不花钱，每行读到的应该是「日落前的一分钟」，不是被砍断的提示词。
          // 模型没拟标题时才退回提示词前缀（120 与动词 `title` 的上限同源）。
          sceneOneLiner: shot.title?.trim() || candidate.prompt.slice(0, 120),
          providerModelText: providerModelText(candidate),
          candidate,
          durationSeconds: shotDurationSeconds(candidate),
          hasCharacter: candidateHasCharacterReference(candidate),
          supportsReferenceImage: modelSupportsReferenceImage(candidate, deps.videoModelCandidates),
        };
      }),
      resolvePricing: (providerId, modelId) => deps.resolveModelPricing?.(providerId, modelId),
      currency: "CNY",
      ...(operation.planVersion !== undefined ? { planVersion: operation.planVersion } : {}),
      ...(operation.authorization ? { planHash: operation.authorization.digest } : {}),
      specs: {
        shotCount: includedVideo.length,
        ...(totalDurationSeconds === undefined ? {} : { durationSeconds: totalDurationSeconds }),
      },
      anchorChips: anchors.map((anchor) => ({ label: normalized(anchor.candidate).prompt.slice(0, 40), price: priceForCandidate(normalized(anchor.candidate)) })),
    });
  };

  const resolvePlanAdvisory = (params: Record<string, unknown>): unknown => {
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
  };

  return async (input: Parameters<GenerationPlanningHandler>[0]): Promise<unknown> => {
    const params = input.params;
    // resolve = stateless advisory pass（generation strategy resolver）：纯计算、不落 durable
    // operation、不触生成，本就不需要项目租赁凭证（GUI 窄 IPC 也是无 lease 进来）→ 提前返回。
    // 其余 capability（context/create/preview/gate_*/start…）一律要求已核验 lease。
    if (input.capability === "resolve") return resolvePlanAdvisory(params);
    if (!input.lease) throw new Error("A verified project lease is required");
    const capturedProjectId = input.lease.projectId;
    if (input.capability === "context") {
      if (deps.context) return deps.context({ projectId: input.lease.projectId, lease: input.lease });
      const providerProfiles = (deps.registry.snapshot?.() ?? []).flatMap((manifest) => manifest.providers.map((provider) => ({
        providerId: provider.providerId,
        modelIds: provider.models.map((model) => model.modelId),
        modes: [...new Set(provider.models.flatMap((model) => model.modes))],
        capabilities: provider.models.map((model) => ({ modelId: model.modelId, ...model.capabilities })),
      })));
      const projectVideoModes = (videoCandidate: VideoModelCandidate) => effectiveVideoModes(videoCandidate).map((mode) => ({
        id: mode.id,
        intent: mode.intent,
        vendorTerm: mode.vendorTerm,
        transportTaskKind: mode.transportTaskKind,
        references: mode.slots.map((slot) => ({ kind: slot.kind, min: slot.min, max: slot.max, label: slot.label })),
        parameters: mode.params.map((parameter) => ({ key: parameter.key, type: parameter.type, options: parameter.options })),
      }));
      const videoModels = (deps.videoModelCandidates ?? []).map((videoCandidate) => ({
        providerId: videoCandidate.provider,
        modelId: videoCandidate.modelKey,
        label: videoCandidate.label,
        archetypeId: videoCandidate.archetype.id,
        ...(videoCandidate.variantId ? { variantId: videoCandidate.variantId } : {}),
        variants: (videoCandidate.variantChoices ?? []).map((variant) => ({
          ...variant,
          modes: projectVideoModes({ ...videoCandidate, variantId: variant.id }),
        })),
        modes: projectVideoModes(videoCandidate),
      }));
      return {
        projectId: input.lease.projectId,
        immutableProjectUuid: input.lease.immutableProjectUuid,
        projectGeneration: input.lease.projectGeneration,
        providerProfiles,
        ...(videoModels.length ? { videoModels } : {}),
        nextAction: "create",
      };
    }
    const operationId = typeof params.operationId === "string" && params.operationId.trim() ? params.operationId.trim() : `op-${crypto.randomUUID()}`;
    if (input.capability === "create") {
      // draft_shots is the lifecycle boundary for a multi-shot draft. Capture
      // the catalog once here and thread this registry explicitly through all
      // shot resolves; a later draft call creates a new scope and sees catalog
      // edits without an implicit microtask cache.
      const draftRegistry = deps.createDraftScope?.().registry ?? deps.registry;
      // P4 S6.5 生产入口: a multi-shot draft is created from `shots` (client gives每镜 plan) or `scriptText`
      // (storyboard planner 拟稿). Both land the same durable draft.shots that S1 patch/preview address and
      // gate_request seals. Neither `shots` nor `scriptText` → single-shot (today, byte-identical).
      const normalizedShots = await admitDraftShots(input.lease.projectId, params, draftRegistry);
      // 一次请求一份方案（D5，宿主保证）：这一请求已经起草过文稿方案，这次又不带 operationId——补到那一份上。
      const sameRequestPlan = documentPlans.planToExtend(capturedProjectId, input.origin?.sourceDocument, input.storyboardTarget, params.newPlan === true);
      const requestPlan = sameRequestPlan ? await deps.operations.read(capturedProjectId, sameRequestPlan) : undefined;
      if (requestPlan?.sourceDocumentId === input.origin?.sourceDocument?.documentId && requestPlan?.sourceDocumentId) {
        const shots = normalizedShots ?? [{ shotId: "shot-1", candidate: admitSingleCandidate(capturedProjectId, operationId, params, draftRegistry),
          ...(params.storyboard ? { storyboard: params.storyboard as GenerationOperationDraftShot['storyboard'] } : {}) }];
        return extendedReceipt(requestPlan, shots, `Added to plan ${requestPlan.operationId}, which this request already drafted, instead of starting a second plan. ${addShotsGuidance(requestPlan.operationId)}`);
      }
      if (normalizedShots) {
        // 顶层 candidate = 第一个 shot 的 candidate (reducer seal 硬要顶层 contract 匹配顶层 draft candidate,
        // productionRunReducer.ts generation.seal). 与 S4 e2e setup 同构 (top = shots[0]).
        const operation = await deps.operations.create({ operationId, projectId: input.lease.projectId, candidate: normalizedShots[0].candidate, shots: normalizedShots, now: now(), origin: input.origin, ...(params.cardHidden === true ? { cardHidden: true } : {}), ...(input.approvalPolicy ? { policySnapshot: input.approvalPolicy } : {}) });
        const savedPlan = await documentPlans.saveDocumentPlan(capturedProjectId, input.origin?.sourceDocument, operation.operationId, normalizedShots, input.storyboardTarget);
        // 「这份草稿只有参考卡」是一条**安静提示**，不是一次拒绝（2026-09-22，用户 09-21 点名）。
        // 它照样会生成、照样在报价卡上逐张标价；缺的只是「还没有镜头用到它们」这件事实。
        // 2026-10-05：这句原来是「镜头请在**下一次** draft_shots 调用里补」——模型照做、不带 operationId，
        // 宿主就新建了第二份方案。文稿方案现在点名**这一份**（`addShotsGuidance`）；画布草稿没有「补」这条路。
        const anchorsOnly = normalizedShots.every((shot) => shot.role === "anchor");
        // 只核对**模型自己写的**镜头（`params.shots`）：剧本自动拟镜那条路的模型本来就是宿主按默认补的。
        const authored = Array.isArray(params.shots) ? params.shots : undefined;
        const deviations = authored ? declaredDefaultDeviations(normalizedShots.map((shot, index) => ({ shotId: shot.shotId,
          params: (authored[index] ?? {}) as Record<string, unknown>, candidate: shot.candidate })), deps.defaultModelForTaskKind, input.modelNames) : [];
        return { operation, taskRef: generationTaskReference(operation.operationId), nextAction: "preview",
          ...(savedPlan ? { storyboardSaved: savedPlan } : {}),
          ...(deviations.length ? { modelDeviatesFromUserDefault: deviations, defaultDeviationNote: DECLARED_DEFAULT_DEVIATION_NOTE } : {}),
          ...(anchorsOnly ? { note: savedPlan
            ? `This plan has only reference cards so far; no shot reuses them yet. ${savedPlan.addShots}`
            : "This draft has only reference cards; no shot reuses them yet. That is fine — generate the cards on their own, or draft the shots that reuse them." } : {}) };
      }
      const normalizedSingle = admitSingleCandidate(input.lease.projectId, operationId, params, draftRegistry);
      const operation = await deps.operations.create({ operationId, projectId: input.lease.projectId, candidate: normalizedSingle, now: now(), origin: input.origin, ...(params.cardHidden === true ? { cardHidden: true } : {}), ...(input.approvalPolicy ? { policySnapshot: input.approvalPolicy } : {}) });
      const savedSingle = await documentPlans.saveDocumentPlan(capturedProjectId, input.origin?.sourceDocument, operation.operationId,
        [{shotId:normalizedSingle.candidateId,candidate:normalizedSingle,storyboard:params.storyboard as GenerationOperationDraftShot['storyboard']}], input.storyboardTarget);
      const singleDeviations = declaredDefaultDeviations([{ params, candidate: normalizedSingle }], deps.defaultModelForTaskKind, input.modelNames);
      return { operation, taskRef: generationTaskReference(operation.operationId), nextAction: "preview",
        ...(savedSingle ? { storyboardSaved: savedSingle } : {}),
        ...(singleDeviations.length ? { modelDeviatesFromUserDefault: singleDeviations, defaultDeviationNote: DECLARED_DEFAULT_DEVIATION_NOTE } : {}) };
    }
    const stored = await deps.operations.read(input.lease.projectId, operationId);
    if (!stored) throw new GenerationOperationNotFoundError();
    // 读盘归一（**唯一**的存量残留清理点）：所有 capability 都经这里，所以读出来的就是干净的、
    // 而且已落盘。逐入口补会漏——上一轮就漏在 gate_request 上（预览看得见、点确认时炸）。
    const normalizedDraft = await normalizeStoredDraft({
      operation: stored, projectId: input.lease.projectId, operationId, now: now(),
      registry: deps.registry, videoModelCandidates: deps.videoModelCandidates,
      patch: (projectId, id, patch, at, shotId) => deps.operations.patch(projectId, id, patch, at, shotId),
    });
    const current = normalizedDraft.operation as typeof stored;
    const storedLeftovers = normalizedDraft.clearedParameters;
    if (input.capability === "extend") {
      // 在一份已有的文稿方案后面补镜头 / 参考卡（「再加两镜」）。只有文稿方案有「补」：画布草稿改一镜带 shotId，另起一份不带 operationId。
      if (!current.sourceDocumentId) refuseToModel(GENERATION_ARGUMENT_REFUSAL, "Adding shots works on a storyboard plan saved on a document. This is a canvas draft: change one of its shots with its shotId, or start a new draft without operationId.");
      const shots = await admitDraftShots(capturedProjectId, { shots: params.shots }, deps.createDraftScope?.().registry ?? deps.registry);
      if (!shots) refuseToModel(GENERATION_ARGUMENT_REFUSAL, "Adding to a plan needs the new shots.");
      return extendedReceipt(current, shots);
    }
    if (input.capability === "present") {
      if (current.sourceDocumentId) return presentStoryboardAuthoring(current,capturedProjectId,operationId,params.shotIds,deps.requestRendererDecision);
      // `generate` 动词：把草稿摆到用户面前。草稿一字不动，只让报价卡可投影；点头/花钱仍是用户在卡上的动作。
      // The durable owner validates lifecycle and preserves prior execution evidence.
      // 2026-09-22 上午这里有一条「被 × 过的 operationId 不许再 present」的拒绝。当天下午用户改窄了裁决 D：
      // × 收回的是**这一次出价**，不是那份计划——对同一份草稿再 `generate` 就是重新出价，必须放行。
      const scope = resolveGenerationShotScope(current.shots?.map((shot) => shot.shotId) ?? [current.candidate.candidateId], params.shotIds);
      const operation = await deps.operations.present(input.lease.projectId, operationId, now(), scope, input.storyboardTarget, input.approvalPolicy);
      const shots = operation.shots && operation.shots.length > 0
        ? operation.shots.filter((shot) => shot.included !== false).map((shot) => shot.shotId)
        : [operation.candidate.candidateId];
      return { operation, taskRef: generationTaskReference(operation.operationId), shots, nextAction: "await_user" };
    }
    if (input.capability === "plan") {
      if (current.sourceDocumentId) {
        await patchStoryboardAuthoring(current,params,capturedProjectId,operationId,resolvePatchReferences,deps.resolveStoryboardReferenceUrl,deps.requestRenderer);
        return {operation:current,taskRef:generationTaskReference(operationId),nextAction:'preview'};
      }
      // The wire model is a derived projection. Never accept it from an MCP
      // caller; it is recomputed from the selected archetype mode/variant.
      const rawPatch = record(params.patch, "generation patch") as Partial<Omit<PlanCandidate, "candidateId" | "revision">>;
      const { transportModelId: _ignoredTransportModelId, references: patchedReferences, ...patchRest } = rawPatch as
        Partial<Omit<PlanCandidate, "candidateId" | "revision">> & { references?: unknown };
      // 改草稿这条路的参考同样只带 assetId（`draft_shots` 带 operationId 时走这里）。不在这里补身份，
      // 一次 patch 就会把一条缺 contentHash 的参考写进已存候选——类型说它齐了，运行时不是（静默假数据）。
      const userPatch: Partial<Omit<PlanCandidate, "candidateId" | "revision">> = patchedReferences === undefined
        ? patchRest
        : { ...patchRest, references: resolvePatchReferences(input.lease.projectId, patchedReferences) };
      // 多镜草稿改一镜：`shotId` 指到 shots[] 里那一镜，合并与变更集都对着**它的**候选算（顶层候选是
      // 第一镜的镜像，拿它当基准会把别的镜的模型/模式当成「变了」）。缺省 = 顶层候选（单镜草稿，逐字不变）。
      const shotId = typeof params.shotId === "string" && params.shotId.trim() ? params.shotId.trim() : undefined;
      const targetShot = shotId ? current.shots?.find((shot) => shot.shotId === shotId) : undefined;
      if (shotId && !targetShot) refuseToModel(GENERATION_ARGUMENT_REFUSAL, `Generation shot not found: ${shotId}. Read the draft again and copy a shotId it actually lists.`);
      const baseCandidate = targetShot?.candidate ?? current.candidate;
      const { normalizedPatch, changeset } = resolvePlanPatch({
        baseCandidate, userPatch, registry: deps.registry, videoModelCandidates: deps.videoModelCandidates,
      });
      const operation = await deps.operations.patch(input.lease.projectId, operationId, normalizedPatch, now(), shotId, input.storyboardTarget);
      return { operation, taskRef: generationTaskReference(operation.operationId), nextAction: "preview", ...(changeset ? { changeset } : {}) };
    }
    if (input.capability === "preview") {
      if (current.sourceDocumentId) return { operation: current, taskRef: generationTaskReference(operationId), nextAction: "present" };
      const candidate = normalizeVideoCandidate(current.candidate, deps.videoModelCandidates);
      const contract = contractFor(candidate, input.lease.projectId);
      const readiness = resolveProviderReadiness(deps, candidate);
      const resolved = deps.registry.resolve({
        moduleId: candidate.moduleId,
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        mode: candidate.mode,
      });
      const recommendationInput = resolved.outputKinds.includes("video")
        ? videoRecommendationInput(candidate)
        : null;
      const recommendation = recommendationInput && deps.recommendVideoGeneration && deps.videoModelCandidates
        ? deps.recommendVideoGeneration(recommendationInput, candidatesForCurrentVideoModel(candidate, deps.videoModelCandidates))
        : undefined;
      // P4 S2: this is a pure, provider-free projection; multi-shot plans use
      // every included video row and single-shot keeps the legacy one-row shape.
      const projection = projectGenerationOperationPreview(current, candidate, deps);
      return {
        operationId,
        candidateRevision: current.candidate.revision,
        contract,
        ...(storedLeftovers.length ? { clearedParameters: storedLeftovers } : {}),
        ...(recommendation ? { recommendation } : {}),
        pricing: projection,
        providerReady: readiness.providerReady,
        providerCapabilityProfile: readiness.providerCapabilityProfile,
        recoveryNotice: readiness.recoveryNotice,
        ...(readiness.providerCapabilitiesMissing.length ? { providerCapabilitiesMissing: readiness.providerCapabilitiesMissing } : {}),
        // Keep the established action vocabulary for renderer/MCP clients;
        // an unknown price remains visible in `pricing.total`，门照开、卡上如实写「价格未知」。
        ...(readiness.providerReady ? { nextAction: "request_gate" } : { nextAction: "provider_configure" }),
      };
    }
    if (input.capability === "gate_request") {
      if (current.sourceDocumentId) refuseToModel(GENERATION_ARGUMENT_REFUSAL, "This draft came from a storyboard; use the original storyboard confirmation instead of requesting a gate here.");
      // 逐镜（2026-09-30）：这一次封哪几镜——卡上点到的那几镜；不点名 = 还没封过的全部。一次没点完、盖着别的镜的
      // 那份等人授权先撤掉（只解封它盖着的镜），再按这一次的范围封（`resolveGateScope`）。
      let base = current;
      let decision = resolveGateScope(base, params.shotIds);
      if (decision.kind === "abandon-then-seal") {
        if (!deps.operations.abandonWaitingAuthorization) throw Object.assign(new Error("generation_scope_invalid"), { code: "generation_scope_invalid" });
        base = await deps.operations.abandonWaitingAuthorization(input.lease.projectId, operationId, now()) as typeof current;
        decision = resolveGateScope(base, params.shotIds);
      }
      const needsSeal = decision.kind === "seal";
      const scope = decision.kind === "abandon-then-seal" ? undefined : decision.scope;
      const candidate = normalizeVideoCandidate(base.candidate, deps.videoModelCandidates);
      // 已经在跑的计划再封一镜：顶层那份合同在第一次封印时就冻住了，原样沿用（封过的候选不许再编译一遍）。
      const contract = base.contract && base.candidate.sealedContractHash === base.contract.contractHash
        ? base.contract
        : contractFor(candidate, input.lease.projectId);
      const readiness = resolveProviderReadiness(deps, candidate);
      if (!readiness.providerReady) throw new GenerationProviderCapabilityError(contract.providerId, readiness.missingForSubmit.length ? readiness.missingForSubmit : ["configured_provider"]);
      const gateResolved = deps.registry.resolve({ moduleId: candidate.moduleId, providerId: candidate.providerId, modelId: candidate.modelId, mode: candidate.mode }); // J06
      // Seal compiled execution facts; raw editor candidates remain owned by the draft.
      // P4 S6.5: a multi-shot draft seals its per-shot sub-contracts + planHash (built from the draft
      // shots) alongside the top-level contract. `sealMultiShotFor` compiles each included shot's contract
      // and the plan hash; the store forwards them to the reducer (which freezes the batch + hard cap). A
      // single-shot draft passes no bundle (byte-identical to today). Top contract = shots[0]'s contract
      // (顶层 candidate = shots[0].candidate), so the reducer's top-level match holds.
      const multiShotSeal = needsSeal && scope ? sealMultiShotFor(base, input.lease.projectId, scope) : undefined;
      // 2026-09-21：这里从前逐镜 `assertKnownShotPrice`，价格算不出就整批拒绝
      // （`generation_pricing_unknown`）。用户拍板删掉：内置 204 个模型一条 pricing 都没有，
      // 这条拒绝等于「我们没建价格标尺 → 你不准干活」。要防的「未知被当成 0 元」由授权信封的
      // 类型守（`price.maximum: number | null` + `budget.unknownJobCount`），不靠拒绝生成来防。
      const price = priceForCandidate(candidate);
      const authorization = needsSeal && deps.prepareAuthorization
        ? await deps.prepareAuthorization({ lease: input.lease, operation: base, contract, ...(multiShotSeal ? { multiShot: multiShotSeal } : {}) })
        : undefined;
      const sealed = needsSeal
        ? await deps.operations.seal(input.lease.projectId, operationId, contract, now(), multiShotSeal, authorization)
        : base;
      // P4 S2: the receipt's cost ceiling is the known derived price. 价格算不出 → `null`，
      // 卡上走「暂时算不出价格」那一档；**永远不是 ¥0**。
      const expiresAt = new Date(Date.parse(now()) + 10 * 60 * 1000).toISOString();
      // P4 S4: for a multi-shot operation, build the real display.shots (the S3a card's data) and use the
      // PLAN-LEVEL cost as the receipt ceiling. A single-shot op omits `shots` → flat card, unchanged.
      const multiShot = multiShotGateProjectionFor(sealed, scope);
      if (multiShot) {
        const knownSubtotal = multiShot.shots.reduce((sum, shot) => (shot.price.known ? sum + shot.price.amount : sum), 0)
          + (multiShot.anchorChips ?? []).reduce((sum, chip) => (chip.price.known ? sum + chip.price.amount : sum), 0);
        return {
          operation: sealed,
          operationId,
          projectId: input.lease.projectId,
          // A multi-shot receipt is keyed on the PLAN hash (covers the whole batch — §1).
          contractHash: sealed.authorization?.digest ?? multiShotSeal?.planHash ?? contract.contractHash,
          model: `${contract.providerId}/${contract.modelId}`,
          referenceCount: contract.references.length,
          costScope: sealed.authorization?.envelope.costScope ?? `generation.multi-shot:${operationId}`,
          // 一批**全部**算不出价：没有任何已知金额可报，如实回 null（不是 0）。
          maximumCost: multiShot.shots.every((shot) => !shot.price.known)
            ? null
            : sealed.authorization?.envelope.budget.maximum ?? knownSubtotal,
          costKnown: multiShot.shots.every((shot) => shot.price.known),
          unknownShotCount: multiShot.shots.reduce((count, shot) => (shot.price.known ? count : count + 1), 0),
          currency: "CNY",
          expiresAt,
          shotSummary: multiShot.shots[0]?.sceneOneLiner ?? contract.prompt.slice(0, 120),
          // The full projection rides here → dispatcher threads it into the MAC-signed challenge display.shots.
          // hardLimit = the estimated plan total (the natural ceiling shown on the card); the scheduler
          // enforces the real cap = min(this, policy.maxSpend) at reserve time (§3.3).
          shots: { ...multiShot, hardLimit: knownSubtotal, ...coldstartEtaForGate(gateResolved.outputKinds, multiShot.shots.length || 1, DEFAULT_BATCH_CONCURRENCY), frozenItems: ["shots", "models", "references", "price"], expiresAt }, // J06 诚实 ETA
          providerReady: readiness.providerReady,
          providerCapabilityProfile: readiness.providerCapabilityProfile,
          recoveryNotice: readiness.recoveryNotice,
          ...(readiness.providerCapabilitiesMissing.length ? { providerCapabilitiesMissing: readiness.providerCapabilitiesMissing } : {}),
          nextAction: "confirm",
        };
      }
      return {
        operation: sealed,
        operationId,
        projectId: input.lease.projectId,
        contractHash: sealed.authorization?.digest ?? contract.contractHash,
        model: `${contract.providerId}/${contract.modelId}`,
        referenceCount: contract.references.length,
        costScope: sealed.authorization?.envelope.costScope ?? `generation.single-shot:${operationId}`,
        maximumCost: price.known ? sealed.authorization?.envelope.budget.maximum ?? price.amount : null,
        costKnown: price.known,
        ...(price.known ? {} : { unknownShotCount: 1 }),
        currency: "CNY",
        expiresAt,
        shotSummary: contract.prompt.slice(0, 120),
        providerReady: readiness.providerReady,
        providerCapabilityProfile: readiness.providerCapabilityProfile,
        recoveryNotice: readiness.recoveryNotice,
        ...(readiness.providerCapabilitiesMissing.length ? { providerCapabilitiesMissing: readiness.providerCapabilitiesMissing } : {}),
        nextAction: "confirm",
      };
    }
    if (input.capability === "gate_decide") {
      throw new Error("Generation gate decisions must use the Run-owned authorization seam");
    }
    if (input.capability === "start") {
      // The Host gate adapter starts immediately after the verified receipt is
      // committed. A model may still issue its explicit start tool on the next
      // turn; treat that replay as an observation instead of attempting a
      // second provider submission.
      // 单镜只发一次：已提交就是观察。多镜每点一次批一份（2026-09-30 逐镜）：已在跑的计划又批了一镜，要再推一下调度器——
      // 它只派有任务、批过的镜，同一镜不会派两次，所以重放也只是观察。
      if (current.state === "submitted" && !current.shots?.length) return { operation: current, taskRef: generationTaskReference(operationId), operationId, nextAction: "observe" };
      if ((current.state !== "sealed" && current.state !== "submitted") || !current.contract || current.authorization?.status !== "approved") refuseToModel(GENERATION_ARGUMENT_REFUSAL, "Confirm the generation plan before starting: the user has not approved this draft yet.");
      return deps.start?.(current, input.lease) ?? { operationId, state: current.state, nextAction: "provider_not_configured" };
    }
    // 宿主内部用（不在任何模型可见的方法表里）：问这句话的那个回合没了 → 收回这一次出价，计划留着。
    if (input.capability === "withdraw") {
      if (current.sourceDocumentId) return { operation: current, taskRef: generationTaskReference(operationId), nextAction: "present" };
      const reason = params.reason === "user_wrote" || params.reason === "stopped" ? params.reason : "user_closed";
      return { operation: await deps.operations.withdraw(input.lease.projectId, operationId, now(), reason), taskRef: generationTaskReference(operationId), nextAction: "present" };
    }
    if (input.capability === "cancel") return { operation: await deps.operations.cancel(input.lease.projectId, operationId, now()), nextAction: "create" };
    if (input.capability === "reconcile") {
      const outcome = params.outcome === "found" || params.outcome === "not_found" ? params.outcome : null;
      if (!outcome) refuseToModel(GENERATION_ARGUMENT_REFUSAL, "Reconciliation needs an outcome: pass \"found\" or \"not_found\".");
      return deps.reconcile?.(current, outcome, input.lease) ?? { operationId, outcome, nextAction: outcome === "found" ? "observe" : "manual_review" };
    }
    if (input.capability === "read" || input.capability === "events" || input.capability === "steer") {
      // 结果未知的镜：executionState 仍是 submitted、看上去在等，Agent 会当成「在跑」而去 observe 或自己重新 generate。
      // 这里逐镜点名并把 nextAction 改成明确的话：让用户去服务商后台核对，不要再 generate（重复提交可能重复扣费）。
      const unknownShots = deps.unknownShotsOf?.(current, input.lease) ?? [];
      if (unknownShots.length > 0) {
        return {
          operation: current,
          taskRef: generationTaskReference(operationId),
          executionState: current.state,
          unknownShots,
          nextAction: "ask_user_to_check_provider_do_not_generate",
          notice: unknownShots.map((shot) => `${shot}: outcome unknown, the provider may have already received it; do not call generate for it again; ask the user to check the provider dashboard, and leave the decision to generate again to the user in the task center.`).join(" "),
        };
      }
    }
    if (input.capability === "read" || input.capability === "events" || input.capability === "steer") return { operation: current, taskRef: generationTaskReference(operationId), executionState: current.state === "draft" ? "not_started" : current.state, nextAction: current.state === "draft" ? "preview" : "observe" };
    throw new Error(`Unsupported semantic generation capability: ${input.capability}`);
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
