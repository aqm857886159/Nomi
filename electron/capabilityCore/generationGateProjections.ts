// 能力核 · 语义生成规划的纯投影与门禁回执构造（从 mcpGenerationTools.ts 按职责拆出）。
// 只含纯计算与只读投影（context / gate projection / gate receipt / read observation / coldstart ETA），
// 不碰持久化写入与授权状态机；mcpGenerationTools.ts 单向 import 本模块（无环）。
import { generationTaskReference } from "../shared/agentCapabilities/taskReference";
import type { ExecutionContractV1, PlanCandidate } from "./executionContract";
import {
  buildMultiShotGateProjection,
  type MultiShotGateProjection,
  type ShotPrice,
} from "../productionRun/shotPricing";
import {
  candidateHasCharacterReference,
  modelSupportsReferenceImage,
  normalizeVideoCandidate,
  shotDurationSeconds,
  videoCandidateForPlan,
} from "./mcpGenerationVideoResolve";
import type { ProjectLeaseV2 } from "./projectLease";
import type { GenerationPlanningCallDependencies } from "./mcpGenerationTools";
import type { GenerationOperation } from "./generationOperationTypes";
import type { GenerationSealMultiShot } from "./mcpGenerationMultiShot";
import type { VideoModelCandidate } from "../shared/videoCapabilities/recommendation";
import { effectiveVideoModes } from "../shared/videoCapabilities/recommendation";
import type { resolveProviderReadiness } from "./mcpGenerationProviderReadiness";

export type ProviderReadinessResult = ReturnType<typeof resolveProviderReadiness>;

// J06 — 诚实 ETA：冷启动给区间（low/high），不再硬编 40/180s 点值。
// 历史 P50/P90 落盘后可切 etaBasis='historical'；当前全部为 coldstart。
// 基线（APIMart 生产 2026-09-03）：video 4-10min / image 10-60s / audio 15-90s。
const COLDSTART_ETA_BY_KIND: Record<string, { low: number; high: number }> = {
  video: { low: 240, high: 600 },
  image: { low: 10, high: 60 },
  audio: { low: 15, high: 90 },
  model3d: { low: 120, high: 300 },
};
const DEFAULT_BATCH_CONCURRENCY = 6;

/** J06 — shotCount × kind → { waitSeconds, waitSecondsHigh, etaBasis }. */
export function coldstartEtaForGate(
  outputKinds: readonly string[],
  shotCount: number,
  concurrency = 1,
): { waitSeconds: number; waitSecondsHigh: number; etaBasis: "coldstart" } {
  const primaryKind = outputKinds.find((k) => k === "video") ?? outputKinds[0] ?? "image";
  const { low, high } = COLDSTART_ETA_BY_KIND[primaryKind] ?? { low: 120, high: 360 };
  const rounds = Math.max(1, Math.ceil(Math.max(0, shotCount) / Math.max(1, Math.floor(concurrency))));
  return { waitSeconds: Math.round(low * rounds), waitSecondsHigh: Math.round(high * rounds), etaBasis: "coldstart" as const };
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

/** Human "provider · model（mode）" string for the card — the renderer never re-joins provider/model. */
function formatProviderModelText(
  candidate: PlanCandidate,
  videoModelCandidates: GenerationPlanningCallDependencies["videoModelCandidates"],
): string {
  const label = videoModelCandidates ? videoCandidateForPlan(candidate, videoModelCandidates)?.videoCandidate.label : undefined;
  const model = label || candidate.modelId;
  return candidate.mode ? `${candidate.providerId} · ${model}（${candidate.mode}）` : `${candidate.providerId} · ${model}`;
}

/**
 * P4 S4 — build the real multi-shot display.shots (the ASSEMBLY the S3a card was waiting on).
 * Projects the operation's INCLUDED video shots (anchors ride separately as chips) into the
 * serializable gate projection using the same S2 pricing/degradation single source of truth.
 * Returns undefined for a single-shot op.
 */
export function buildMultiShotGateProjectionFor(
  deps: GenerationPlanningCallDependencies,
  priceForCandidate: (candidate: PlanCandidate) => ShotPrice,
  operation: GenerationOperation,
  scope?: readonly string[],
): MultiShotGateProjection | undefined {
  if (!operation.shots || operation.shots.length === 0) return undefined;
  // 这一道门只盖这一次点到的那几镜：签进挑战里的展示就是它们，不是整份草稿。
  const filtered = scope ? operation.shots.filter((shot) => scope.includes(shot.shotId)) : operation.shots;
  const { rows: includedVideo, anchorChipShots: anchors } = gateRowsFor(filtered);
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
        providerModelText: formatProviderModelText(candidate, deps.videoModelCandidates),
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
}

function projectVideoModes(videoCandidate: VideoModelCandidate) {
  return effectiveVideoModes(videoCandidate).map((mode) => ({
    id: mode.id,
    intent: mode.intent,
    vendorTerm: mode.vendorTerm,
    transportTaskKind: mode.transportTaskKind,
    references: mode.slots.map((slot) => ({ kind: slot.kind, min: slot.min, max: slot.max, label: slot.label })),
    parameters: mode.params.map((parameter) => ({ key: parameter.key, type: parameter.type, options: parameter.options })),
  }));
}

export function handleContextQuery(deps: GenerationPlanningCallDependencies, lease: ProjectLeaseV2): unknown {
  if (deps.context) return deps.context({ projectId: lease.projectId, lease });
  const providerProfiles = (deps.registry.snapshot?.() ?? []).flatMap((manifest) => manifest.providers.map((provider) => ({
    providerId: provider.providerId,
    modelIds: provider.models.map((model) => model.modelId),
    modes: [...new Set(provider.models.flatMap((model) => model.modes))],
    capabilities: provider.models.map((model) => ({ modelId: model.modelId, ...model.capabilities })),
  })));
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
    projectId: lease.projectId,
    immutableProjectUuid: lease.immutableProjectUuid,
    projectGeneration: lease.projectGeneration,
    providerProfiles,
    ...(videoModels.length ? { videoModels } : {}),
    nextAction: "create",
  };
}

