// 能力核 · 视频模型解析纯函数（从 mcpGenerationTools.ts 抽出，守 800 行门岗 R9）。
//
// 这份文件把「一份 PlanCandidate ↔ 目录里的视频模型档案」的解析逻辑集中成一处：按 provider/model(+variant)
// 定位视频候选、归一 candidate 的 modelKey/variantId、把模式参数投影成 ParameterField schema、判模型有无参考图
// 槽 / candidate 带不带角色参考 / 时长估计。全是纯函数（吃 candidate + 候选快照，零副作用、零 provider 调用），
// preview/gate/多镜密封都靠它当单一真相源。mcpGenerationTools.ts 与 mcpGenerationMultiShot.ts 单向 import。

import type { PlanCandidate } from "./executionContract";
import type { ParameterField } from "./moduleManifest";
import type {
  VideoGenerationRecommendationInput,
  VideoModelCandidate,
} from "../shared/videoCapabilities/recommendation";
import { canonicalVideoVariantId, effectiveVideoModes, recommendVideoGeneration } from "../shared/videoCapabilities/recommendation";
import { modeTransportFor } from "../shared/videoCapabilities/modeTransport";
import type { ArchetypeMode, ModelParameterControl } from "../shared/videoCapabilities/types";

// Keep mode/task comparisons tolerant of the wire's kebab/snake aliases.  This
// local normalizer is intentionally dependency-free so candidate resolution
// cannot accidentally call a provider-specific helper (or an undefined symbol).
const normalizedMode = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase().replace(/-/g, "_") : "";

const CAMERA_INTENTS = new Set<NonNullable<VideoGenerationRecommendationInput["cameraIntent"]>>([
  "locked", "pan", "tilt", "dolly", "orbit", "handheld", "path",
]);

export function videoRecommendationInput(candidate: PlanCandidate): VideoGenerationRecommendationInput | null {
  if (candidate.references.some((reference) => !reference.kind)) return null;
  const parameters = candidate.parameters;
  const durationSeconds = typeof parameters.duration === "number"
    ? parameters.duration
    : typeof parameters.durationSeconds === "number" ? parameters.durationSeconds : undefined;
  const aspectRatio = typeof parameters.aspectRatio === "string"
    ? parameters.aspectRatio
    : typeof parameters.aspect_ratio === "string" ? parameters.aspect_ratio
      : typeof parameters.size === "string" ? parameters.size : undefined;
  const quality = parameters.quality === "draft" || parameters.quality === "balanced" || parameters.quality === "final"
    ? parameters.quality
    : undefined;
  const cameraIntent = typeof parameters.cameraIntent === "string" && CAMERA_INTENTS.has(parameters.cameraIntent as NonNullable<VideoGenerationRecommendationInput["cameraIntent"]>)
    ? parameters.cameraIntent as NonNullable<VideoGenerationRecommendationInput["cameraIntent"]>
    : undefined;
  const goals: NonNullable<VideoGenerationRecommendationInput["goals"]> = {
    ...(typeof parameters.preserveCharacter === "boolean" ? { preserveCharacter: parameters.preserveCharacter } : {}),
    ...(typeof parameters.preserveTransition === "boolean" ? { preserveTransition: parameters.preserveTransition } : {}),
    ...(typeof parameters.useReferenceAudio === "boolean" ? { useReferenceAudio: parameters.useReferenceAudio } : {}),
    ...(typeof parameters.generate_audio === "boolean" ? { generateAudio: parameters.generate_audio } : {}),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...(aspectRatio === undefined ? {} : { aspectRatio }),
    ...(quality === undefined ? {} : { quality }),
  };
  return {
    prompt: candidate.prompt,
    references: candidate.references.map((reference) => ({ kind: reference.kind!, role: reference.role })),
    ...(cameraIntent === undefined ? {} : { cameraIntent }),
    ...(typeof parameters.preferredFamily === "string" ? { preferredFamily: parameters.preferredFamily } : {}),
    ...(Object.keys(goals).length === 0 ? {} : { goals }),
  };
}

export const normalizedModelIdentity = (value: string): string => value.trim().toLowerCase();

/**
 * P4 S2: a shot's duration estimate in seconds from its selected parameters, or undefined when it
 * cannot be honestly estimated (plan §9: "估不出的诚实标未知"). Reads the same duration keys the
 * recommendation input reads (duration / durationSeconds), so the estimate matches the sealed request.
 */
export function shotDurationSeconds(candidate: Pick<PlanCandidate, "parameters">): number | undefined {
  const parameters = candidate.parameters ?? {};
  if (typeof parameters.duration === "number" && Number.isFinite(parameters.duration) && parameters.duration >= 0) return parameters.duration;
  if (typeof parameters.durationSeconds === "number" && Number.isFinite(parameters.durationSeconds) && parameters.durationSeconds >= 0) return parameters.durationSeconds;
  return undefined;
}

/**
 * P4 S2: whether the selected video model exposes a reference-image channel (a mode slot that accepts
 * image references). Used to flag the "该模型认不了脸" degradation for character shots on models with
 * no image-reference slot. When the model is not a known video candidate we cannot prove absence, so we
 * assume support (no false degradation warning).
 */
