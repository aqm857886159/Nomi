// 能力核 · P4 S6.5 语义多镜 create 入口逻辑（从 mcpGenerationTools.ts 抽出，守 800 行门岗 R9）。
//
// 这份文件是「语义多镜生产入口」的单一职责家：把 `nomi_operation_create` 收到的 `shots`（client 逐镜计划）
// 或 `scriptText`（剧本，经 planStoryboard 拟镜）解析成草稿 shots；gate_request 时把草稿 shots 编译成逐镜
// 子合同 + planHash + shotPrices 的密封包（reducer 冻结整批 + seal 时硬上限）。纯逻辑 + 一个工厂（注入 deps
// 与共享函数），不碰 electron。mcpGenerationTools.ts 单向 import 本模块（无环）。
//
// P1：单镜 create/seal 路径不经本模块（handler 里 shots/scriptText 都缺省时直接走旧单镜路径，逐字节等同）。

import crypto from "node:crypto";

import { compileExecutionContract, type ExecutionContractV1, type PlanCandidate } from "./executionContract";
import type { ModuleRegistry } from "./moduleRegistry";
import type { ParameterField } from "./moduleManifest";
import type { VideoModelCandidate } from "../shared/videoCapabilities/recommendation";
import { SINGLE_SHOT_GENERATION_MODULE_ID } from "../shared/generationModuleId";
import type { GenerationDefaultTaskKind } from "../settings/generationModelDefaultsContract";
import {
  isLongFormGenerationRequest,
  requestedVideoDurationSeconds,
} from "./semanticGenerationCandidate";
import type { ShotPrice } from "../productionRun/shotPricing";

/**
 * P4 S6.5 生产入口: a draft shot the multi-shot `create` entrance persists (candidate/role/included;
 * NO sub-contract — that is compiled at seal). This is what `plan`/`scriptText` create produces per shot.
 */
export type GenerationOperationDraftShot = Readonly<{
  shotId: string;
  role?: "anchor" | "shot";
  included?: boolean;
  candidate: PlanCandidate;
}>;

