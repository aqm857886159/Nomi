import type { GenerationProviderRequestInputV1 } from "./generationRuntimeAdapter";
import { bodyReferencedParamKeys, consumedCanonicalKeys } from "../catalog/paramTranslate";
import type { Mapping } from "../catalog/types";
import { productionGenerationPayloadHash } from "../productionRun/productionGenerationAuthorization";
import { ApimartGenerationProviderError } from "./apimartGenerationErrors";

type JsonRecord = Record<string, unknown>;

export type ApimartImageReferenceWithRole = Readonly<{
  url: string;
  role?: string;
}>;

/** Provider URL projection understood by APIMart's flat image/video bodies. */
export type ApimartReferenceProjection = Readonly<{
  imageUrls?: readonly string[];
  inputUrls?: readonly string[];
  referenceImageUrls?: readonly string[];
  imageWithRoles?: readonly ApimartImageReferenceWithRole[];
  videoUrls?: readonly string[];
  referenceVideoUrls?: readonly string[];
  audioUrls?: readonly string[];
  referenceAudioUrls?: readonly string[];
  firstFrameImage?: string;
  firstFrameUrl?: string;
  lastFrameImage?: string;
  lastFrameUrl?: string;
}>;

export type ApimartReferenceUrlResolver = (
  input: GenerationProviderRequestInputV1,
) => ApimartReferenceProjection | null | undefined;

function parameter(parameters: Record<string, unknown>, ...keys: string[]): unknown {
  return keys.map((key) => parameters[key]).find((value) => value !== undefined && value !== null && value !== "");
}

const REFERENCE_PARAMETER_ALIASES = {
  image_urls: ["image_urls", "imageUrls", "input_urls", "inputUrls", "reference_image_urls", "referenceImageUrls"],
  image_with_roles: ["image_with_roles", "imageWithRoles"],
  video_urls: ["video_urls", "videoUrls", "reference_video_urls", "referenceVideoUrls"],
  audio_urls: ["audio_urls", "audioUrls", "reference_audio_urls", "referenceAudioUrls"],
  first_frame_image: ["first_frame_image", "firstFrameImage", "first_frame_url", "firstFrameUrl"],
  last_frame_image: ["last_frame_image", "lastFrameImage", "last_frame_url", "lastFrameUrl"],
} as const;

type ReferenceWireKey = keyof typeof REFERENCE_PARAMETER_ALIASES;

const PROJECTION_KEYS: Record<string, ReferenceWireKey> = {
  imageUrls: "image_urls",
  image_urls: "image_urls",
  inputUrls: "image_urls",
  input_urls: "image_urls",
  referenceImageUrls: "image_urls",
  reference_image_urls: "image_urls",
  imageWithRoles: "image_with_roles",
  image_with_roles: "image_with_roles",
  videoUrls: "video_urls",
  video_urls: "video_urls",
  referenceVideoUrls: "video_urls",
  reference_video_urls: "video_urls",
  audioUrls: "audio_urls",
  audio_urls: "audio_urls",
  referenceAudioUrls: "audio_urls",
  reference_audio_urls: "audio_urls",
  firstFrameImage: "first_frame_image",
  first_frame_image: "first_frame_image",
  firstFrameUrl: "first_frame_image",
  first_frame_url: "first_frame_image",
  lastFrameImage: "last_frame_image",
  last_frame_image: "last_frame_image",
  lastFrameUrl: "last_frame_image",
  last_frame_url: "last_frame_image",
};

/** Stable structural equality used when alias and resolver channels overlap. */
export function sameJson(left: unknown, right: unknown): boolean {
  try {
    return productionGenerationPayloadHash(left) === productionGenerationPayloadHash(right);
  } catch {
    return false;
  }
}

function isProviderUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function referenceValuePresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);
}

function referenceParameter(parameters: Record<string, unknown>, key: ReferenceWireKey): unknown {
  return parameter(parameters, ...REFERENCE_PARAMETER_ALIASES[key]);
}

