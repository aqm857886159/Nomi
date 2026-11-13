import { spendReferenceKey } from "../shared/contracts/pendingSpendConfirm";
import type { GenerationProviderRequestInputV1 } from "./generationRuntimeAdapter";
import { bodyReferencedParamKeys, consumedCanonicalKeys } from "../catalog/paramTranslate";
import type { Mapping } from "../catalog/types";
import { productionGenerationPayloadHash } from "../productionRun/productionGenerationAuthorization";
import { ApimartGenerationProviderError } from "./apimartGenerationErrors";
import type { ArchetypeMode } from "../shared/videoCapabilities/types";
import {
  placeApprovedRunReferences,
  runReferenceGroupHead,
  runReferenceGroupOf,
  runReferenceGroups,
  runReferenceParameterAccepted,
  RunReferenceError,
  type RunReferenceGroup,
} from "../shared/generationLowering/runReferences";
import { comparableReferenceUrl } from "../catalog/outboundReferenceUrl";
import { tagNomiError } from "../shared/nomiErrorCodes";

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

/** 一个参考位的值：组里第一个有值的写法。 */
function groupValue(parameters: Record<string, unknown>, group: RunReferenceGroup): unknown {
  return group.keys.map((key) => parameters[key]).find((value) => value !== undefined && value !== null && value !== "");
}

/** `member` 所在的参考位（按 shared 声明表分组）。 */
function groupOf(shape: RunReferenceGroup["shape"], member: string): RunReferenceGroup {
  return { keys: runReferenceGroupOf(member) ?? [member], shape };
}

function assertReferenceValue(group: RunReferenceGroup, value: unknown): void {
  if (group.shape === "role-objects") {
    const key = group.keys[0]!;
    if (!Array.isArray(value) || value.length === 0) {
      throw new ApimartGenerationProviderError(`catalog reference URL projection must contain a non-empty ${key} array`);
    }
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new ApimartGenerationProviderError(`catalog reference URL projection contains an invalid ${key} entry`);
      }
      const entry = item as Record<string, unknown>;
      if (Object.keys(entry).some((entryKey) => entryKey !== "url" && entryKey !== "role") || !isProviderUrl(entry.url)) {
        throw new ApimartGenerationProviderError(`catalog reference URL projection contains an invalid ${key} URL`);
      }
      if (entry.role !== undefined && (typeof entry.role !== "string" || !entry.role.trim())) {
        throw new ApimartGenerationProviderError(`catalog reference URL projection contains an invalid ${key} role`);
      }
    }
    return;
  }
  if (group.shape === "frame") {
    if (!isProviderUrl(value)) throw new ApimartGenerationProviderError("catalog references must be resolved to provider URLs before submission");
    return;
  }
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => !isProviderUrl(entry))) {
    throw new ApimartGenerationProviderError("catalog references must be resolved to provider URLs before submission");
  }
}

function assertReferenceAliasConsistency(parameters: Record<string, unknown>, group: RunReferenceGroup): void {
  const values = group.keys
    .map((alias) => parameters[alias])
    .filter(referenceValuePresent);
  if (values.length < 2) return;
  const first = values[0];
  if (values.some((value) => !sameJson(value, first))) {
    throw new ApimartGenerationProviderError("catalog reference URL projection conflicts with canonical parameters");
  }
}

/**
 * 参考位的值形状（按 shared 声明表分组：同一参考位的几种写法必须一致；角色数组每项只有 url / role；
 * 首尾帧是一个 provider URL；列表是非空的 provider URL 数组）。参数和最终请求体都过这一道。
 */
export function assertReferenceParameters(parameters: Record<string, unknown>): void {
  for (const group of runReferenceGroups()) {
    assertReferenceAliasConsistency(parameters, group);
    const value = groupValue(parameters, group);
    if (referenceValuePresent(value)) assertReferenceValue(group, value);
  }
}

function countOf(value: unknown): number {
  if (!referenceValuePresent(value)) return 0;
  return Array.isArray(value) ? value.length : 1;
}

function referenceChannelCount(parameters: Record<string, unknown>, group: RunReferenceGroup): number {
  return countOf(groupValue(parameters, group));
}

/**
 * Ensure every contract reference has a provider-reachable URL. The
 * ExecutionContract deliberately stores asset identity, not transient URLs;
 * this check is the last boundary before an APIMart request so a missing
 * resolver can never turn an image-to-video request into an empty paid call.
 */
