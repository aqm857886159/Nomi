import type { ArchetypeMode, ArchetypeReferenceSlot, ModelArchetype, ModelParameterControl, ModelParameterControlOption } from "./types";

type Scalar = ModelParameterControlOption["value"];

export type VideoReferenceInput = {
  kind: "image" | "video" | "audio";
  role?: "character" | "first_frame" | "last_frame" | "reference" | "audio";
};

export type VideoGenerationRecommendationInput = {
  prompt?: string;
  references?: readonly VideoReferenceInput[];
  cameraIntent?: "locked" | "pan" | "tilt" | "dolly" | "orbit" | "handheld" | "path";
  preferredFamily?: string;
  goals?: {
    preserveCharacter?: boolean;
    preserveTransition?: boolean;
    useReferenceAudio?: boolean;
    generateAudio?: boolean;
    durationSeconds?: number;
    aspectRatio?: string;
    quality?: "draft" | "balanced" | "final";
  };
};

export type VideoModelCandidate = {
  provider: string;
  modelKey: string;
  label: string;
  archetype: ModelArchetype;
  variantId?: string;
  variantChoices?: readonly { id: string; label: string; modelKey: string }[];
};

export type VideoGenerationRecommendation = {
  provider: string;
  modelKey: string;
  label: string;
  variantId?: string;
  modeId: string;
  modeLabel: string;
  params: Record<string, Scalar>;
  editableParams: string[];
  reasons: string[];
  limitations: string[];
  score: number;
};

export type VideoGenerationRecommendationResult = {
  recommendations: VideoGenerationRecommendation[];
  nextAction?: string;
};

type ReferenceSummary = {
  hasAny: boolean;
  first: number;
  last: number;
  images: number;
  videos: number;
  audios: number;
  characterImages: number;
};

const slotForKind = (mode: ArchetypeMode, kind: ArchetypeReferenceSlot["kind"]): ArchetypeReferenceSlot | undefined =>
  mode.slots.find((slot) => slot.kind === kind);

const summarizeReferences = (references: readonly VideoReferenceInput[]): ReferenceSummary => ({
  hasAny: references.length > 0,
  first: references.filter((reference) => reference.role === "first_frame").length,
  last: references.filter((reference) => reference.role === "last_frame").length,
  images: references.filter((reference) => reference.kind === "image" && !["first_frame", "last_frame"].includes(reference.role ?? "")).length,
  videos: references.filter((reference) => reference.kind === "video").length,
  audios: references.filter((reference) => reference.kind === "audio").length,
  characterImages: references.filter((reference) => reference.kind === "image" && reference.role === "character").length,
});

const countFitsSlot = (count: number, slot: ArchetypeReferenceSlot | undefined): boolean =>
  count === 0 ? true : Boolean(slot && count >= slot.min && count <= slot.max);

const modeMatchesReferences = (mode: ArchetypeMode, summary: ReferenceSummary): boolean => {
  if (!summary.hasAny) return mode.intent === "text";
  if (mode.intent === "text") return false;
  if (summary.first > 0 && !countFitsSlot(summary.first, slotForKind(mode, "first_frame"))) return false;
  if (summary.last > 0 && !countFitsSlot(summary.last, slotForKind(mode, "last_frame"))) return false;
  if (summary.images > 0 && !countFitsSlot(summary.images, slotForKind(mode, "image_ref"))) return false;
  if (summary.videos > 0 && !countFitsSlot(summary.videos, slotForKind(mode, "video_ref"))) return false;
  if (summary.audios > 0) {
    const audioSlot = slotForKind(mode, "audio_ref");
    if (!countFitsSlot(summary.audios, audioSlot)) return false;
    if (audioSlot?.requiresAnyOf && !audioSlot.requiresAnyOf.some((kind) => {
      if (kind === "image_ref") return summary.images > 0;
      if (kind === "video_ref") return summary.videos > 0;
      return false;
    })) return false;
  }
  if (summary.first > 0 && summary.last > 0 && mode.intent !== "firstlast") return false;
  if (summary.characterImages > 0 && mode.intent === "single" && mode.slots.some((slot) => slot.kind === "image_ref")) return true;
  return summary.first + summary.last + summary.images + summary.videos + summary.audios > 0;
};

export function canonicalVideoVariantId(archetype: ModelArchetype, requested?: string): string | undefined {
  const normalized = typeof requested === "string" ? requested.trim().toLowerCase() : "";
  if (!normalized) return undefined;
  return archetype.variants?.find((variant) => variant.id.toLowerCase() === normalized)?.id
    ?? Object.entries(archetype.variantIdAliases ?? {}).find(([alias]) => alias.toLowerCase() === normalized)?.[1];
}

export const effectiveVideoModes = (candidate: VideoModelCandidate): ArchetypeMode[] => {
  const variantId = candidate.variantId ?? candidate.archetype.defaultVariantId;
  const variant = candidate.archetype.variants?.find((item) => item.id === variantId);
  return candidate.archetype.modes.map((mode) => {
    const override = variant?.paramOverrides?.[mode.id];
    return override ? { ...mode, params: override(mode.params) } : mode;
  });
};

