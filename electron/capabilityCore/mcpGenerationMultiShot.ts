import { refuseArgument } from "./transportFailure";
import { nextStoryboardSubjectIds, StoryboardSubjectIdentityError } from '../shared/storyboard/storyboardSubjectIdentity';
import { storyboardAuthorFieldsSchema, type StoryboardAuthorFields } from '../shared/agentCapabilities/generationPlanSchemas';
import { currentOfferFrom, resolveNamedGenerationShots, resolveUndecidedGenerationShotScope, type OfferOutcomeFacts } from '../shared/agentCapabilities/generationShotScope';
export {
  addShotsGuidance,
  extendStoryboardDesign,
  patchStoryboardAuthoring,
  presentStoryboardAuthoring,
  refuseIfStoryboardRejected,
  storyboardPlanFromDraftSubjects,
  storyboardSavedFact,
  storyboardSubjectsFromDrafts,
  upsertStoryboardDesign,
  type StoryboardExtendedFact,
  type StoryboardSavedFact,
} from './generationDocumentPlan';
// 能力核 · P4 S6.5 语义多镜 create 入口逻辑（从 mcpGenerationTools.ts 抽出，守 800 行门岗 R9）。
//
// 这份文件是「语义多镜生产入口」的单一职责家：把 `nomi_operation_create` 收到的 `shots`（client 逐镜计划）
// 或 `scriptText`（剧本，经 planStoryboard 拟镜）解析成草稿 shots；gate_request 时把草稿 shots 编译成逐镜
// 子合同 + planHash + shotPrices 的密封包（reducer 冻结整批 + seal 时硬上限）。纯逻辑 + 一个工厂（注入 deps
// 与共享函数），不碰 electron。mcpGenerationTools.ts 单向 import 本模块（无环）。
//
// P1：单镜 create/seal 路径不经本模块（handler 里 shots/scriptText 都缺省时直接走旧单镜路径，逐字节等同）。

import crypto from "node:crypto";

import { type ExecutionContractV1, type PlanCandidate } from "./executionContract";
import type { ModuleRegistry } from "./moduleRegistry";
import { generationShotEnvelopeOf, type GenerationShotEnvelope } from "../shared/generationShotEnvelope";
import type { GenerationDefaultTaskKind } from "../shared/contracts/generationModelDefaultsContract";
import {
  isLongFormGenerationRequest,
  requestedVideoDurationSeconds,
  semanticCandidateFromParams,
  type AssetReferenceIdentity,
  type SemanticGenerationCandidateDeps,
} from "./semanticGenerationCandidate";
import type { ShotPrice } from "../productionRun/shotPricing";
import type { ResolvedModelName } from "../shared/agentCapabilities/modelHandle";

/**
 * P4 S6.5 生产入口: a draft shot the multi-shot `create` entrance persists (candidate/role/included;
 * NO sub-contract — that is compiled at seal). This is what `plan`/`scriptText` create produces per shot.
 */
export type GenerationOperationDraftShot = Readonly<{
  shotId: string;
  role?: "anchor" | "shot";
  included?: boolean;
  /**
   * 模型拟的短标题。放在**信封**上而不是候选里：候选是「发给供应商的那一份」，标题一个字都不进
   * provider 请求；它是给人看的，随镜头走、改模型不丢。
   */
  title?: string;
  candidate: PlanCandidate;
  storyboard?: StoryboardAuthorFields;
}>;

/** A sealed shot within the multi-shot bundle (candidate + its compiled sub-contract). */
export type SealedMultiShotEntry = Readonly<{
  shotId: string;
  role?: "anchor" | "shot";
  included?: boolean;
  /** 模型拟的短标题（给人看，不进 provider 请求）。见 GenerationOperationDraftShot.title。 */
  title?: string;
  candidate: PlanCandidate;
  contract?: ExecutionContractV1;
}>;

/**
 * P4 S6.5: the sealed multi-shot bundle the handler hands the store at gate_request. Each included shot
 * carries its compiled sub-contract (its candidate.sealedContractHash matches, per reducer validation);
 * `planHash` freezes the whole batch; `shotPrices` (S2 derived) drives the reducer's seal-time hard cap.
 */