function assertResolvedReferences(
  input: GenerationProviderRequestInputV1,
  combineKey: string | null,
): void {
  const parameters = input.parameters;
  assertReferenceParameters(parameters);

  if (input.references.length === 0) return;
  // 档案模式声明的合并槽可以是任意键（用户自写契约也能声明），它承载的就是这一整组参考。
  const combined = combineKey && !runReferenceGroupOf(combineKey) ? countOf(parameters[combineKey]) : 0;
  const imageAvailable = Math.max(
    referenceChannelCount(parameters, groupOf("list", "image_urls")),
    referenceChannelCount(parameters, groupOf("role-objects", "image_with_roles")),
    referenceChannelCount(parameters, groupOf("frame", "first_frame_url")) + referenceChannelCount(parameters, groupOf("frame", "last_frame_url")),
    combined,
  );
  const videoAvailable = referenceChannelCount(parameters, groupOf("list", "video_urls"));
  const audioAvailable = referenceChannelCount(parameters, groupOf("list", "audio_urls"));
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

export type PlacedRunReferences = GenerationProviderRequestInputV1 & Readonly<{
  /** 这一步替合同参考写下的参数键（报「参数不支持」时按参考位称呼它们）。 */
  placedReferenceKeys: readonly string[];
}>;

/**
 * 参考素材 → 参数，**一条路**：`input.referenceUrls` 是授权时封存的那份 URL 快照。放哪个键、什么形状不在这里答：
 * 合并槽交给降级函数（`shared/generationLowering`，与画布同一份模式声明），其余说成标准输入键，
 * 之后由 `applyHeadlessParamDefaults` 用同一个降级函数放进 body 真读的键。这里只管封存的 URL 在不在、
 * 和合同里显式写死的值冲不冲突、该拒的明着拒。
 */
export function placeRunReferences(
  input: GenerationProviderRequestInputV1,
  createBody: unknown,
  /** 用户选的档案模式（没带 modeId / 没有档案 → null，走按 body 推出的声明）。 */
  mode: ArchetypeMode | null,
  combineKey: string | null,
): PlacedRunReferences {
  let parameters = structuredClone(input.parameters);
  let placedReferenceKeys: readonly string[] = [];
  if (input.referenceUrls) {
    const urls = input.referenceUrls;
    const approved = input.references.map((reference) => {
      const url = urls[spendReferenceKey(reference)];
      if (!isProviderUrl(url)) throw new ApimartGenerationProviderError("Approved reference URL is unavailable");
      return { url, ...(reference.kind ? { kind: reference.kind } : {}), ...(reference.role ? { role: reference.role } : {}) };
    });
    try {
      ({ parameters, placedKeys: placedReferenceKeys } = placeApprovedRunReferences(parameters, approved, createBody, mode));
    } catch (error) {
      if (!(error instanceof RunReferenceError)) throw error;
      if (error.reason === "not-in-use") {
        // 机器码 reference-not-in-use，错误卡认码，见 referenceResidueGuard。
        throw new ApimartGenerationProviderError(tagNomiError("reference-not-in-use", `Request rejected before sending: the current mode has no reference slot for role ${error.detail.role ?? "reference"} (${error.detail.kind ?? "image"}). Nothing was sent to the provider.`));
      }
      throw new ApimartGenerationProviderError(error.message);
    }
  }
  const projected = { ...input, parameters };
  assertResolvedReferences(projected, combineKey);
  return { ...projected, placedReferenceKeys };
}

// Nomi 意图里的标量写法 → 线上标准写法。参考键不在这里：同一参考位的几种写法由 shared 声明表分组，
// 放哪个键交给降级函数。
const SCALAR_CANONICAL_KEYS: Readonly<Record<string, string>> = {
  aspectRatio: "aspect_ratio",
  durationSeconds: "duration",
  videoDuration: "duration",
  videoResolution: "resolution",
  generateAudio: "generate_audio",
  negativePrompt: "negative_prompt",
  returnLastFrame: "return_last_frame",
  generationType: "generation_type",
  sourceTaskId: "source_task_id",
};

/**
 * 合同参数 → 这份 mapping 收的参数：标量写法补上线上标准键；参考参数只认 mapping 读的那个参考位
 * （同一参考位的另一种写法也算，见 `runReferenceParameterAccepted`）；mapping 不收的明着拒，不偷偷丢。
 */
export function normalizeParameters(
  parameters: Record<string, unknown>,
  mapping: Mapping,
  /** 合同参考这一步写下的键：被拒时按参考位的标准写法称呼（调用方没写过它们）。 */
  placedReferenceKeys: readonly string[] = [],
): Record<string, unknown> {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    throw new ApimartGenerationProviderError("catalog generation parameters are invalid");
  }
  const mappingKeys = new Set([
    ...bodyReferencedParamKeys(mapping.create.body),
    ...consumedCanonicalKeys(mapping.create.paramMap),
    ...(mapping.create.paramMap?.drops || []),
    ...Object.keys(mapping.create.defaultParams || {}),
  ]);
  const placed = new Set(placedReferenceKeys);
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parameters)) {
    const referenceGroup = runReferenceGroupOf(key);
    if (value === undefined || (referenceGroup && !referenceValuePresent(value))) continue;
    const canonical = SCALAR_CANONICAL_KEYS[key] || key;
    const declared = referenceGroup
      ? runReferenceParameterAccepted(key, mappingKeys)
      : mappingKeys.has(key) || mappingKeys.has(canonical);
    if (!declared) {
      throw new ApimartGenerationProviderError(`catalog generation parameter is unsupported: ${placed.has(key) ? runReferenceGroupHead(key) : key}`);
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
 * 此刻可能已经落在 body 键上（`image_urls` / `image_with_roles` / `first_frame_image`…，按 shared 声明表分组），
 * 所以要把它们捞回来喂给那把共享的尺子——而不是在 Run 路另写一份「带没带参考」的判据。
 */
export function resolvedReferenceUrls(parameters: Record<string, unknown>): string[] {
  const urls: string[] = [];
  for (const group of runReferenceGroups()) collectProviderUrls(groupValue(parameters, group), urls);
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
  for (const group of runReferenceGroups()) collectProviderUrls(groupValue(parameters, group), parameterUrls);
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
