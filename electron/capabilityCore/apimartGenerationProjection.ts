import { spendReferenceKey } from "../shared/contracts/pendingSpendConfirm";
import type { GenerationProviderRequestInputV1 } from "./generationRuntimeAdapter";
import { bodyReferencedParamKeys, consumedCanonicalKeys } from "../catalog/paramTranslate";
import type { Mapping } from "../catalog/types";
import { productionGenerationPayloadHash } from "../productionRun/productionGenerationAuthorization";
import { ApimartGenerationProviderError } from "./apimartGenerationErrors";
import type { ReferenceCombineChannel } from "../shared/videoCapabilities/referenceChannels";
import { APIMART_REFERENCE_PARAMETER_ALIASES } from "../shared/modelArchetypes/referenceKeys";
import { comparableReferenceUrl } from "../catalog/outboundReferenceUrl";

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

function parameter(parameters: Record<string, unknown>, ...keys: string[]): unknown {
  return keys.map((key) => parameters[key]).find((value) => value !== undefined && value !== null && value !== "");
}

// 别名表住在 shared 的通用参考键表旁边（同一份，渲染层清键 / 主进程拒发也按它推导，#1269 条件 2）。
const REFERENCE_PARAMETER_ALIASES = APIMART_REFERENCE_PARAMETER_ALIASES;

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
      throw new ApimartGenerationProviderError("catalog reference URL projection must contain a non-empty image_with_roles array");
    }
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new ApimartGenerationProviderError("catalog reference URL projection contains an invalid image_with_roles entry");
      }
      const entry = item as Record<string, unknown>;
      if (Object.keys(entry).some((entryKey) => entryKey !== "url" && entryKey !== "role") || !isProviderUrl(entry.url)) {
        throw new ApimartGenerationProviderError("catalog reference URL projection contains an invalid image_with_roles URL");
      }
      if (entry.role !== undefined && (typeof entry.role !== "string" || !entry.role.trim())) {
        throw new ApimartGenerationProviderError("catalog reference URL projection contains an invalid image_with_roles role");
      }
    }
    return;
  }
  if (key === "first_frame_image" || key === "last_frame_image") {
    if (!isProviderUrl(value)) throw new ApimartGenerationProviderError("catalog references must be resolved to provider URLs before submission");
    return;
  }
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => !isProviderUrl(entry))) {
    throw new ApimartGenerationProviderError("catalog references must be resolved to provider URLs before submission");
  }
}