export type GenerationSealMultiShot = Readonly<{
  shots: ReadonlyArray<SealedMultiShotEntry>;
  /** 这一次封印盖的镜（卡上点到的那几镜）。其余的镜原样随行：没决定的不带合同，批过的带着它那一份。 */
  scope: readonly string[];
  planHash: string;
  // Shape matches the reducer's shotPricesFrom: [{ shotId, price: ShotPrice }].
  // ShotPrice is the canonical honest-unknown union (never a fabricated 0), shared with the
  // paid-gate precheck so assertKnownShotPrice can narrow it at the seal boundary.
  shotPrices?: ReadonlyArray<{ shotId: string; price: ShotPrice }>;
}>;

/**
 * P4 S6.5: what the storyboard planner returns for a `scriptText` create. Each shot is a partial candidate
 * declaration (the handler fills module/provider/model defaults + normalizes it into a full PlanCandidate).
 */
export type StoryboardShotDraft = Readonly<{
  shotId?: string;
  role?: "anchor" | "shot";
  included?: boolean;
  prompt: string;
  /** Planned duration for this provider clip (seconds). A long-form planner
   * must carry this through to the sealed candidate instead of pretending a
   * single provider clip can represent the whole requested movie. */
  durationSeconds?: number;
  moduleId?: string;
  providerId?: string;
  modelId?: string;
  mode?: string;
  modeId?: string;
  variantId?: string;
  parameters?: Record<string, unknown>;
  references?: ReadonlyArray<{ assetId: string; contentHash: string; version: number; kind?: "image" | "video" | "audio"; role?: "character" | "first_frame" | "last_frame" | "reference" | "audio" }>;
}>;

export type StoryboardPlanResult = Readonly<{
  shots: ReadonlyArray<StoryboardShotDraft>;
  /** Echo the requested total when the planner was given one. */
  targetDurationSeconds?: number;
}>;

const SHOT_ROLES = new Set(["anchor", "shot"]);

/**
 * P4 S6.5: validate a shot's role/included/shotId envelope. Shared by the `plan` and `scriptText` paths.
 * `assignedId` 是这一镜的身份：调用方自带的照收，没带的由分镜主体身份的唯一 owner 发
 * （`resolveCreateShots` 里一次发齐，见 `storyboardSubjectIdentity.ts`）。这里不再自己编号——
 * 它曾经拿「锚和镜混排数组里的位置」当兜底号，于是锚叫 shot-1、第一个镜头叫 shot-3。
 */
function shotEnvelope(raw: Record<string, unknown>, index: number, assignedId: string): GenerationShotEnvelope {
  const shotId = assignedId;
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(shotId)) refuseArgument(`Invalid shot id at ${index}`);
  const role = raw.role;
  if (role !== undefined && !SHOT_ROLES.has(String(role))) refuseArgument(`Invalid shot role at ${index}`);
  const included = raw.included;
  if (included !== undefined && typeof included !== "boolean") refuseArgument(`Invalid shot included flag at ${index}`);
  const rawTitle = typeof raw.title === "string" ? raw.title.trim() : "";
  if (rawTitle.length > 120) refuseArgument(`Shot title at ${index} is longer than 120 characters`);
  return {
    shotId,
    ...(role === undefined ? {} : { role: role as "anchor" | "shot" }),
    ...(included === undefined ? {} : { included }),
    ...(rawTitle ? { title: rawTitle } : {}),
  };
}

/** Injected candidate parsers (they live in mcpGenerationTools and are also used by the single-shot path). */
export type MultiShotCandidateParsers = {
  candidateFrom: (value: unknown) => PlanCandidate;
  record: (value: unknown, label: string) => Record<string, unknown>;
};

/**
 * P4 §5.1.4 锚复用入口的**授权面守门**：一个 candidate 的参考素材（复用锚 = 已有资产作 character 参考）必须
 * **存在于本项目且属于本项目**。`candidateFrom` 只做结构校验（assetId 是串…），不认「这资产真在这项目里吗」——
 * 外来/不存在的 assetId 会被静默放行、编进子合同、发给 provider（对抗矩阵 #3）。这个可选注入把「归属」这层补上：
 * App 层用真解析器（查 listProjectAssets / Run 自有 artifacts）接线；抛人话 Error 即拒。未注入 = 逐字节等同今天
 * （不给不 seed 资产的老测试/路径强加依赖）。纯契约（不耦合 projectAssetStore），本模块保持不碰 electron。
 */