function assertReferenceValue(key: ReferenceWireKey, value: unknown): void {
  if (key === "image_with_roles") {
    if (!Array.isArray(value) || value.length === 0) {
      throw new ApimartGenerationProviderError("APIMart reference URL projection must contain a non-empty image_with_roles array");
    }
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new ApimartGenerationProviderError("APIMart reference URL projection contains an invalid image_with_roles entry");
      }
      const entry = item as Record<string, unknown>;
      if (Object.keys(entry).some((entryKey) => entryKey !== "url" && entryKey !== "role") || !isProviderUrl(entry.url)) {
        throw new ApimartGenerationProviderError("APIMart reference URL projection contains an invalid image_with_roles URL");
      }
      if (entry.role !== undefined && (typeof entry.role !== "string" || !entry.role.trim())) {
        throw new ApimartGenerationProviderError("APIMart reference URL projection contains an invalid image_with_roles role");
      }
    }
    return;
  }
  if (key === "first_frame_image" || key === "last_frame_image") {
    if (!isProviderUrl(value)) throw new ApimartGenerationProviderError("APIMart references must be resolved to provider URLs before submission");
    return;
  }
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => !isProviderUrl(entry))) {
    throw new ApimartGenerationProviderError("APIMart references must be resolved to provider URLs before submission");
  }
}

function assertReferenceAliasConsistency(parameters: Record<string, unknown>, key: ReferenceWireKey): void {
  const values = REFERENCE_PARAMETER_ALIASES[key]
    .map((alias) => parameters[alias])
    .filter(referenceValuePresent);
  if (values.length < 2) return;
  const first = values[0];
  if (values.some((value) => !sameJson(value, first))) {
    throw new ApimartGenerationProviderError("APIMart reference URL projection conflicts with canonical parameters");
  }
}

export function assertReferenceParameters(parameters: Record<string, unknown>): void {
  const keys = Object.keys(REFERENCE_PARAMETER_ALIASES) as ReferenceWireKey[];
  for (const key of keys) {
    assertReferenceAliasConsistency(parameters, key);
    const value = referenceParameter(parameters, key);
    if (referenceValuePresent(value)) assertReferenceValue(key, value);
  }
}

function referenceChannelCount(parameters: Record<string, unknown>, key: ReferenceWireKey): number {
  const value = referenceParameter(parameters, key);
  if (!referenceValuePresent(value)) return 0;
  return Array.isArray(value) ? value.length : 1;
}

/**
 * Ensure every contract reference has a provider-reachable URL. The
 * ExecutionContract deliberately stores asset identity, not transient URLs;
 * this check is the last boundary before an APIMart request so a missing
 * resolver can never turn an image-to-video request into an empty paid call.
 */
function assertResolvedReferences(input: GenerationProviderRequestInputV1): void {
  const parameters = input.parameters;
  assertReferenceParameters(parameters);

  if (input.references.length === 0) return;
  const imageAvailable = Math.max(
    referenceChannelCount(parameters, "image_urls"),
    referenceChannelCount(parameters, "image_with_roles"),
    referenceChannelCount(parameters, "first_frame_image") + referenceChannelCount(parameters, "last_frame_image"),
  );
  const videoAvailable = referenceChannelCount(parameters, "video_urls");
  const audioAvailable = referenceChannelCount(parameters, "audio_urls");
  const required = { image: 0, video: 0, audio: 0, unknown: 0 };
  for (const reference of input.references) {
    if (reference.kind === "video") required.video += 1;
    else if (reference.kind === "audio") required.audio += 1;
    else if (reference.kind === "image") required.image += 1;
    else required.unknown += 1;
  }
  if (required.image > imageAvailable || required.video > videoAvailable || required.audio > audioAvailable) {
    throw new ApimartGenerationProviderError("APIMart references must be resolved to provider URLs before submission");
  }
  if (required.unknown > 0 && required.unknown > imageAvailable + videoAvailable + audioAvailable) {
    throw new ApimartGenerationProviderError("APIMart references must be resolved to provider URLs before submission");
  }
}

export function projectReferenceUrls(
  input: GenerationProviderRequestInputV1,
  resolver?: ApimartReferenceUrlResolver,
): GenerationProviderRequestInputV1 {
  const parameters = structuredClone(input.parameters);
  let projection: ApimartReferenceProjection | null | undefined;
  if (resolver) {
    try {
      projection = resolver(structuredClone(input));
    } catch {
      throw new ApimartGenerationProviderError("APIMart reference URL resolver failed");
    }
  }
  if (projection !== undefined && projection !== null) {
    if (!projection || typeof projection !== "object" || Array.isArray(projection)) {
      throw new ApimartGenerationProviderError("APIMart reference URL projection is invalid");
    }
    for (const [sourceKey, value] of Object.entries(projection as Record<string, unknown>)) {
      // Empty resolver channels are absent, not optional wire values.
      if (!referenceValuePresent(value)) continue;
      const targetKey = Object.prototype.hasOwnProperty.call(PROJECTION_KEYS, sourceKey) ? PROJECTION_KEYS[sourceKey] : undefined;
      if (!targetKey) throw new ApimartGenerationProviderError(`APIMart reference URL projection field is unsupported: ${sourceKey}`);
      const existing = referenceParameter(parameters, targetKey);
      if (referenceValuePresent(existing) && !sameJson(existing, value)) {
        throw new ApimartGenerationProviderError("APIMart reference URL projection conflicts with canonical parameters");
      }
      if (!referenceValuePresent(existing)) parameters[targetKey] = structuredClone(value);
    }
  }
  const projected = { ...input, parameters };
  assertResolvedReferences(projected);
  return projected;
}

