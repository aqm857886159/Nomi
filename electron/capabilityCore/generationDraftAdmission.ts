/**
 * 起草准入：一份草稿落库之前，每一镜（多镜 / 文稿补镜 / 单镜）都过同一套检查——
 * 候选合成 → 归一 → 身份核对（模型 + 模式）→ 参数值。从 `mcpGenerationTools.ts` 拆出（文件体积冻结线），
 * 规则一条没变：首建、补镜头、单镜都调这里，不另写一台。
 *
 * 认名在合成器里经名字主人（`modelHandle.ts`）发生；`noteResolvedModelName` 只是把「这次不是一字不差
 * 落下的名字」交回给调用方装进回执，这里不判名字、不挑方式。
 */
import { admitPlanCandidate, type PlanCandidate } from "./executionContract";
import type { AssertReferencesResolvable, GenerationOperationDraftShot } from "./mcpGenerationMultiShot";
import { normalizeAuthoredCandidate, videoCompileOptions } from "./mcpGenerationVideoResolve";
import type { ModuleRegistry } from "./moduleRegistry";
import { admitShotIdentity, semanticCandidateFromParams, type AssetReferenceIdentity } from "./semanticGenerationCandidate";
import type { ResolvedModelName } from "../shared/agentCapabilities/modelHandle";
import type { VideoModelCandidate } from "../shared/videoCapabilities/recommendation";
import type { GenerationDefaultTaskKind } from "../settings/generationModelDefaultsContract";
import { referenceDemandForRole, type ReferenceDemand } from "../shared/canvas/edgeAdmission";

/** 同计划里 `storyboard.anchorIds` 引用的非文本锚点折算成参考输入需求（供显式 `modeId` 准入与改稿共用）。 */
export function anchorReferenceDemandsForShot(
  shot: Pick<GenerationOperationDraftShot, "storyboard"> | undefined,
  planShots: readonly GenerationOperationDraftShot[],
): ReferenceDemand[] {
  const anchorIds = shot?.storyboard?.anchorIds;
  if (!anchorIds?.length) return [];
  const anchorsById = new Map(
    planShots.filter((item) => item.role === "anchor").map((item) => [item.shotId, item] as const),
  );
  const demands: ReferenceDemand[] = [];
  for (const anchorId of anchorIds) {
    const anchor = anchorsById.get(anchorId);
    if (!anchor || anchor.storyboard?.carrier === "text") continue;
    const mode = anchor.candidate.mode.toLowerCase();
    const asset = mode.includes("audio") ? "audio" : mode.includes("video") ? "video" : "image";
    demands.push(referenceDemandForRole(undefined, asset));
  }
  return demands;
}

type DraftRegistry = Pick<ModuleRegistry, "resolve"> & Partial<Pick<ModuleRegistry, "snapshot">>;
type NoteResolvedModelName = (entry: ResolvedModelName) => void;

export type DraftAdmissionDependencies = {
  registry: DraftRegistry;
  videoModelCandidates?: readonly VideoModelCandidate[];
  defaultModelForTaskKind?: (taskKind: GenerationDefaultTaskKind) => { moduleId: string; providerId: string; modelId: string; mode: string } | undefined;
  assertReferencesResolvable?: AssertReferencesResolvable;
  resolveAssetReferenceIdentity?: (projectId: string, assetId: string) => AssetReferenceIdentity | undefined;
  candidateFrom: (value: unknown) => PlanCandidate;
  /** 多镜 / 文稿补镜的候选合成（`mcpGenerationMultiShot.ts` 的 `resolveCreateShots`）。 */
  resolveCreateShots: (
    projectId: string,
    params: Record<string, unknown>,
    registry: DraftRegistry,
    noteResolvedModelName?: NoteResolvedModelName,
  ) => Promise<GenerationOperationDraftShot[] | undefined>;
};