export type AssertReferencesResolvable = (projectId: string, references: ReadonlyArray<PlanCandidate["references"][number]>) => void;

/**
 * P4 S6.5 `plan` 入口: parse one client-supplied shot into a draft shot.
 *
 * 一个镜可以**整只给 candidate**（PlanCandidate 原样，历史写法），也可以像单镜 create 那样只给语义字段
 * （`prompt` + 可选 `taskKind`/`modelId`/`modeId`/`parameters`/`references`）。两者都走
 * `semanticCandidateFromParams` ——它自己第一行就是「给了 candidate 就原样解析」，所以显式候选那条路逐字节
 * 不变；缺候选时由它按用户保存的默认模型合成，和单镜 create 同一台合成器、同一条报错。
 *
 * 为什么必须两种都收：单镜路早就修过这个毛病（`mcpGenerationTools.ts` 单镜分支的注释原话——「让模型不必去
 * 发明内部 candidate ID 和供应商接线，**之前的行为表现为一次假拒绝**」），但只修了 N=1 那个 arity。N≥2 这条
 * 仍然硬要 `candidate`，于是 lane 上的 `draft_shots` 一到多镜就被 zod 以 `Required` 拒掉——同一份镜头描述，
 * 一个镜收、两个镜拒。这里把那条不对称删掉，而不是再长一台合成器（P1）。
 *
 * `semantic` 不注入时行为仍然安全：显式 candidate 照常过，缺候选的镜头拿到带原因的拒收（`no_default_model`），
 * 而不是 zod 的 `Required`。
 *
 * 走同一台合成器还带来第二件事（2026-09-18 另一份根因合同的原话）：它「显式身份不借用默认模型的 mode」
 * 那条纪律，多镜路逐字继承——不是靠这里再抄一遍。
 */
export function draftShotFromPlan(
  value: unknown,
  index: number,
  assignedId: string,
  parsers: MultiShotCandidateParsers,
  semantic?: StoryboardSemanticDeps,
): GenerationOperationDraftShot {
  const raw = parsers.record(value, `generation shot ${index}`);
  const authored = raw.storyboard === undefined ? undefined : storyboardAuthorFieldsSchema.parse(raw.storyboard);
  const env = shotEnvelope(raw, index, assignedId);
  const candidate = semanticCandidateFromParams({
    // 逐镜 candidateId 跟着 shotId 走（与 `draftShotFromStoryboard` 同一约定），草稿改一镜不动其它镜。
    operationId: env.shotId,
    params: raw,
    candidateFrom: parsers.candidateFrom,
    ...(env.role === "anchor" ? { taskKindWhenUnstated: "text_to_image" as const } : {}),
    ...(semantic?.defaultModelForTaskKind ? { defaultModelForTaskKind: semantic.defaultModelForTaskKind } : {}),
    ...(semantic?.registry ? { registry: semantic.registry } : {}),
    ...(semantic?.allowRegistryFallback ? { allowRegistryFallback: semantic.allowRegistryFallback } : {}),
    ...(semantic?.resolveAssetReferenceIdentity ? { resolveAssetReferenceIdentity: semantic.resolveAssetReferenceIdentity } : {}),
    ...(semantic?.noteResolvedModelName ? { noteResolvedModelName: semantic.noteResolvedModelName } : {}),
  });
  return { ...env, candidate, ...(authored ? { storyboard: authored } : {}) };
}

/**
 * P4 S6.5 `scriptText` 入口: turn a planner shot draft into a full draft shot. The planner gives a prompt
 * (+ optional model/mode/refs, inherited from the request); the candidate is assembled by **the same**
 * semantic synthesizer as `shots` and single-shot create (`semanticCandidateFromParams`): the named model is
 * resolved by the one name owner, an unnamed shot takes the user's saved default, and the mode is left to the
 * one mode owner at normalization. 2026-11-17：这里以前逐字段补默认（连默认的 `modeId` 一起），点名别家时
 * 也把默认那家的方式带过去；夹具还有一个「取第一个视频候选」的逃生口——都删了，拟镜不再是第二台合成器。
 */