const IMAGE_REFERENCE_SLOT_KINDS = new Set(["image_ref", "first_frame", "last_frame"]);

export function modelSupportsReferenceImage(candidate: PlanCandidate, candidates: readonly VideoModelCandidate[] | undefined): boolean {
  const selected = candidates ? videoCandidateForPlan(candidate, candidates) : null;
  if (!selected) return true;
  return effectiveVideoModes(selected.videoCandidate).some((mode) => mode.slots.some((slot) => IMAGE_REFERENCE_SLOT_KINDS.has(slot.kind)));
}

/** P4 S2: whether the candidate carries a character reference (role=character), i.e. a face to preserve. */
export function candidateHasCharacterReference(candidate: PlanCandidate): boolean {
  return candidate.references.some((reference) => reference.role === "character");
}

/**
 * Keep recommendations anchored to the model the user currently selected in
 * the GUI/MCP plan. The catalog may contain aliases for a model family, so an
 * exact catalog key wins before falling back to source-declared identifiers.
 * If the selected model is not in the catalog yet (for example, a provider
 * fixture or a newly configured adapter), preserve the existing cross-catalog
 * fallback rather than making preview unusable.
 */
export function candidatesForCurrentVideoModel(
  candidate: PlanCandidate,
  candidates: readonly VideoModelCandidate[],
): readonly VideoModelCandidate[] {
  const providerCandidates = candidates.filter((item) => normalizedModelIdentity(item.provider) === normalizedModelIdentity(candidate.providerId));
  const modelId = normalizedModelIdentity(candidate.modelId);
  const variantsFor = (item: VideoModelCandidate) => item.archetype.variants ?? [];
  const variantForModelId = (item: VideoModelCandidate) => variantsFor(item).find((variant) =>
    normalizedModelIdentity(variant.modelKey) === modelId
      || (variant.identifierPatterns ?? []).some((identity) => normalizedModelIdentity(identity) === modelId),
  );
  const exactMatches = providerCandidates.filter((item) => normalizedModelIdentity(item.modelKey) === modelId || Boolean(variantForModelId(item)));
  const aliasMatches = providerCandidates.filter((item) => item.archetype.identifierPatterns
    .some((identity) => normalizedModelIdentity(identity) === modelId)
    || variantsFor(item).some((variant) => (variant.identifierPatterns ?? [])
      .some((identity) => normalizedModelIdentity(identity) === modelId)));
  const scoped = exactMatches.length > 0 ? exactMatches : aliasMatches;
  const selectedVariantId = (item: VideoModelCandidate): string | undefined => {
    const requested = typeof candidate.variantId === "string" ? candidate.variantId.trim() : "";
    const requestedCanonical = canonicalVideoVariantId(item.archetype, requested);
    return requestedCanonical || variantForModelId(item)?.id || item.variantId;
  };
  if (scoped.length > 0) return scoped.map((item) => ({ ...item, ...(selectedVariantId(item) ? { variantId: selectedVariantId(item) } : {}) }));
  return providerCandidates.length > 0 ? providerCandidates : candidates;
}

export function videoCandidateForPlan(candidate: PlanCandidate, candidates: readonly VideoModelCandidate[]): { candidate: PlanCandidate; videoCandidate: VideoModelCandidate } | null {
  const provider = normalizedModelIdentity(candidate.providerId);
  const modelId = normalizedModelIdentity(candidate.modelId);
  const source = candidates.find((item) => normalizedModelIdentity(item.provider) === provider && (
    normalizedModelIdentity(item.modelKey) === modelId
      || (item.archetype.variants ?? []).some((variant) => normalizedModelIdentity(variant.modelKey) === modelId
        || (variant.identifierPatterns ?? []).some((identity) => normalizedModelIdentity(identity) === modelId))
  ));
  if (!source) return null;
  const inferredVariant = (source.archetype.variants ?? []).find((variant) => normalizedModelIdentity(variant.modelKey) === modelId
    || (variant.identifierPatterns ?? []).some((identity) => normalizedModelIdentity(identity) === modelId));
  const requested = typeof candidate.variantId === "string" ? candidate.variantId.trim() : "";
  const requestedCanonical = canonicalVideoVariantId(source.archetype, requested);
  if (requested && !requestedCanonical) throw new Error(`Unknown video variant: ${candidate.variantId}`);
  const variantId = requestedCanonical ?? inferredVariant?.id ?? source.variantId ?? source.archetype.defaultVariantId;
  const baseModelId = source.archetype.catalogModelKey?.trim() || source.modelKey;
  return {
    candidate: { ...candidate, modelId: baseModelId, ...(variantId ? { variantId } : {}) },
    videoCandidate: { ...source, ...(variantId ? { variantId } : {}) },
  };
}

const normalizedTaskKind = (value: unknown): string => normalizedMode(value);

/**
 * Resolve the source-archetype mode without guessing a provider wire mode.
 * Several real models (Seedance, Wan, H3) expose multiple modes through the
 * same catalog task kind. A persisted `modeId` is authoritative; when older
 * drafts only carry the task kind, references/recommendation facts select a
 * mode. If the facts are insufficient we fail closed and ask for modeId.
 */
