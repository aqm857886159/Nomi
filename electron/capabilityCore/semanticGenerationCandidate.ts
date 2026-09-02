import type { GenerationDefaultTaskKind } from "../settings/generationModelDefaultsContract";
import type { PlanCandidate } from "./executionContract";

/**
 * The model-facing create tool intentionally accepts a short, natural request
 * (`{ prompt: "..." }`).  This module turns that request into the same
 * validated PlanCandidate used by the explicit candidate path.  Keeping this
 * boundary separate prevents the MCP handler from growing a second parser or
 * a provider-specific selection algorithm.
 */

export type SemanticGenerationCandidateParams = Readonly<Record<string, unknown>>;

export type SemanticGenerationDefault = Readonly<{
  moduleId: string;
  providerId: string;
  modelId: string;
  mode: string;
  modeId?: string;
  variantId?: string;
}>;

export type SemanticGenerationCandidateDeps = Readonly<{
  operationId: string;
  params: SemanticGenerationCandidateParams;
  candidateFrom: (value: unknown) => PlanCandidate;
  defaultModelForTaskKind?: (taskKind: GenerationDefaultTaskKind) => SemanticGenerationDefault | undefined;
  /** Structural snapshot only; the handler may expose a registry without a snapshot in tests. */
  registry?: { snapshot?: () => readonly unknown[] };
  /**
   * Test-only escape hatch for isolated registry fixtures. Production callers
   * must resolve the user's saved Workbench default (or pass an explicit
   * model); silently picking the first catalog row is not an acceptable user
   * experience or spend policy.
   */
  allowRegistryFallback?: boolean;
}>;

const TASK_KINDS = new Set<GenerationDefaultTaskKind>([
  "text_to_image",
  "image_edit",
  "text_to_video",
  "image_to_video",
]);

/**
 * Long-form intent is deliberately derived from the user's goal, not from a
 * provider parameter. `parameters.duration` is usually the duration of one
 * provider clip (for example 5 seconds), so treating it as the requested
 * movie length would silently turn every short video into a storyboard.
 */
const VIDEO_INTENT = /(视频|短片|镜头|分镜|动画|成片|video|clip|film|animate|motion)/i;
const LONG_FORM_TERMS = /(长视频|长片|完整视频|成片|多镜|分镜|剧本|广告片|宣传片|纪录片|long[-\s]?form|feature[-\s]?length|multi[-\s]?shot|storyboard)/i;
const DURATION_TOKEN = /(\d+(?:\.\d+)?)\s*(小时|小時|h(?:ours?)?|分钟|分|min(?:ute)?s?|秒|s(?:ec(?:ond)?s?)?)/iu;

/** Parse a total video duration stated in a natural-language goal. */
export function requestedVideoDurationSeconds(params: SemanticGenerationCandidateParams): number | undefined {
  const explicit = [params.totalDurationSeconds, params.targetDurationSeconds].find((value) =>
    typeof value === "number" && Number.isFinite(value) && value > 0,
  );
  if (typeof explicit === "number") return explicit;
  const prompt = [params.prompt, params.scriptText, params.goal]
    .map(text)
    .find((value) => value.length > 0) ?? "";
  const match = prompt.match(DURATION_TOKEN);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const unit = match[2].toLowerCase();
  if (unit === "小时" || unit === "小時" || unit.startsWith("h")) return amount * 3_600;
  if (unit === "分钟" || unit === "分" || unit.startsWith("min")) return amount * 60;
  return amount;
}

/**
 * Decide whether a natural create must enter the storyboard/multi-shot path.
 * A minute-scale duration or an explicit long-form/storyboard term is enough;
 * ordinary 3–30 second clips remain the compact single-shot path.
 */