export function draftShotFromStoryboard(
  draft: StoryboardShotDraft,
  index: number,
  assignedId: string,
  taskKind: GenerationDefaultTaskKind,
  parsers: MultiShotCandidateParsers,
  semantic?: StoryboardSemanticDeps,
): GenerationOperationDraftShot {
  const raw = draft as Record<string, unknown>;
  const env = shotEnvelope(raw, index, assignedId);
  if (typeof draft.prompt !== "string" || !draft.prompt.trim()) refuseArgument(`Storyboard shot ${index} needs a prompt`);
  if (draft.durationSeconds !== undefined
    && (!Number.isFinite(draft.durationSeconds) || draft.durationSeconds <= 0)) {
    refuseArgument(`Storyboard shot ${index} has an invalid duration`);
  }
  const candidate = semanticCandidateFromParams({
    operationId: env.shotId,
    params: {
      prompt: draft.prompt,
      ...(draft.mode !== undefined ? { mode: draft.mode } : {}),
      ...(draft.moduleId !== undefined ? { moduleId: draft.moduleId } : {}),
      ...(draft.providerId !== undefined ? { providerId: draft.providerId } : {}),
      ...(draft.modelId !== undefined ? { modelId: draft.modelId } : {}),
      ...(draft.modeId !== undefined ? { modeId: draft.modeId } : {}),
      ...(draft.variantId !== undefined ? { variantId: draft.variantId } : {}),
      parameters: {
        ...(draft.parameters ?? {}),
        // `durationSeconds` is a planner-level name; provider contracts use the
        // canonical `duration` field. An explicitly supplied parameter remains
        // authoritative and is validated by the selected model schema at seal.
        ...(draft.durationSeconds !== undefined
          && (draft.parameters?.duration === undefined && draft.parameters?.durationSeconds === undefined)
          ? { duration: draft.durationSeconds }
          : {}),
      },
      references: draft.references ?? [],
    },
    candidateFrom: parsers.candidateFrom,
    // 这一镜的种类：规划器 / 请求写明的优先，否则按镜头角色与有没有参考定下的那一种（调用方给）。
    taskKindWhenUnstated: taskKind,
    ...(semantic?.defaultModelForTaskKind ? { defaultModelForTaskKind: semantic.defaultModelForTaskKind } : {}),
    ...(semantic?.registry ? { registry: semantic.registry } : {}),
    ...(semantic?.allowRegistryFallback ? { allowRegistryFallback: semantic.allowRegistryFallback } : {}),
    ...(semantic?.resolveAssetReferenceIdentity ? { resolveAssetReferenceIdentity: semantic.resolveAssetReferenceIdentity } : {}),
    ...(semantic?.noteResolvedModelName ? { noteResolvedModelName: semantic.noteResolvedModelName } : {}),
  });
  return { ...env, candidate };
}

/** 两条起草路（`shots` / `scriptText`）交给语义合成器的同一份依赖。 */
type StoryboardSemanticDeps = Pick<SemanticGenerationCandidateDeps, "defaultModelForTaskKind" | "registry" | "allowRegistryFallback" | "resolveAssetReferenceIdentity" | "noteResolvedModelName">;

/** The shared derivations the multi-shot factory needs (all pure, all single source of truth from S2/S4). */
export type MultiShotHelperDeps = {
  /** `resolve` 是密封期用的；`snapshot` 是语义合成期用的（缺省即不做目录兜底）。 */
  registry: Pick<ModuleRegistry, "resolve"> & Partial<Pick<ModuleRegistry, "snapshot">>;
  planStoryboard?: (input: {
    projectId: string;
    scriptText: string;
    /** Present when a natural-language goal was promoted to a long-form plan. */
    minimumShots?: number;
    /** Total duration parsed from the user's goal, when it was explicit. */
    targetDurationSeconds?: number;
  }) => StoryboardPlanResult | Promise<StoryboardPlanResult>;
  parsers: MultiShotCandidateParsers;
  normalizeVideoCandidate: (candidate: PlanCandidate) => PlanCandidate;
  /**
   * 编译一份执行合同。**故意不在这里自己调 `compileExecutionContract`**：参数表（含
   * `videoCompileOptions` 给的变体清单）与提示词投影必须和 preview／gate_request 那两次逐字一致，
   * 谁多写一份谁就是第二台发动机。由 `mcpGenerationTools` 的 `contractFor` 给唯一的那一个实现。
   */
  compileContract: (candidate: PlanCandidate, projectId: string) => ExecutionContractV1;
  priceForCandidate: (candidate: PlanCandidate) => ShotPrice;
  /**
   * Saved Workbench model preferences projected into the semantic planner.
   * Optional for isolated legacy fixtures; production wiring always supplies
   * the catalog-backed resolver so scriptText never silently picks row zero.
   */
  defaultModelForTaskKind?: SemanticGenerationCandidateDeps["defaultModelForTaskKind"];
  /** Unit-fixture escape hatch only; production requires a saved default or
   * explicit per-shot model identity. */
  allowRegistryFallback?: boolean;
  /** P4 §5.1.4: 校验复用锚（references）存在且属于本项目。未注入 = 不校验（向后兼容）。 */
  assertReferencesResolvable?: AssertReferencesResolvable;
  /** assetId → 可引用身份。与单镜路同一台解析器；未注入 = 只收已经带身份的参考。 */
  resolveAssetReferenceIdentity?: (projectId: string, assetId: string) => AssetReferenceIdentity | undefined;
};