/** A sealed shot within the multi-shot bundle (candidate + its compiled sub-contract). */
export type SealedMultiShotEntry = Readonly<{
  shotId: string;
  role?: "anchor" | "shot";
  included?: boolean;
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

/** P4 S6.5: validate a shot's role/included/shotId envelope. Shared by the `plan` and `scriptText` paths. */
function shotEnvelope(raw: Record<string, unknown>, index: number, fallbackId: string): { shotId: string; role?: "anchor" | "shot"; included?: boolean } {
  const rawShotId = typeof raw.shotId === "string" ? raw.shotId.trim() : "";
  const shotId = rawShotId || fallbackId;
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(shotId)) throw new Error(`Invalid shot id at ${index}`);
  const role = raw.role;
  if (role !== undefined && !SHOT_ROLES.has(String(role))) throw new Error(`Invalid shot role at ${index}`);
  const included = raw.included;
  if (included !== undefined && typeof included !== "boolean") throw new Error(`Invalid shot included flag at ${index}`);
  return { shotId, ...(role === undefined ? {} : { role: role as "anchor" | "shot" }), ...(included === undefined ? {} : { included }) };
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
 * P4 S6.5 `plan` 入口: parse one client-supplied shot `{ shotId?, role?, included?, candidate }` into a
 * draft shot. The candidate is a FULL PlanCandidate (same shape single-shot create takes) — reusing
 * `candidateFrom` means the `plan` entrance shares the single-shot validation (no second parser).
 */
export function draftShotFromPlan(value: unknown, index: number, parsers: MultiShotCandidateParsers): GenerationOperationDraftShot {
  const raw = parsers.record(value, `generation shot ${index}`);
  const env = shotEnvelope(raw, index, `shot-${index + 1}`);
  const candidate = parsers.candidateFrom(raw.candidate);
  return { ...env, candidate };
}

/**
 * P4 S6.5 `scriptText` 入口: turn a planner shot draft into a full draft shot. The planner gives a prompt
 * (+ optional model/mode/refs); the handler fills module/provider/model defaults from the first configured
 * video candidate (single-provider v1 = APIMart). candidateId/revision are synthesized (draft-stable).
 */
export function draftShotFromStoryboard(draft: StoryboardShotDraft, index: number, defaults: () => { moduleId: string; providerId: string; modelId: string; mode: string; modeId?: string }, parsers: MultiShotCandidateParsers): GenerationOperationDraftShot {
  const raw = draft as Record<string, unknown>;
  const env = shotEnvelope(raw, index, `shot-${index + 1}`);
  if (typeof draft.prompt !== "string" || !draft.prompt.trim()) throw new Error(`Storyboard shot ${index} needs a prompt`);
  if (draft.durationSeconds !== undefined
    && (!Number.isFinite(draft.durationSeconds) || draft.durationSeconds <= 0)) {
    throw new Error(`Storyboard shot ${index} has an invalid duration`);
  }
  // Resolve module/provider/model/mode defaults lazily — only when the planner left a field unset, so a
  // fully-specified board never requires a configured video model just to build defaults it won't use.
  const needsDefaults = draft.moduleId === undefined || draft.providerId === undefined || draft.modelId === undefined || draft.mode === undefined;
  const fallback = needsDefaults ? defaults() : { moduleId: "", providerId: "", modelId: "", mode: "" };
  const selectedModeId = draft.modeId ?? fallback.modeId;
  const candidate = parsers.candidateFrom({
    candidateId: `cand-${env.shotId}`,
    revision: 1,
    moduleId: draft.moduleId ?? fallback.moduleId,
    providerId: draft.providerId ?? fallback.providerId,
    modelId: draft.modelId ?? fallback.modelId,
    ...(selectedModeId ? { modeId: selectedModeId } : {}),
    ...(draft.variantId ? { variantId: draft.variantId } : {}),
    mode: draft.mode ?? fallback.mode,
    prompt: draft.prompt,
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
  });
  return { ...env, candidate };
}

/** The shared derivations the multi-shot factory needs (all pure, all single source of truth from S2/S4). */
export type MultiShotHelperDeps = {
  registry: Pick<ModuleRegistry, "resolve">;
  videoModelCandidates?: readonly VideoModelCandidate[];
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
  videoParameterSchema: (candidate: PlanCandidate) => Record<string, ParameterField> | undefined;
  priceForCandidate: (candidate: PlanCandidate) => ShotPrice;
  effectiveVideoModes: (candidate: VideoModelCandidate) => Array<{ id?: string; transportTaskKind?: string }>;
  /**
   * Saved Workbench model preferences projected into the semantic planner.
   * Optional for isolated legacy fixtures; production wiring always supplies
   * the catalog-backed resolver so scriptText never silently picks row zero.
   */
  defaultModelForTaskKind?: (taskKind: GenerationDefaultTaskKind) => {
    moduleId: string;
    providerId: string;
    modelId: string;
    mode: string;
    modeId?: string;
  } | undefined;
  /** Unit-fixture escape hatch only; production requires a saved default or
   * explicit per-shot model identity. */
  allowRegistryFallback?: boolean;
  /** P4 §5.1.4: 校验复用锚（references）存在且属于本项目。未注入 = 不校验（向后兼容）。 */
  assertReferencesResolvable?: AssertReferencesResolvable;
};

/** Minimal operation shape the seal helper reads (avoids importing the full GenerationOperation type). */
type OperationWithShots = { shots?: ReadonlyArray<GenerationOperationDraftShot> };

/**
 * P4 S6.5: build the multi-shot create/seal helpers bound to `deps`. `resolveCreateShots` turns a create's
 * `shots`/`scriptText` into draft shots; `sealMultiShotFor` compiles the sealed bundle at gate_request.
 * Extracted from the handler closure to keep mcpGenerationTools.ts under the 800-line shell gate (R9).
 */
export function createMultiShotCreateHelpers(deps: MultiShotHelperDeps) {
  const storyboardDefaults = (taskKind: GenerationDefaultTaskKind): { moduleId: string; providerId: string; modelId: string; mode: string; modeId?: string } => {
    const configured = deps.defaultModelForTaskKind?.(taskKind);
    if (configured) return configured;
    if (!deps.allowRegistryFallback) {
      throw new Error("没有配置该任务的默认视频模型，请先在设置中选择模型或在计划中指定模型");
    }
    const first = deps.videoModelCandidates?.[0];
    if (!first) throw new Error("没有可用的视频模型，无法从剧本自动拟镜（请先在 Nomi 配置一个视频模型）");
    const selectedMode = deps.effectiveVideoModes(first).find((item) => item.transportTaskKind === taskKind)
      ?? deps.effectiveVideoModes(first)[0];
    const mode = selectedMode?.transportTaskKind ?? "image-to-video";
    return { moduleId: SINGLE_SHOT_GENERATION_MODULE_ID, providerId: first.provider, modelId: first.modelKey, mode, ...(selectedMode?.id ? { modeId: selectedMode.id } : {}) };
  };

  /**
   * `params.shots` (client `plan` entrance) or `params.scriptText` (storyboard planner entrance) → draft
   * shots; neither → undefined (single-shot). Validation failures are human-readable (client-visible).
   * Enforces ≥1 video shot so a pure-anchor plan (nothing to render) is rejected up front.
   */
  const resolveCreateShots = async (projectId: string, params: Record<string, unknown>): Promise<GenerationOperationDraftShot[] | undefined> => {
    let shots: GenerationOperationDraftShot[];
    if (Array.isArray(params.shots)) {
      if (params.shots.length === 0) throw new Error("多镜生成需要至少一个镜头");
      shots = params.shots.map((shot, index) => draftShotFromPlan(shot, index, deps.parsers));
    } else if (typeof params.scriptText === "string" || isLongFormGenerationRequest(params)) {
      // A minute-scale natural-language request must not silently collapse to
      // one provider clip. Promote it to the same storyboard seam as an
      // explicit scriptText request; the planner is still the sole owner of
      // script→shot semantics and model selection.
      const scriptText = typeof params.scriptText === "string"
        ? params.scriptText.trim()
        : typeof params.prompt === "string" ? params.prompt.trim() : "";
      if (!scriptText) throw new Error("剧本文本为空，无法拟镜");
      if (!deps.planStoryboard) throw new Error("当前未启用「剧本自动拟镜」，请改为直接提供逐镜计划（shots）");
      const longForm = typeof params.scriptText !== "string" && isLongFormGenerationRequest(params);
      const targetDurationSeconds = requestedVideoDurationSeconds(params);
      const board = await deps.planStoryboard({
        projectId,
        scriptText,
        ...(longForm ? { minimumShots: 2 } : {}),
        ...(targetDurationSeconds !== undefined ? { targetDurationSeconds } : {}),
      });
      if (!board || !Array.isArray(board.shots) || board.shots.length === 0) throw new Error("拟镜没有产出任何镜头，请检查剧本内容");
      if (longForm && board.shots.length < 2) {
        throw new Error("长视频请求必须先拆成至少两个镜头；请让 Agent 重新拟定剧本和分镜");
      }
      if (targetDurationSeconds !== undefined) {
        const durations = board.shots
          .filter((shot) => shot.role !== "anchor" && shot.included !== false)
          .map((shot) => shot.durationSeconds ?? shot.parameters?.duration ?? shot.parameters?.durationSeconds);
        const plannedDuration = durations.reduce((sum, value) => sum + (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0), 0);
        if (durations.length === 0 || durations.some((value) => typeof value !== "number" || !Number.isFinite(value) || value <= 0) || plannedDuration < targetDurationSeconds) {
          throw new Error(`拟镜未覆盖目标时长 ${targetDurationSeconds} 秒；每个视频镜头必须带有效 duration`);
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
          if (!Array.isArray(params.references)) throw new Error("references must be an array");
          return params.references;
        })();
      const inheritedParameters = targetDurationSeconds === undefined
        ? sharedParameters
        : Object.fromEntries(Object.entries(sharedParameters).filter(([key]) => key !== "duration" && key !== "durationSeconds"));
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
        return draftShotFromStoryboard(inherited, index, () => storyboardDefaults(taskKind), deps.parsers);
      });
    } else {
      return undefined;
    }
    const ids = new Set<string>();
    for (const shot of shots) {
      if (ids.has(shot.shotId)) throw new Error(`镜头 id 重复：${shot.shotId}`);
      ids.add(shot.shotId);
      // P4 §5.1.4 锚复用授权面：每个镜的参考素材（复用锚）必须存在且属于本项目（对抗矩阵 #3）。
      if (deps.assertReferencesResolvable && shot.candidate.references.length > 0) {
        deps.assertReferencesResolvable(projectId, shot.candidate.references);
      }
    }
    if (!shots.some((shot) => shot.role !== "anchor")) throw new Error("多镜计划至少需要一个视频镜头（不能只有形象参考）");
    return shots;
  };

  /**
   * Compile the sealed multi-shot bundle from the sealed operation's draft shots. Each INCLUDED shot gets
   * its sub-contract (candidate.sealedContractHash set to match — reducer sealGenerationShots requires
   * this); excluded shots carry no sub-contract. planHash = a deterministic digest over the included +
   * anchor sub-contract hashes in order (covers the whole batch, §1). shotPrices = the S2 derived per-shot
   * prices so the reducer enforces the seal-time hard cap. Returns undefined for a single-shot op.
   */
  const sealMultiShotFor = (operation: OperationWithShots): GenerationSealMultiShot | undefined => {
    if (!operation.shots || operation.shots.length === 0) return undefined;
    const sealedShots: SealedMultiShotEntry[] = operation.shots.map((shot) => {
      const included = shot.included !== false;
      if (!included) return { shotId: shot.shotId, ...(shot.role ? { role: shot.role } : {}), included: false, candidate: shot.candidate };
      const normalized = deps.normalizeVideoCandidate(shot.candidate);
      const contract = compileExecutionContract(normalized, deps.registry, { parameterSchema: deps.videoParameterSchema(normalized) });
      return {
        shotId: shot.shotId,
        ...(shot.role ? { role: shot.role } : {}),
        ...(shot.included !== undefined ? { included: shot.included } : {}),
        candidate: { ...normalized, sealedContractHash: contract.contractHash },
        contract,
      };
    });
    // planHash covers every sealed unit (anchors + included video shots) in their declared order so the
    // plan-level receipt is bound to the exact batch (a shot add/remove/edit changes the hash → re-gate).
    const planHash = crypto.createHash("sha256")
      .update(sealedShots.filter((shot) => shot.contract).map((shot) => `${shot.shotId}:${shot.contract!.contractHash}`).join("|"))
      .digest("hex");
    const shotPrices = sealedShots
      .filter((shot) => shot.contract)
      .map((shot) => { const price = deps.priceForCandidate(shot.candidate); return { shotId: shot.shotId, price: price.known ? { known: true as const, amount: price.amount } : { known: false as const } }; });
    return { shots: sealedShots, planHash, shotPrices };
  };

  return { resolveCreateShots, sealMultiShotFor };
}