export function readinessReceiptFields(readiness: ProviderReadinessResult) {
  return {
    providerReady: readiness.providerReady,
    providerCapabilityProfile: readiness.providerCapabilityProfile,
    recoveryNotice: readiness.recoveryNotice,
    ...(readiness.providerCapabilitiesMissing.length ? { providerCapabilitiesMissing: readiness.providerCapabilitiesMissing } : {}),
  };
}

export function buildMultiShotGateReceipt(params: {
  sealed: GenerationOperation;
  operationId: string;
  projectId: string;
  contract: ExecutionContractV1;
  multiShotSeal: GenerationSealMultiShot | undefined;
  multiShot: MultiShotGateProjection;
  outputKinds: readonly string[];
  expiresAt: string;
  readiness: ProviderReadinessResult;
}): Record<string, unknown> {
  const { sealed, operationId, projectId, contract, multiShotSeal, multiShot, outputKinds, expiresAt, readiness } = params;
  const knownSubtotal = multiShot.shots.reduce((sum, shot) => (shot.price.known ? sum + shot.price.amount : sum), 0)
    + (multiShot.anchorChips ?? []).reduce((sum, chip) => (chip.price.known ? sum + chip.price.amount : sum), 0);
  const allUnknown = multiShot.shots.every((shot) => !shot.price.known);
  return {
    operation: sealed,
    operationId,
    projectId,
    // A multi-shot receipt is keyed on the PLAN hash (covers the whole batch — §1).
    contractHash: sealed.authorization?.digest ?? multiShotSeal?.planHash ?? contract.contractHash,
    model: `${contract.providerId}/${contract.modelId}`,
    referenceCount: contract.references.length,
    costScope: sealed.authorization?.envelope.costScope ?? `generation.multi-shot:${operationId}`,
    // 一批**全部**算不出价：没有任何已知金额可报，如实回 null（不是 0）。
    maximumCost: allUnknown ? null : sealed.authorization?.envelope.budget.maximum ?? knownSubtotal,
    costKnown: multiShot.shots.every((shot) => shot.price.known),
    unknownShotCount: multiShot.shots.reduce((count, shot) => (shot.price.known ? count : count + 1), 0),
    currency: "CNY",
    expiresAt,
    shotSummary: multiShot.shots[0]?.sceneOneLiner ?? contract.prompt.slice(0, 120),
    // The full projection rides here → dispatcher threads it into the MAC-signed challenge display.shots.
    // hardLimit = the estimated plan total (the natural ceiling shown on the card); the scheduler
    // enforces the real cap = min(this, policy.maxSpend) at reserve time (§3.3).
    shots: {
      ...multiShot,
      hardLimit: knownSubtotal,
      ...coldstartEtaForGate(outputKinds, multiShot.shots.length || 1, DEFAULT_BATCH_CONCURRENCY),
      frozenItems: ["shots", "models", "references", "price"],
      expiresAt,
    }, // J06 诚实 ETA
    ...readinessReceiptFields(readiness),
    nextAction: "confirm",
  };
}

export function buildSingleShotGateReceipt(params: {
  sealed: GenerationOperation;
  operationId: string;
  projectId: string;
  contract: ExecutionContractV1;
  price: ShotPrice;
  expiresAt: string;
  readiness: ProviderReadinessResult;
}): Record<string, unknown> {
  const { sealed, operationId, projectId, contract, price, expiresAt, readiness } = params;
  return {
    operation: sealed,
    operationId,
    projectId,
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
    ...readinessReceiptFields(readiness),
    nextAction: "confirm",
  };
}

export function handleReadOperation(
  deps: GenerationPlanningCallDependencies,
  current: GenerationOperation,
  lease: ProjectLeaseV2,
  operationId: string,
): unknown {
  // 结果未知的镜：executionState 仍是 submitted、看上去在等，Agent 会当成「在跑」而去 observe 或自己重新 generate。
  // 这里逐镜点名并把 nextAction 改成明确的话：让用户去服务商后台核对，不要再 generate（重复提交可能重复扣费）。
  const unknownShots = deps.unknownShotsOf?.(current, lease) ?? [];
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
  return {
    operation: current,
    taskRef: generationTaskReference(operationId),
    executionState: current.state === "draft" ? "not_started" : current.state,
    nextAction: current.state === "draft" ? "preview" : "observe",
  };
}