/**
 * 一次起草的全部主体一次发齐身份（锚 `anchor-N`、镜头 `shot-N`，各数各的），号由分镜主体身份的唯一 owner 发。
 * 调用方自带的 id 照收，但锚不许占 `shot-N`、镜头不许占 `anchor-N`、同一份里不许重复——当场拒给模型。
 */
function hostAssignedSubjectIds(raw: readonly unknown[]): string[] {
  const incoming = raw.map((value) => {
    const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
      ...(record.role === "anchor" ? { role: "anchor" as const } : {}),
      ...(typeof record.shotId === "string" && record.shotId.trim() ? { shotId: record.shotId.trim() } : {}),
    };
  });
  try {
    return nextStoryboardSubjectIds({ anchors: [], shots: [] }, incoming);
  } catch (error) {
    if (error instanceof StoryboardSubjectIdentityError) refuseArgument(error.message);
    throw error;
  }
}

/** Minimal operation shape the seal helper reads (avoids importing the full GenerationOperation type). */
/** 封印读的那一份计划：批过的镜带着它那份合同（范围外的镜原样随行时要带上）。 */
type OperationWithShots = { candidate?: PlanCandidate; shots?: ReadonlyArray<GenerationOperationDraftShot & { contract?: ExecutionContractV1 }> };

/**
 * P4 S6.5: build the multi-shot create/seal helpers bound to `deps`. `resolveCreateShots` turns a create's
 * `shots`/`scriptText` into draft shots; `sealMultiShotFor` compiles the sealed bundle at gate_request.
 * Extracted from the handler closure to keep mcpGenerationTools.ts under the 800-line shell gate (R9).
 */