export function videoModeForPlan(candidate: PlanCandidate, videoCandidate: VideoModelCandidate): ArchetypeMode {
  const modes = effectiveVideoModes(videoCandidate);
  const requestedModeId = typeof candidate.modeId === "string" ? candidate.modeId.trim() : "";
  if (requestedModeId) {
    const mode = modes.find((item) => normalizedMode(item.id) === normalizedMode(requestedModeId));
    if (!mode) throw new Error(`Unknown video mode: ${candidate.modeId}`);
    const requestedTransport = normalizedTaskKind(candidate.mode);
    if (requestedTransport && requestedTransport !== normalizedMode(mode.id) && requestedTransport !== normalizedTaskKind(mode.transportTaskKind)) {
      throw new Error(`Video mode ${candidate.modeId} does not match transport task ${candidate.mode}`);
    }
    return mode;
  }

  const byId = modes.find((item) => normalizedMode(item.id) === normalizedMode(candidate.mode));
  if (byId) return byId;
  const byTask = modes.filter((item) => normalizedTaskKind(item.transportTaskKind) === normalizedTaskKind(candidate.mode));
  if (byTask.length === 1) return byTask[0]!;
  if (byTask.length === 0) throw new Error(`Video mode is unsupported: ${candidate.mode}`);

  // Legacy drafts may not have modeId. Use the same recommendation facts as
  // preview, but only among modes that actually share this transport task.
  const recommendationInput = videoRecommendationInput(candidate);
  if (recommendationInput) {
    const recommended = recommendVideoGeneration(recommendationInput, [videoCandidate]).recommendations;
    const selected = recommended.find((item) => byTask.some((mode) => normalizedMode(mode.id) === normalizedMode(item.modeId)));
    if (selected) return byTask.find((mode) => normalizedMode(mode.id) === normalizedMode(selected.modeId))!;
  }

  // A mode with no reference requirements is a safe default only when the
  // archetype explicitly declares it as the default for this task kind.
  const declaredDefault = modes.find((mode) => normalizedMode(mode.id) === normalizedMode(videoCandidate.archetype.defaultModeId)
    && byTask.includes(mode));
  if (declaredDefault) return declaredDefault;
  throw new Error(`Video task ${candidate.mode} has multiple modes; specify modeId`);
}

/** Exact provider wire model used by the existing catalog mappings. */
export function videoTransportModelIdForPlan(candidate: PlanCandidate, videoCandidate: VideoModelCandidate, mode: ArchetypeMode): string {
  const variantId = candidate.variantId ?? videoCandidate.variantId ?? videoCandidate.archetype.defaultVariantId;
  const variant = videoCandidate.archetype.variants?.find((item) => item.id === variantId);
  return variant?.modelKey?.trim() || mode.modelEnum?.trim() || videoCandidate.modelKey;
}

function parameterFieldForControl(control: ModelParameterControl): ParameterField {
  if (control.type === "select") {
    const optionValues = control.options.map((option) => option.value);
    if (optionValues.length > 0 && optionValues.every((value) => typeof value === "string")) return { type: "enum", enum: optionValues };
    if (optionValues.length > 0 && optionValues.every((value) => typeof value === "number" && Number.isFinite(value))) {
      return { type: "number", enum: optionValues };
    }
    if (optionValues.length > 0 && optionValues.every((value) => typeof value === "boolean")) {
      return { type: "boolean", enum: optionValues };
    }
    return { type: control.options.some((option) => typeof option.value === "number") ? "number" : "string" };
  }
  if (control.type === "number") return { type: "number" };
  if (control.type === "boolean") return { type: "boolean" };
  return { type: "string" };
}

export function videoParameterSchema(candidate: PlanCandidate, candidates: readonly VideoModelCandidate[] | undefined): Record<string, ParameterField> | undefined {
  if (!candidates) return undefined;
  const selected = videoCandidateForPlan(candidate, candidates);
  if (!selected) return undefined;
  const mode = videoModeForPlan(selected.candidate, selected.videoCandidate);
  return Object.fromEntries(mode.params.map((control) => [control.key, parameterFieldForControl(control)]));
}

export function normalizeVideoCandidate(candidate: PlanCandidate, candidates: readonly VideoModelCandidate[] | undefined): PlanCandidate {
  const selected = candidates ? videoCandidateForPlan(candidate, candidates) : null;
  if (!selected) return candidate;
  const mode = videoModeForPlan(selected.candidate, selected.videoCandidate);
  const transportModelId = videoTransportModelIdForPlan(selected.candidate, selected.videoCandidate, mode);
  return {
    ...selected.candidate,
    // Transport bucket comes from the one helper (vendor specialization > mode > archetype):
    // the same model identity is a single kie endpoint but a distinct Runway image endpoint.
    // Falls back to the plan's own declared mode when the archetype declares no transport.
    mode: modeTransportFor(mode, selected.videoCandidate.archetype, selected.videoCandidate.provider)
      ?? selected.candidate.mode,
    modeId: mode.id,
    transportModelId,
  };
}