export function createDraftAdmission(deps: DraftAdmissionDependencies) {
  /**
   * 起草那一刻就过**确认时用的同一个** `compileParameters`（经 `admitPlanCandidate`，不另写一份校验）。
   * 2026-10-18：起草只核了「模型 + 模式」、不核参数值，坏参数（`seed: "abc"`）照样进草稿、出付费卡，
   * 点「生成」才在合同编译口被拒。现在草稿落库之前就判，拒绝是现有的结构化 ParameterRejection，模型当场能改对再交。
   */
  const admitDraftParameters = (candidate: PlanCandidate, registry: DraftRegistry): void => {
    admitPlanCandidate(candidate, registry, videoCompileOptions(candidate, deps.videoModelCandidates));
  };

  /** 起草的每一镜：同一套准入（候选合成 → 归一 → 身份核对 → 参数值）。首建与补镜头都过这一处，不另写一台。 */
  const admitDraftShots = async (
    projectId: string,
    params: Record<string, unknown>,
    registry: DraftRegistry = deps.registry,
    noteResolvedModelName?: NoteResolvedModelName,
    existingShots: readonly GenerationOperationDraftShot[] = [],
  ): Promise<GenerationOperationDraftShot[] | undefined> => {
    const draftShots = await deps.resolveCreateShots(projectId, params, registry, noteResolvedModelName);
    if (!draftShots) return undefined;
    const allShots = existingShots.length ? [...existingShots, ...draftShots] : draftShots;
    const normalizedShots = draftShots.map((shot) => ({
      ...shot,
      candidate: normalizeAuthoredCandidate(shot.candidate, registry, deps.videoModelCandidates, undefined, {
        extraReferenceDemands: anchorReferenceDemandsForShot(shot, allShots),
      }),
    }));
    // 每一镜的「模型 + 模式」落盘前就对过账：矛盾的镜头当场拒绝，不留到付费卡上点下去才发现（第 9 条）。
    for (const shot of normalizedShots) {
      admitShotIdentity(shot.candidate, registry, shot.role);
      admitDraftParameters(shot.candidate, registry);
    }
    return normalizedShots;
  };

  /** 单镜起草（一句话生成一张图）的准入。新建单镜草稿与「补一镜到这一请求的方案」共用。 */
  const admitSingleCandidate = (
    projectId: string,
    operationId: string,
    params: Record<string, unknown>,
    registry: DraftRegistry = deps.registry,
    noteResolvedModelName?: NoteResolvedModelName,
  ): PlanCandidate => {
    // A natural-language create request only needs `prompt`.  Keep the
    // explicit candidate path intact, but compile the short path at this
    // boundary so the model never has to invent internal candidate IDs or
    // provider wiring (the previous behavior surfaced as a false refusal).
    const singleCandidate = semanticCandidateFromParams({
      operationId,
      params,
      candidateFrom: deps.candidateFrom,
      ...(deps.defaultModelForTaskKind ? { defaultModelForTaskKind: deps.defaultModelForTaskKind } : {}),
      ...(registry.snapshot ? { registry } : {}),
      ...(deps.resolveAssetReferenceIdentity
        ? { resolveAssetReferenceIdentity: (assetId: string) => deps.resolveAssetReferenceIdentity!(projectId, assetId) }
        : {}),
      ...(noteResolvedModelName ? { noteResolvedModelName } : {}),
    });
    // P4 §5.1.4 锚复用授权面（单镜同守，P2 通用性）：单镜引用外来/不存在资产也当场拒——references 有三个入口，
    // 单镜 candidate 是其一，不能只堵多镜。多镜路已在 resolveCreateShots 内校验过。
    if (deps.assertReferencesResolvable && singleCandidate.references.length > 0) {
      deps.assertReferencesResolvable(projectId, singleCandidate.references);
    }
    const normalizedSingle = normalizeAuthoredCandidate(singleCandidate, registry, deps.videoModelCandidates);
    admitShotIdentity(normalizedSingle, registry);
    admitDraftParameters(normalizedSingle, registry);
    return normalizedSingle;
  };

  return { admitDraftShots, admitSingleCandidate };
}