export function createMultiShotCreateHelpers(deps: MultiShotHelperDeps) {
  /** 两条起草路交给语义合成器的同一份依赖（`shots` 与 `scriptText` 不各配一份）。 */
  const semanticDeps = (
    projectId: string,
    registry: MultiShotHelperDeps["registry"],
    noteResolvedModelName: ((entry: ResolvedModelName) => void) | undefined,
  ): StoryboardSemanticDeps => ({
    ...(deps.defaultModelForTaskKind ? { defaultModelForTaskKind: deps.defaultModelForTaskKind } : {}),
    ...(registry.snapshot ? { registry } : {}),
    ...(deps.allowRegistryFallback ? { allowRegistryFallback: deps.allowRegistryFallback } : {}),
    ...(deps.resolveAssetReferenceIdentity
      ? { resolveAssetReferenceIdentity: (assetId: string) => deps.resolveAssetReferenceIdentity!(projectId, assetId) }
      : {}),
    ...(noteResolvedModelName ? { noteResolvedModelName } : {}),
  });

  /**
   * `params.shots` (client `plan` entrance) or `params.scriptText` (storyboard planner entrance) → draft
   * shots; neither → undefined (single-shot). Validation failures are human-readable (client-visible).
   * 2026-09-22 起**不再**要求至少一个非锚镜头：锚本身要生成、有价、会被 seal，「只有参考卡」是一条
   * 正常的中间状态（镜头随后补进同一份方案）。草稿上给一条安静提示，不拒绝。
   * `noteResolvedModelName`：点名的模型不是一字不差落下的，每认一次递一条（进 create 回执）。
   */
  const resolveCreateShots = async (
    projectId: string,
    params: Record<string, unknown>,
    registry: MultiShotHelperDeps["registry"] = deps.registry,
    noteResolvedModelName?: (entry: ResolvedModelName) => void,
  ): Promise<GenerationOperationDraftShot[] | undefined> => {
    const semantic = semanticDeps(projectId, registry, noteResolvedModelName);
    let shots: GenerationOperationDraftShot[];
    if (Array.isArray(params.shots)) {
      if (params.shots.length === 0) refuseArgument("多镜生成需要至少一个镜头");
      const ids = hostAssignedSubjectIds(params.shots);
      shots = [];
      const failures: Array<{ index: number; shotId: string; error: unknown }> = [];
      for (const [index, rawShot] of params.shots.entries()) {
        try {
          const built = draftShotFromPlan(rawShot, index, ids[index]!, deps.parsers, semantic);
          if (deps.assertReferencesResolvable && built.candidate.references.length > 0) {
            deps.assertReferencesResolvable(projectId, built.candidate.references);
          }
          shots.push(built);
        } catch (error) {
          failures.push({ index, shotId: ids[index]!, error });
        }
      }
      if (failures.length === 1) throw failures[0]!.error;
      if (failures.length > 1) {
        const detail = failures
          .map((item) => `shots[${item.index}] (${item.shotId}): ${item.error instanceof Error ? item.error.message : String(item.error)}`)
          .join("; ");
        refuseArgument(`${failures.length} shots failed validation (nothing was saved — fix all listed shots in one call): ${detail}`);
      }
      return shots;
    } else if (typeof params.scriptText === "string" || isLongFormGenerationRequest(params)) {
      // A minute-scale natural-language request must not silently collapse to
      // one provider clip. Promote it to the same storyboard seam as an
      // explicit scriptText request; the planner is still the sole owner of
      // script→shot semantics and model selection.
      const scriptText = typeof params.scriptText === "string"
        ? params.scriptText.trim()
        : typeof params.prompt === "string" ? params.prompt.trim() : "";
      if (!scriptText) refuseArgument("剧本文本为空，无法拟镜");
      if (!deps.planStoryboard) refuseArgument("当前未启用「剧本自动拟镜」，请改为直接提供逐镜计划（shots）");
      const longForm = typeof params.scriptText !== "string" && isLongFormGenerationRequest(params);
      const targetDurationSeconds = requestedVideoDurationSeconds(params);
      const board = await deps.planStoryboard({
        projectId,
        scriptText,
        ...(longForm ? { minimumShots: 2 } : {}),
        ...(targetDurationSeconds !== undefined ? { targetDurationSeconds } : {}),
      });
      if (!board || !Array.isArray(board.shots) || board.shots.length === 0) refuseArgument("拟镜没有产出任何镜头，请检查剧本内容");
      if (longForm && board.shots.length < 2) {
        refuseArgument("长视频请求必须先拆成至少两个镜头；请让 Agent 重新拟定剧本和分镜");
      }
      if (targetDurationSeconds !== undefined) {
        const durations = board.shots
          .filter((shot) => shot.role !== "anchor" && shot.included !== false)
          .map((shot) => shot.durationSeconds ?? shot.parameters?.duration ?? shot.parameters?.durationSeconds);
        const plannedDuration = durations.reduce((sum, value) => sum + (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0), 0);
        if (durations.length === 0 || durations.some((value) => typeof value !== "number" || !Number.isFinite(value) || value <= 0) || plannedDuration < targetDurationSeconds) {
          refuseArgument(`拟镜未覆盖目标时长 ${targetDurationSeconds} 秒；每个视频镜头必须带有效 duration`);
        }
      }
      // A natural-language multi-shot request can still carry the same model,
      // mode, references, and parameter choices as an explicit candidate. Keep
      // those user choices when expanding the request into shot drafts; the
      // planner only owns shot text/duration, while catalog normalization and
      // sealing continue to validate the inherited identity. Total-duration
      // fields are deliberately omitted from per-shot parameters once a target
      // was parsed: `duration: 5` in "5 minutes" is a clip hint, not permission
      // to shrink every planned shot back to five seconds.
      const explicit = {
        ...(typeof params.moduleId === "string" && params.moduleId.trim() ? { moduleId: params.moduleId.trim() } : {}),
        ...(typeof params.providerId === "string" && params.providerId.trim() ? { providerId: params.providerId.trim() } : {}),
        ...(typeof params.modelId === "string" && params.modelId.trim() ? { modelId: params.modelId.trim() } : {}),
        ...(typeof params.mode === "string" && params.mode.trim() ? { mode: params.mode.trim() } : {}),
        ...(typeof params.modeId === "string" && params.modeId.trim() ? { modeId: params.modeId.trim() } : {}),
        ...(typeof params.variantId === "string" && params.variantId.trim() ? { variantId: params.variantId.trim() } : {}),
      };
      const sharedParameters = params.parameters === undefined
        ? {}
        : deps.parsers.record(params.parameters, "generation parameters");
      const sharedReferences = params.references === undefined
        ? undefined
        : (() => {
          if (!Array.isArray(params.references)) refuseArgument("references must be an array");
          return params.references;
        })();
      const inheritedParameters = targetDurationSeconds === undefined
        ? sharedParameters
        : Object.fromEntries(Object.entries(sharedParameters).filter(([key]) => key !== "duration" && key !== "durationSeconds"));
      const ids = hostAssignedSubjectIds(board.shots);
      shots = board.shots.map((shot, index) => {
        const hasReferences = (shot.references ?? sharedReferences)?.length > 0;
        const requestedTaskKind = typeof params.taskKind === "string" ? params.taskKind.trim() : "";
        const taskKind: GenerationDefaultTaskKind = shot.role === "anchor"
          ? "text_to_image"
          : (requestedTaskKind === "image_to_video" || requestedTaskKind === "text_to_video"
            ? requestedTaskKind
            : (hasReferences ? "image_to_video" : "text_to_video"));
        const inherited = {
          ...shot,
          ...Object.fromEntries(Object.entries(explicit).filter(([key]) => shot[key as keyof StoryboardShotDraft] === undefined)),
          ...(shot.parameters || Object.keys(inheritedParameters).length > 0
            ? { parameters: { ...inheritedParameters, ...(shot.parameters ?? {}) } }
            : {}),
          ...(shot.references === undefined && sharedReferences !== undefined ? { references: sharedReferences } : {}),
        } as StoryboardShotDraft;
        return draftShotFromStoryboard(inherited, index, ids[index], taskKind, deps.parsers, semantic);
      });
    } else {
      return undefined;
    }
    for (const shot of shots) {
      // 镜头 id 重复、锚占镜号段：发号时（`hostAssignedSubjectIds`）已经拒过。
      // P4 §5.1.4 锚复用授权面：每个镜的参考素材（复用锚）必须存在且属于本项目（对抗矩阵 #3）。
      if (deps.assertReferencesResolvable && shot.candidate.references.length > 0) {
        deps.assertReferencesResolvable(projectId, shot.candidate.references);
      }
    }
    // 2026-09-22：原来这里拒绝「只有形象参考」的计划。拦的理由是投影管道（报价行按「非锚」筛），
    // 不是领域——锚本身有候选、有价，present/seal 的范围本来就含它。「先建参考卡、再补镜头」是正常路径
    // （用户 2026-09-21 亲自点名过这条报错）。放行；镜头补在**同一份**方案上（`extend`），不是再建一份。
    return shots;
  };

  /**
   * Compile the sealed multi-shot bundle from the sealed operation's draft shots. Each INCLUDED shot gets
   * its sub-contract (candidate.sealedContractHash set to match — reducer sealGenerationShots requires
   * this); excluded shots carry no sub-contract. planHash = a deterministic digest over the included +
   * anchor sub-contract hashes in order (covers the whole batch, §1). shotPrices = the S2 derived per-shot
   * prices so the reducer enforces the seal-time hard cap. Returns undefined for a single-shot op.
   */
  const sealMultiShotFor = (operation: OperationWithShots, projectId: string, scope: readonly string[]): GenerationSealMultiShot | undefined => {
    if (!operation.shots || operation.shots.length === 0) return undefined;
    const inScope = new Set(scope);
    const sealedShots: SealedMultiShotEntry[] = operation.shots.map((shot) => {
      const included = shot.included !== false;
      if (!included) return { ...generationShotEnvelopeOf(shot), included: false, candidate: shot.candidate };
      // 范围外：原样随行（批过的镜带着它那份合同，没决定的不带）——这一次不编译、不改它。
      if (!inScope.has(shot.shotId)) return { ...generationShotEnvelopeOf(shot), candidate: shot.candidate, ...(shot.contract ? { contract: shot.contract } : {}) };
      const normalized = deps.normalizeVideoCandidate(shot.candidate);
      const contract = deps.compileContract(normalized, projectId);
      return {
        ...generationShotEnvelopeOf(shot),
        candidate: { ...normalized, sealedContractHash: contract.contractHash },
        contract,
      };
    });
    // planHash covers every sealed unit (anchors + included video shots) in their declared order so the
    // plan-level receipt is bound to the exact batch (a shot add/remove/edit changes the hash → re-gate).
    const planHash = crypto.createHash("sha256")
      .update(sealedShots.filter((shot) => shot.contract && inScope.has(shot.shotId)).map((shot) => `${shot.shotId}:${shot.contract!.contractHash}`).join("|"))
      .digest("hex");
    const shotPrices = sealedShots
      .filter((shot) => shot.contract && inScope.has(shot.shotId))
      .map((shot) => { const price = deps.priceForCandidate(shot.candidate); return { shotId: shot.shotId, price: price.known ? { known: true as const, amount: price.amount } : { known: false as const } }; });
    return { shots: sealedShots, scope: [...scope], planHash, shotPrices };
  };

  return { resolveCreateShots, sealMultiShotFor };
}