export function isLongFormGenerationRequest(params: SemanticGenerationCandidateParams): boolean {
  const explicitTaskKind = normalized(params.taskKind);
  if (explicitTaskKind === "text_to_image" || explicitTaskKind === "image_edit") return false;
  const prompt = [params.prompt, params.scriptText, params.goal]
    .map(text)
    .find((value) => value.length > 0) ?? "";
  const video = explicitTaskKind === "text_to_video" || explicitTaskKind === "image_to_video" || VIDEO_INTENT.test(prompt);
  if (!video) return false;
  const duration = requestedVideoDurationSeconds(params);
  return (duration !== undefined && duration >= 60) || LONG_FORM_TERMS.test(prompt);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalized(value: unknown): string {
  return text(value).toLowerCase().replace(/[-\s]/g, "_");
}

function isTaskKind(value: unknown): value is GenerationDefaultTaskKind {
  return typeof value === "string" && TASK_KINDS.has(value as GenerationDefaultTaskKind);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return { ...(value as Record<string, unknown>) };
}

function references(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("references must be an array");
  return value.map((item) => (item && typeof item === "object" ? { ...(item as Record<string, unknown>) } : item));
}

/** Infer only the semantic task family; model/mode selection remains catalog-owned. */
export function inferGenerationTaskKind(params: SemanticGenerationCandidateParams): GenerationDefaultTaskKind {
  const explicit = params.taskKind;
  if (explicit !== undefined) {
    if (!isTaskKind(explicit)) throw new Error("taskKind must be text_to_image, image_edit, text_to_video or image_to_video");
    return explicit;
  }
  const mode = normalized(params.mode);
  if (isTaskKind(mode)) return mode;
  const prompt = text(params.prompt).toLowerCase();
  const hasReferences = Array.isArray(params.references) && params.references.length > 0;
  const videoIntent = /(视频|短片|镜头|分镜|动画|video|clip|film|animate|motion)/i.test(prompt);
  if (videoIntent) return hasReferences ? "image_to_video" : "text_to_video";
  return hasReferences ? "image_edit" : "text_to_image";
}

function modeFromSnapshot(
  deps: SemanticGenerationCandidateDeps,
  selected: SemanticGenerationDefault,
  taskKind: GenerationDefaultTaskKind,
): string {
  const manifests = deps.registry?.snapshot?.() ?? [];
  const manifest = manifests.find((item): item is { moduleId: string; modes?: readonly unknown[]; providers?: readonly unknown[] } =>
    Boolean(item && typeof item === "object" && (item as { moduleId?: unknown }).moduleId === selected.moduleId));
  const providers = Array.isArray(manifest?.providers) ? manifest.providers : [];
  const provider = providers.find((item): item is { providerId: string; models?: readonly unknown[] } =>
    Boolean(item && typeof item === "object" && (item as { providerId?: unknown }).providerId === selected.providerId));
  const models = Array.isArray(provider?.models) ? provider.models : [];
  const model = models.find((item): item is { modelId: string; modes?: readonly unknown[] } =>
    Boolean(item && typeof item === "object" && (item as { modelId?: unknown }).modelId === selected.modelId));
  const modelModes = Array.isArray(model?.modes) ? model.modes.filter((mode): mode is string => typeof mode === "string") : [];
  const manifestModes = Array.isArray(manifest?.modes) ? manifest.modes.filter((mode): mode is string => typeof mode === "string") : [];
  const wanted = normalized(selected.mode) || normalized(taskKind);
  const declared = modelModes.find((mode) => normalized(mode) === wanted)
    ?? modelModes.find((mode) => normalized(mode) === normalized(taskKind))
    ?? manifestModes.find((mode) => normalized(mode) === wanted)
    ?? manifestModes.find((mode) => normalized(mode) === normalized(taskKind));
  return declared ?? selected.mode;
}

function fallbackFromSnapshot(
  deps: SemanticGenerationCandidateDeps,
  taskKind: GenerationDefaultTaskKind,
): SemanticGenerationDefault | undefined {
  for (const manifest of deps.registry?.snapshot?.() ?? []) {
    if (!manifest || typeof manifest !== "object") continue;
    const moduleId = text((manifest as { moduleId?: unknown }).moduleId);
    const providers = (manifest as { providers?: unknown }).providers;
    if (!moduleId || !Array.isArray(providers)) continue;
    for (const provider of providers) {
      if (!provider || typeof provider !== "object") continue;
      const providerId = text((provider as { providerId?: unknown }).providerId);
      const models = (provider as { models?: unknown }).models;
      if (!providerId || !Array.isArray(models)) continue;
      const model = models.find((candidate) => {
        if (!candidate || typeof candidate !== "object") return false;
        const modes = (candidate as { modes?: unknown }).modes;
        return Array.isArray(modes) && modes.some((mode) => normalized(mode) === normalized(taskKind));
      }) as { modelId?: unknown; modes?: unknown } | undefined;
      if (model) {
        const modes = Array.isArray(model.modes) ? model.modes.filter((candidate): candidate is string => typeof candidate === "string") : [];
        const mode = modes.find((candidate) => normalized(candidate) === normalized(taskKind)) ?? modes[0];
        const modelId = text(model.modelId);
        if (mode && modelId) return { moduleId, providerId, modelId, mode };
      }
    }
  }
  return undefined;
}

/**
 * Build the canonical candidate for a short semantic create request.  An
 * explicit `candidate` is still authoritative and is parsed unchanged; the
 * short path only fills omitted identity fields from saved Workbench defaults
 * or the live module registry.
 */
export function semanticCandidateFromParams(deps: SemanticGenerationCandidateDeps): PlanCandidate {
  if (deps.params.candidate !== undefined) return deps.candidateFrom(deps.params.candidate);
  const prompt = text(deps.params.prompt);
  if (!prompt) throw new Error("prompt is required when candidate is omitted");

  const taskKind = inferGenerationTaskKind(deps.params);
  const configured = deps.defaultModelForTaskKind?.(taskKind);
  // A production semantic request must never infer a spend-bearing model from
  // catalog row order. The only implicit identity is the saved Workbench
  // default; registry fallback is opt-in for no-provider unit fixtures only.
  const fallback = configured ?? (deps.allowRegistryFallback ? fallbackFromSnapshot(deps, taskKind) : undefined);
  const moduleId = text(deps.params.moduleId) || fallback?.moduleId;
  const providerId = text(deps.params.providerId) || fallback?.providerId;
  const modelId = text(deps.params.modelId) || fallback?.modelId;
  if (!moduleId || !providerId || !modelId) {
    throw new Error(`没有配置可用的${taskKind.includes("video") ? "视频" : "图片"}模型，请先在设置中选择模型`);
  }
  // A saved mode/variant belongs to the saved provider+model identity.  If the
  // user explicitly chooses another model, carrying those fields across can
  // silently select an incompatible transport variant (or fail much later at
  // provider execution).  Only inherit the fallback's mode metadata when the
  // effective identity is still the fallback identity.
  const fallbackIdentityMatches = Boolean(fallback)
    && providerId === fallback?.providerId
    && modelId === fallback?.modelId;
  const selectedMode = text(deps.params.mode) || (fallbackIdentityMatches ? fallback?.mode : undefined) || taskKind;
  const selectedModeId = text(deps.params.modeId) || (fallbackIdentityMatches ? fallback?.modeId : undefined);
  const selectedVariantId = text(deps.params.variantId) || (fallbackIdentityMatches ? fallback?.variantId : undefined);
  const selected: SemanticGenerationDefault = {
    moduleId,
    providerId,
    modelId,
    mode: selectedMode,
    ...(selectedModeId ? { modeId: selectedModeId } : {}),
    ...(selectedVariantId ? { variantId: selectedVariantId } : {}),
  };
  const mode = modeFromSnapshot(deps, selected, taskKind);
  return deps.candidateFrom({
    candidateId: `cand-${deps.operationId}`,
    revision: 1,
    moduleId: selected.moduleId,
    providerId: selected.providerId,
    modelId: selected.modelId,
    mode,
    ...(selected.modeId ? { modeId: selected.modeId } : {}),
    ...(selected.variantId ? { variantId: selected.variantId } : {}),
    prompt,
    parameters: record(deps.params.parameters, "parameters"),
    references: references(deps.params.references),
  });
}