const PARAMETER_ALIASES: Record<string, string> = {
  aspectRatio: "aspect_ratio",
  durationSeconds: "duration",
  videoDuration: "duration",
  videoResolution: "resolution",
  generateAudio: "generate_audio",
  negativePrompt: "negative_prompt",
  imageUrls: "image_urls",
  inputUrls: "input_urls",
  referenceImageUrls: "reference_image_urls",
  imageWithRoles: "image_with_roles",
  videoUrls: "video_urls",
  referenceVideoUrls: "reference_video_urls",
  audioUrls: "audio_urls",
  referenceAudioUrls: "reference_audio_urls",
  firstFrameImage: "first_frame_image",
  firstFrameUrl: "first_frame_image",
  lastFrameImage: "last_frame_image",
  lastFrameUrl: "last_frame_image",
  returnLastFrame: "return_last_frame",
  generationType: "generation_type",
  sourceTaskId: "source_task_id",
};

export function normalizeParameters(parameters: Record<string, unknown>, mapping: Mapping): Record<string, unknown> {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    throw new ApimartGenerationProviderError("APIMart generation parameters are invalid");
  }
  const mappingKeys = new Set([
    ...bodyReferencedParamKeys(mapping.create.body),
    ...consumedCanonicalKeys(mapping.create.paramMap),
    ...(mapping.create.paramMap?.drops || []),
    ...Object.keys(mapping.create.defaultParams || {}),
  ]);
  const declaredReferenceKeys = new Set<ReferenceWireKey>();
  for (const bodyKey of mappingKeys) {
    const referenceKey = PROJECTION_KEYS[bodyKey];
    if (referenceKey) declaredReferenceKeys.add(referenceKey);
  }
  const isDeclared = (key: string, canonical: string): boolean => {
    if (mappingKeys.has(key) || mappingKeys.has(canonical)) return true;
    if (declaredReferenceKeys.has(key as ReferenceWireKey) || declaredReferenceKeys.has(canonical as ReferenceWireKey)) return true;
    // Accept aliases only when their canonical reference channel is consumed.
    const projected = PROJECTION_KEYS[key] || PROJECTION_KEYS[canonical];
    return Boolean(projected && declaredReferenceKeys.has(projected));
  };
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parameters)) {
    if (value === undefined || (PROJECTION_KEYS[key] && !referenceValuePresent(value))) continue;
    const canonical = PARAMETER_ALIASES[key] || key;
    if (!isDeclared(key, canonical)) {
      throw new ApimartGenerationProviderError(`APIMart generation parameter is unsupported: ${key}`);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, canonical) && !sameJson(normalized[canonical], value)) {
      throw new ApimartGenerationProviderError(`APIMart generation parameter aliases conflict: ${key}`);
    }
    normalized[key] = structuredClone(value);
    if (canonical !== key) normalized[canonical] = structuredClone(value);
  }
  return normalized;
}

function collectProviderUrls(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    if (isProviderUrl(value)) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectProviderUrls(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectProviderUrls(item, out);
  }
  return out;
}

/** A resolved reference must survive the catalog renderer. */
export function assertReferencesReachBody(
  input: GenerationProviderRequestInputV1,
  parameters: Record<string, unknown>,
  body: JsonRecord,
): void {
  if (input.references.length === 0) return;
  const parameterUrls: string[] = [];
  for (const key of Object.keys(REFERENCE_PARAMETER_ALIASES) as ReferenceWireKey[]) {
    collectProviderUrls(referenceParameter(parameters, key), parameterUrls);
  }
  if (parameterUrls.length < input.references.length) {
    throw new ApimartGenerationProviderError("APIMart references must be resolved to provider URLs before submission");
  }
  const bodyUrls = new Set(collectProviderUrls(body));
  for (const url of new Set(parameterUrls)) {
    if (!bodyUrls.has(url)) {
      throw new ApimartGenerationProviderError("APIMart catalog mapping dropped a resolved reference");
    }
  }
}