/** 付费门的那几格：这一刻有没有一道在等人决定、盖着哪几镜（operation 视图上最近那一道）。 */
type GateScopeView = Readonly<{
  state: string;
  shots?: ReadonlyArray<Readonly<{ shotId: string; included?: boolean; contract?: unknown }>>;
  authorization?: Readonly<{ status: string; envelope: Readonly<{ jobs: ReadonlyArray<Readonly<{ shotId: string }>> }> }>;
  /** 宿主算的最近一次出价（开着或已关）的结局：不点名只封那张卡上还没定的镜。 */
  presentationOutcome?: OfferOutcomeFacts;
}>;

/** 这一次开门怎么做：复用手上那道（同一次点击的重试）/ 先撤一次没点完的那道再封 / 封这几镜。 */
export type GateScopeDecision =
  | Readonly<{ kind: "reuse"; scope?: readonly string[] }>
  | Readonly<{ kind: "abandon-then-seal" }>
  | Readonly<{ kind: "seal"; scope?: readonly string[] }>;

/**
 * 这一次付费门盖哪几镜（2026-09-30 付费卡逐镜：每点一次封一份，只盖那一次点到的镜）。
 *
 * - 单镜旧形态：只封一次；草稿以外（门在等 / 已在跑）复用手上那一道。它没有镜可点，点名就拒。
 * - 多镜：规则只有一条 `resolveUndecidedGenerationShotScope`（2026-10-27）——点名的（只认此刻还没封的镜）；
 *   不点名 = 最近一张卡（开着或已关）上还没定、也还没封的镜，从没出过价 = 勾进这一批、还没封过的全部；
 *   一镜不剩就拒，正文告诉外部宿主下一步（另起一份草稿），不再回退成「没封过的全部」。
 *   已经有一道门在等：盖的正好是这几镜（或没点名）→ 复用；盖的是别的镜 → 那是一次没点完的点击，先撤掉再封。
 */
export function resolveGateScope(operation: GateScopeView, requested: unknown): GateScopeDecision {
  const shots = operation.shots ?? [];
  if (shots.length === 0) {
    if (requested !== undefined) resolveNamedGenerationShots([], requested); // 单镜没有可点的镜：点名一律拒
    return operation.state === "draft" ? { kind: "seal" } : { kind: "reuse" };
  }
  const planShotIds = shots.map((shot) => shot.shotId);
  const waiting = operation.authorization?.status === "waiting"
    ? [...new Set(operation.authorization.envelope.jobs.map((job) => job.shotId))]
    : undefined;
  if (waiting) {
    const asked = requested === undefined ? undefined : resolveNamedGenerationShots(planShotIds, requested);
    if (!asked || (asked.length === waiting.length && asked.every((shotId) => waiting.includes(shotId)))) return { kind: "reuse", scope: waiting };
    return { kind: "abandon-then-seal" };
  }
  const open = shots.filter((shot) => shot.included !== false && !shot.contract).map((shot) => shot.shotId);
  return { kind: "seal", scope: resolveUndecidedGenerationShotScope({
    door: "gate", planShotIds, requested, currentOffer: currentOfferFrom(operation.presentationOutcome), offerable: open,
  }) };
}