const numericOptions = (control: ModelParameterControl): number[] =>
  control.options.map((option) => option.value).filter((value): value is number => typeof value === "number" && Number.isFinite(value));

const nearestNumber = (value: number, options: number[]): number =>
  options.reduce((nearest, option) => (Math.abs(option - value) < Math.abs(nearest - value) ? option : nearest), options[0]!);

const chooseParamValue = (control: ModelParameterControl, input: VideoGenerationRecommendationInput): Scalar | undefined => {
  const requestedDuration = input.goals?.durationSeconds;
  if (control.key === "duration" && typeof requestedDuration === "number" && Number.isFinite(requestedDuration)) {
    const options = numericOptions(control);
    if (options.length > 0) return nearestNumber(requestedDuration, options);
    const min = typeof control.min === "number" ? control.min : requestedDuration;
    const max = typeof control.max === "number" ? control.max : requestedDuration;
    return Math.min(max, Math.max(min, requestedDuration));
  }
  const requestedRatio = input.goals?.aspectRatio;
  if ((control.key === "size" || control.key === "aspect_ratio") && requestedRatio) {
    const supported = control.options.some((option) => option.value === requestedRatio);
    if (supported) return requestedRatio;
  }
  if (control.key === "resolution" && input.goals?.quality) {
    const options = control.options.map((option) => option.value).filter((value): value is string => typeof value === "string");
    if (options.length > 0) return input.goals.quality === "draft" ? options[0] : input.goals.quality === "final" ? options[options.length - 1] : control.defaultValue;
  }
  if (control.key === "generate_audio" && typeof input.goals?.generateAudio === "boolean") return input.goals.generateAudio;
  return control.defaultValue;
};

const durationSupport = (mode: ArchetypeMode, target: number): { supported: boolean; description: string } | null => {
  const control = mode.params.find((item) => item.key === "duration");
  if (!control) return null;
  const options = numericOptions(control);
  if (options.length > 0) {
    const supported = options.includes(target);
    return { supported, description: supported ? `${target} 秒` : `${options.join("/ ")} 秒` };
  }
  const min = typeof control.min === "number" ? control.min : Number.NEGATIVE_INFINITY;
  const max = typeof control.max === "number" ? control.max : Number.POSITIVE_INFINITY;
  return { supported: target >= min && target <= max, description: `${min}–${max} 秒` };
};

const buildParams = (mode: ArchetypeMode, input: VideoGenerationRecommendationInput): { params: Record<string, Scalar>; editableParams: string[] } => {
  const params: Record<string, Scalar> = {};
  for (const control of mode.params) {
    const value = chooseParamValue(control, input);
    if (typeof value !== "undefined") params[control.key] = value;
  }
  for (const [key, value] of Object.entries(mode.fixedParams ?? {})) params[key] = value;
  return { params, editableParams: mode.params.map((control) => control.key) };
};

const scoreMode = (mode: ArchetypeMode, summary: ReferenceSummary, input: VideoGenerationRecommendationInput): number => {
  let score = 0;
  if (!summary.hasAny) score += mode.intent === "text" ? 100 : 0;
  if (summary.first > 0 && summary.last > 0) score += mode.intent === "firstlast" ? 140 : 0;
  else if (summary.first > 0) score += mode.intent === "single" ? 105 : mode.intent === "firstlast" ? 80 : 0;
  if (summary.characterImages > 0) score += mode.intent === "character" ? 130 : mode.intent === "single" ? 90 : 0;
  if (summary.videos > 0) score += mode.slots.some((slot) => slot.kind === "video_ref") ? 110 : 0;
  if (summary.audios > 0) score += mode.slots.some((slot) => slot.kind === "audio_ref") ? 90 : 0;
  if (input.goals?.preserveTransition && mode.intent === "firstlast") score += 35;
  if (input.goals?.preserveCharacter && mode.intent === "character") score += 30;
  if (typeof input.goals?.durationSeconds === "number") score += durationSupport(mode, input.goals.durationSeconds)?.supported ? 30 : -30;
  return score;
};

const buildReasons = (mode: ArchetypeMode, summary: ReferenceSummary, input: VideoGenerationRecommendationInput): string[] => {
  const reasons: string[] = [];
  if (!summary.hasAny) reasons.push("没有参考素材，文生视频可以让模型自由构图");
  if (summary.characterImages > 0 && mode.intent === "character") reasons.push("有角色参考图，优先锁定角色身份和外观");
  if (summary.first > 0 && summary.last > 0 && mode.intent === "firstlast") reasons.push("同时提供首帧和尾帧，优先让模型负责两张图之间的过渡");
  if (summary.videos > 0) reasons.push("有参考视频，当前模式可以利用它提供动作或镜头节奏");
  if (summary.audios > 0) reasons.push("有参考音频，当前模式允许把音频作为参考输入");
  if (input.goals?.durationSeconds) reasons.push(`按目标时长 ${input.goals.durationSeconds} 秒选择当前模型允许的值`);
  return reasons;
};

