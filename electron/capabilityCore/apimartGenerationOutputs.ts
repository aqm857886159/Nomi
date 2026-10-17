import path from "node:path";

import type { GenerationProviderOutput } from "./generationRuntimeAdapter";
import { mediaKindOf, readTaskResponse, type ExpectedMediaKind } from "../tasks/taskResultReading";

type JsonRecord = Record<string, unknown>;

/** First non-empty string in a string-or-string-array field. APIMart video
 * responses use both shapes (`videos[].url` can be an array); accepting the
 * documented and observed forms keeps materialization provider-owned. */
function firstUrlString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && entry.trim()) return entry.trim();
    }
  }
  return null;
}

function outputUrl(value: unknown): string | null {
  const direct = firstUrlString(value);
  if (direct) return direct;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as JsonRecord;
  for (const key of ["url", "video_url", "image_url", "audio_url"]) {
    const nested = firstUrlString(item[key]);
    if (nested) return nested;
  }
  return null;
}

/** Keep provider-provided names useful for data: loopback outputs without
 * allowing paths, control characters, or unbounded names into the workspace. */
function outputFileName(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as JsonRecord;
  for (const key of ["fileName", "filename", "name"]) {
    if (typeof item[key] !== "string") continue;
    const candidate = item[key].trim();
    if (!candidate || candidate.length > 120 || /[\\/\0\r\n]/.test(candidate)) continue;
    const base = path.basename(candidate);
    if (base === candidate && base !== "." && base !== "..") return base;
  }
  return undefined;
}

function outputThumbnailUrl(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as JsonRecord;
  for (const key of ["thumbnailUrl", "thumbnail_url", "poster", "poster_url"]) {
    const candidate = firstUrlString(item[key]);
    if (candidate) return candidate;
  }
  return undefined;
}

/**
 * 产物的**附带信息**（文件名 / 封面 / 供应商产物号），按 APIMart 式 `data.result.{images,videos,audios}` 结构读。
 * 它**不再是「结果地址在哪」的来源**（#1213）：地址只由 tasks/taskResultReading 读（先合同、再通用规则），
 * 这里只按地址把附带信息配上去，见 materializationOutputs。
 */
function materializationMetadata(raw: unknown): GenerationProviderOutput[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const payload = raw as JsonRecord;
  const data = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data as JsonRecord : payload;
  const result = data.result && typeof data.result === "object" && !Array.isArray(data.result) ? data.result as JsonRecord : data;
  const outputs: GenerationProviderOutput[] = [];
  for (const [key, kind] of [["images", "image"], ["videos", "video"], ["audios", "audio"]] as const) {
    const values = Array.isArray(result[key]) ? result[key] : [];
    for (const [index, value] of values.entries()) {
      const url = outputUrl(value);
      if (url) {
        const providerOutputId = value && typeof value === "object" && !Array.isArray(value) && typeof (value as JsonRecord).id === "string"
          ? (value as JsonRecord).id as string
          : `${kind}-${index + 1}`;
        const fileName = outputFileName(value);
        const thumbnailUrl = kind === "video" ? outputThumbnailUrl(value) : undefined;
        outputs.push({ kind, url, providerOutputId, ...(fileName ? { fileName } : {}), ...(thumbnailUrl ? { thumbnailUrl } : {}) });
      }
    }
  }
  const directCandidates = [
    { kind: "video" as const, value: result.video_url },
    { kind: "audio" as const, value: result.audio_url },
    { kind: "image" as const, value: result.image_url ?? result.url },
  ];
  for (const candidate of directCandidates) {
    const directUrl = outputUrl(candidate.value);
    if (!directUrl || outputs.some((output) => output.url === directUrl)) continue;
    const fileName = outputFileName(candidate.value) || outputFileName(result);
    outputs.push({ kind: candidate.kind, url: directUrl, ...(fileName ? { fileName } : {}) });
    break;
  }
  return outputs;
}

/**
 * 引擎 B 的产物：地址来自唯一读法（readTaskResponse 给的 assetUrls），种类按地址自身的媒体类型、
 * 认不出时按这条任务期望的种类；文件名 / 封面 / 产物号按地址从附带信息里配。
 */
export function materializationOutputs(raw: unknown, assetUrls: readonly string[], wantedKind: ExpectedMediaKind | null): GenerationProviderOutput[] {
  const metadata = materializationMetadata(raw);
  return assetUrls.map((url, index) => {
    const known = metadata.find((item) => item.url === url);
    // 种类跟着任务走（知道要什么时）：地址扩展名只在不知道期望时作证据（V-1213：扩展名曾把视频任务改判成 image）。
    const kind = wantedKind ?? mediaKindOf(url) ?? known?.kind ?? "image";
    return {
      ...(known ?? {}),
      kind,
      url,
      providerOutputId: known?.providerOutputId ?? `${kind}-${index + 1}`,
    };
  });
}

/**
 * 引擎 B 的取产物：按这条任务的 query 合同（没有就 null = 只用通用规则）经唯一读法取地址，再配附带信息。
 * echoUrls = 这笔任务请求里出现过的地址（提交时发出去的封存 body + 账本里冻结合同的参数），回显的一律不当产物。
 */
export function readMaterializationOutputs(
  raw: unknown,
  query: { responseMapping: JsonRecord | null; statusMapping?: Record<string, string[]> } | null,
  wantedKind: ExpectedMediaKind | null,
  echoUrls: ReadonlySet<string>,
): GenerationProviderOutput[] {
  const reading = readTaskResponse({ response: raw, responseMapping: query?.responseMapping ?? null, statusMapping: query?.statusMapping, wantedKind, echoUrls });
  return materializationOutputs(raw, reading.assetUrls, wantedKind);
}