function assertReferenceAliasConsistency(parameters: Record<string, unknown>, key: ReferenceWireKey): void {
  const values = REFERENCE_PARAMETER_ALIASES[key]
    .map((alias) => parameters[alias])
    .filter(referenceValuePresent);
  if (values.length < 2) return;
  const first = values[0];
  if (values.some((value) => !sameJson(value, first))) {
    throw new ApimartGenerationProviderError("catalog reference URL projection conflicts with canonical parameters");
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

function countOf(value: unknown): number {
  if (!referenceValuePresent(value)) return 0;
  return Array.isArray(value) ? value.length : 1;
}

function referenceChannelCount(parameters: Record<string, unknown>, key: ReferenceWireKey): number {
  return countOf(referenceParameter(parameters, key));
}

/**
 * Ensure every contract reference has a provider-reachable URL. The
 * ExecutionContract deliberately stores asset identity, not transient URLs;
 * this check is the last boundary before an APIMart request so a missing
 * resolver can never turn an image-to-video request into an empty paid call.
 */
function assertResolvedReferences(
  input: GenerationProviderRequestInputV1,
  combineChannel?: ReferenceCombineChannel,
): void {
  const parameters = input.parameters;
  assertReferenceParameters(parameters);

  if (input.references.length === 0) return;
  // 档案模式声明的合并槽可以是任意键（用户自写契约也能声明），它承载的就是这一整组参考。
  const combined = combineChannel && !(combineChannel.key in REFERENCE_PARAMETER_ALIASES)
    ? countOf(parameters[combineChannel.key])
    : 0;
  const imageAvailable = Math.max(
    referenceChannelCount(parameters, "image_urls"),
    referenceChannelCount(parameters, "image_with_roles"),
    referenceChannelCount(parameters, "first_frame_image") + referenceChannelCount(parameters, "last_frame_image"),
    combined,
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
    throw new ApimartGenerationProviderError("catalog references must be resolved to provider URLs before submission");
  }
  if (required.unknown > 0 && required.unknown > imageAvailable + videoAvailable + audioAvailable) {
    throw new ApimartGenerationProviderError("catalog references must be resolved to provider URLs before submission");
  }
}

/**
 * 参考素材 → 供应商线缆字段，**一条路**：`input.referenceUrls` 是授权时封存的那份 URL 快照。
 *
 * 这里曾经并排站着第二条路（`ApimartReferenceUrlResolver`：调用方注入一个函数现算 URL）。
 * 新路接上之后没人再注入它，但类型、bootstrap 选项、provider 选项和六处测试都还留着，
 * 而且新分支**无条件覆盖**旧 resolver 的结果——也就是说旧路只剩「被测试养着」这一个作用。
 * 留着的代价不是多几行：下一个人会以为它是一条可选路径，于是两条路各自演化、口径慢慢分开。
 */
export function projectReferenceUrls(
  input: GenerationProviderRequestInputV1,
  mapping?: Mapping,
  /**
   * 档案模式声明的合并槽（`shared/videoCapabilities/referenceChannels.ts` 唯一 owner）。
   * 这里曾经是一句 `channels.has("image_with_roles")`——**拿 body 猜模式**。Seedance / Wan
   * 的 i2v body 同时声明 `image_urls` 与 `image_with_roles`（官方互斥，由模式区分），
   * 于是「全能参考」模式的图也被塞进 `image_with_roles`，与手动路发的不是同一条通道
   * （对等矩阵 NEW-1）。传 `undefined`/`null` = 没有合并槽 = 走扁平族键。
   */
  combineChannel?: ReferenceCombineChannel,
): GenerationProviderRequestInputV1 {
  const parameters = structuredClone(input.parameters);
  const combineKey = combineChannel && !combineChannel.flat ? combineChannel.key : undefined;
  if (input.referenceUrls) {
    const channels = new Set((mapping ? bodyReferencedParamKeys(mapping.create.body) : []).map(key => PROJECTION_KEYS[key] || key));
    const snapshot: Record<string, unknown> = {};
    const append = (key: string, value: unknown) => { (snapshot[key] ??= []); (snapshot[key] as unknown[]).push(value); };
    const combined: Array<{ url: string; role?: string }> = [];
    for (const reference of input.references) {
      const url = input.referenceUrls[spendReferenceKey(reference)];
      if (!isProviderUrl(url)) throw new ApimartGenerationProviderError("Approved reference URL is unavailable");
      if (reference.kind === "video") append("videoUrls", url);
      else if (reference.kind === "audio") append("audioUrls", url);
      else if (combineKey) combined.push({ url, ...(reference.role ? { role: reference.role } : {}) });
      else if (reference.role === "first_frame" && channels.has("first_frame_image")) snapshot.firstFrameImage = url;
      else if (reference.role === "last_frame" && channels.has("last_frame_image")) snapshot.lastFrameImage = url;
      else if (reference.role === "first_frame" || reference.role === "last_frame") throw new ApimartGenerationProviderError(`catalog mapping has unsupported reference role: ${reference.role}`);
      else append("imageUrls", url);
    }
    const merge = (targetKey: string, value: unknown): void => {
      // Empty channels are absent, not optional wire values.
      if (!referenceValuePresent(value)) return;
      const existing = PROJECTION_KEYS[targetKey]
        ? referenceParameter(parameters, PROJECTION_KEYS[targetKey])
        : parameters[targetKey];
      // 合同里显式写死的 URL 与授权时封存的那一份不一致 = 批准的是 A、要发出去的是 B。拒。
      if (referenceValuePresent(existing) && !sameJson(existing, value)) {
        throw new ApimartGenerationProviderError("catalog reference URL projection conflicts with canonical parameters");
      }
      if (!referenceValuePresent(existing)) parameters[targetKey] = structuredClone(value);
    };
    if (combineKey) merge(combineKey, combined);
    for (const [sourceKey, value] of Object.entries(snapshot)) merge(PROJECTION_KEYS[sourceKey], value);
  }
  const projected = { ...input, parameters };
  assertResolvedReferences(projected, combineChannel);
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
    throw new ApimartGenerationProviderError("catalog generation parameters are invalid");
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
      throw new ApimartGenerationProviderError(`catalog generation parameter is unsupported: ${key}`);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, canonical) && !sameJson(normalized[canonical], value)) {
      throw new ApimartGenerationProviderError(`catalog generation parameter aliases conflict: ${key}`);
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

/**
 * 这份参数里已经落位的**全部**参考 URL（跨所有参考通道）。
 * 空参考护栏（`imageEditGuardError`）读的是 headless extras 的标准键，而 Run 路的参考
 * 此刻已经投影成了 wire 键（`image_urls` / `image_with_roles` / `first_frame_image`…），
 * 所以要把它们捞回来喂给那把共享的尺子——而不是在 Run 路另写一份「带没带参考」的判据。
 */
export function resolvedReferenceUrls(parameters: Record<string, unknown>): string[] {
  const urls: string[] = [];
  for (const key of Object.keys(REFERENCE_PARAMETER_ALIASES) as ReferenceWireKey[]) {
    collectProviderUrls(referenceParameter(parameters, key), urls);
  }
  return [...new Set(urls)];
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
    throw new ApimartGenerationProviderError("catalog references must be resolved to provider URLs before submission");
  }
  // 请求体里的参考是参数层序列化后的写法：两边按同一个序列化比，带空格的已批准参考不被当成「被丢了」。
  const bodyUrls = new Set(collectProviderUrls(body).map(comparableReferenceUrl));
  for (const url of new Set(parameterUrls)) {
    if (!bodyUrls.has(comparableReferenceUrl(url))) {
      throw new ApimartGenerationProviderError("catalog mapping dropped a resolved reference");
    }
  }
}