const expressionChannelsFor = (mode: ArchetypeMode) => {
  const channels = mode.expressionChannels ?? [];
  const hasCameraChannel = channels.some((channel) => channel.signal === "camera_motion");
  const hasMotionReferenceChannel = channels.some((channel) => channel.signal === "motion_reference");
  const hasTrajectoryChannel = channels.some((channel) => channel.signal === "trajectory");
  return {
    camera: channels.filter((channel) => channel.signal === "camera_motion"),
    motionReference: channels.filter((channel) => channel.signal === "motion_reference"),
    trajectory: channels.filter((channel) => channel.signal === "trajectory"),
    hasCameraChannel,
    hasMotionReferenceChannel,
    hasTrajectoryChannel,
  };
};

const buildLimitations = (mode: ArchetypeMode, input: VideoGenerationRecommendationInput): string[] => {
  const limitations: string[] = [];
  if (input.cameraIntent) {
    const channels = expressionChannelsFor(mode);
    const declaredChannels = [...channels.camera, ...channels.motionReference, ...channels.trajectory];
    const documentedChannels = declaredChannels.filter((channel) => channel.status === "documented");
    const unknownChannels = declaredChannels.filter((channel) => channel.status === "unknown");
    const unsupportedChannels = declaredChannels.filter((channel) => channel.status === "unsupported");
    if (documentedChannels.length === 0 && unsupportedChannels.length > 0 && unknownChannels.length === 0) {
      limitations.push("当前模式的官方文档明确不支持这种运镜表达");
    } else if (documentedChannels.length === 0) {
      limitations.push("当前模式的运镜表达尚未完成对账，建议先确认生成效果");
    } else {
      const via = [
        channels.hasCameraChannel ? "提示词" : "",
        channels.hasMotionReferenceChannel ? "参考视频" : "",
        channels.hasTrajectoryChannel ? "结构化运动参数" : "",
      ].filter(Boolean);
      limitations.push(`当前模式通过${via.join("或")}表达运镜意图`);
      if (channels.hasTrajectoryChannel && !channels.hasCameraChannel) limitations.push("结构化运动参数只在档案声明的任务和字段路径下有效，不等同于统一的相机轨迹控件");
      if (unsupportedChannels.length > 0) limitations.push("当前模式中的另一种运镜通道被官方明确限制，已保留可用的表达方式");
    }
  }
  if (mode.fixedParams?.size === "adaptive") limitations.push("当前供应商要求此模式使用 adaptive 比例，比例不能自由改");
  if (input.goals?.generateAudio && !mode.params.some((control) => control.key === "generate_audio")) limitations.push("当前模式没有可验证的生成音频参数");
  if (typeof input.goals?.durationSeconds === "number") {
    const support = durationSupport(mode, input.goals.durationSeconds);
    if (support && !support.supported) limitations.push(`目标时长 ${input.goals.durationSeconds} 秒超出当前模式范围，已选 ${support.description} 内的最近值`);
  }
  return limitations;
};

const hasDependentAudioMode = (candidates: readonly VideoModelCandidate[]): boolean => candidates.some((candidate) =>
  effectiveVideoModes(candidate).some((mode) => Boolean(slotForKind(mode, "audio_ref")?.requiresAnyOf?.length)),
);

const modeLabel = (mode: ArchetypeMode): string => mode.vendorTerm || mode.id;

export function recommendVideoGeneration(input: VideoGenerationRecommendationInput, candidates: readonly VideoModelCandidate[]): VideoGenerationRecommendationResult {
  const summary = summarizeReferences(input.references ?? []);
  const recommendations = candidates.flatMap((candidate) => {
    const modes = effectiveVideoModes(candidate);
    return modes.filter((mode) => modeMatchesReferences(mode, summary)).map((mode) => {
      const built = buildParams(mode, input);
      const familyBonus = input.preferredFamily && candidate.archetype.family === input.preferredFamily ? 25 : 0;
      return {
        provider: candidate.provider,
        modelKey: candidate.modelKey,
        label: candidate.label,
        variantId: candidate.variantId ?? candidate.archetype.defaultVariantId,
        modeId: mode.id,
        modeLabel: modeLabel(mode),
        params: built.params,
        editableParams: built.editableParams,
        reasons: buildReasons(mode, summary, input),
        limitations: buildLimitations(mode, input),
        score: scoreMode(mode, summary, input) + familyBonus,
      } satisfies VideoGenerationRecommendation;
    });
  }).sort((left, right) => right.score - left.score);

  if (recommendations.length > 0) return { recommendations };
  if (summary.audios > 0 && summary.images === 0 && summary.videos === 0 && hasDependentAudioMode(candidates)) {
    return { recommendations: [], nextAction: "请再提供参考图或参考视频；当前候选模式要求参考音频与其中一种素材一起使用" };
  }
  return { recommendations: [], nextAction: "当前模型没有同时满足这些素材和目标的模式，请减少一种参考类型或切换到支持它的模型" };
}
