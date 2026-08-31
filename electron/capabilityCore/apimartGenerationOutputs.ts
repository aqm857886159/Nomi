import path from "node:path";

import type { GenerationProviderOutput } from "./generationRuntimeAdapter";

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

export function extractMaterializationOutputs(raw: unknown): GenerationProviderOutput[] {
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
        outputs.push({ kind, url, providerOutputId, ...(fileName ? { fileName } : {}) });
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
