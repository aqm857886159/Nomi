import type { PlanCandidate, ExecutionContractV1 } from "./executionContract";
import type { GenerationAuthorizationPreparation, GenerationOperation, GenerationOperationStore } from "./generationOperationTypes";
import type { LiveGenerationRegistry } from "./liveGenerationRuntime";
import type { AssertReferencesResolvable, GenerationSealMultiShot, StoryboardPlanResult } from "./mcpGenerationMultiShot";
import type { ProjectLeaseV2 } from "./projectLease";
import type { AssetReferenceIdentity } from "./semanticGenerationCandidate";
import type { ModelPricing } from "../productionRun/shotPricing";
import type { GenerationDefaultTaskKind } from "../settings/generationModelDefaultsContract";
import type {
  VideoGenerationRecommendationInput,
  VideoGenerationRecommendationResult,
  VideoModelCandidate,
} from "../shared/videoCapabilities/recommendation";

/** 准备授权时宿主拿到的东西。 */
export type GenerationPlanningAuthorizationInput = {
  lease: ProjectLeaseV2;
  operation: GenerationOperation;
  contract: ExecutionContractV1;
  multiShot?: GenerationSealMultiShot;
};

/**
 * 规划逻辑在**一次调用之内**用的依赖里，不带「宿主在调用里做的三件事」（准备授权 / 开拍 / 核对）的那一部分；
 * 目录那几样已经是这次调用入口取的那一版。三件事的签名住在 `mcpGenerationTools.ts`。
 */
export type GenerationPlanningCoreDependencies = {
  /** 这次调用的模型表（`GenerationCallCatalog.registry`）。起草 / 预览 / 过门读的都是这一份。 */
  registry: LiveGenerationRegistry;
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
  /** 这份操作对应的制作里，提交结果未知的镜（读任务状态时逐镜告诉 Agent 别再 generate）。缺省 = 读不到制作，不加这段。 */
  unknownShotsOf?: (operation: GenerationOperation, lease: ProjectLeaseV2) => readonly string[];
};

/** 目录给的那几样：宿主不许自己递，只能经 `catalog.openCall()` 一起来，保证同一版。 */
export type CatalogOwned = "registry" | "providerReadiness" | "videoModelCandidates" | "defaultModelForTaskKind" | "resolveModelPricing";

/** 一次调用之内的全部依赖。核对结果有哪几种由装配入口的签名定（`mcpGenerationTools.ts`），这里只收它。 */
export type GenerationPlanningCallDependenciesOf<Outcome extends string> = GenerationPlanningCoreDependencies & {
  prepareAuthorization?: (input: GenerationPlanningAuthorizationInput) => GenerationAuthorizationPreparation | Promise<GenerationAuthorizationPreparation>;
  start?: (operation: GenerationOperation, lease: ProjectLeaseV2) => unknown | Promise<unknown>;
  reconcile?: (operation: GenerationOperation, outcome: Outcome, lease: ProjectLeaseV2) => unknown | Promise<unknown>;
};
