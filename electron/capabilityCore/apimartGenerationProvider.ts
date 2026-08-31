import type { GenerationProvider, GenerationProviderOutput, ResolvedTaskRequestV1 } from "./generationRuntimeAdapter";
import { appFetch } from "../appFetch";

export type ApimartGenerationProviderOptions = {
  resolveConnection: () => { apiKey: string; baseUrl?: string } | null;
  fetchImpl?: typeof fetch;
};

export class ApimartGenerationProviderError extends Error {
  readonly code = "apimart_provider_error" as const;

  constructor(message: string) {
    super(message);
    this.name = "ApimartGenerationProviderError";
  }
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApimartGenerationProviderError(`APIMart ${label} response is invalid`);
  return value as JsonRecord;
}

function baseUrl(value: string | undefined): string {
  return (value || "https://api.apimart.ai").trim().replace(/\/+$/, "");
}

function parameter(parameters: Record<string, unknown>, ...keys: string[]): unknown {
  return keys.map((key) => parameters[key]).find((value) => value !== undefined && value !== null && value !== "");
}

function buildImageRequest(input: ResolvedTaskRequestV1): JsonRecord {
  const parameters = input.parameters;
  const body: JsonRecord = {
    model: input.modelId,
    prompt: input.prompt,
    size: parameter(parameters, "size", "aspect_ratio", "aspectRatio"),
    resolution: parameter(parameters, "resolution"),
    n: parameter(parameters, "n") ?? 1,
  };
  for (const key of ["negative_prompt", "negativePrompt", "seed", "quality", "background", "image_urls", "input_urls"]) {
    const value = parameters[key];
    if (value !== undefined) body[key === "negativePrompt" ? "negative_prompt" : key === "input_urls" ? "image_urls" : key] = value;
  }
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

async function readJson(response: Response): Promise<JsonRecord> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApimartGenerationProviderError(`APIMart response was not JSON (HTTP ${response.status})`);
  }
  return record(payload, "");
}

function providerMessage(payload: JsonRecord): string {
  const data = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data as JsonRecord : undefined;
  const error = payload.error && typeof payload.error === "object" && !Array.isArray(payload.error) ? payload.error as JsonRecord : undefined;
  return String(error?.message ?? data?.error ?? payload.message ?? payload.msg ?? "request rejected").slice(0, 256);
}

/** First non-empty string in a string-or-string-array field (real Seedance video payloads deliver
 * `videos[].url` as an ARRAY of strings — observed live 2026-08-25, task_01M0VPQMBEN24HA665TM0KQZTS;
 * the docs-implied plain string also occurs, so accept both). */
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

function extractMaterializationOutputs(raw: unknown): GenerationProviderOutput[] {
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
        outputs.push({ kind, url, providerOutputId });
      }
    }
  }
  const directKind = typeof result.video_url === "string" ? "video" : typeof result.audio_url === "string" ? "audio" : typeof result.url === "string" ? "image" : null;
  const directUrl = outputUrl(result);
  if (directKind && directUrl && !outputs.some((output) => output.url === directUrl)) outputs.push({ kind: directKind, url: directUrl });
  return outputs;
}

export function createApimartGenerationProvider(options: ApimartGenerationProviderOptions): GenerationProvider {
  const fetchImpl = options.fetchImpl ?? appFetch;
  const request = async (path: string, init: RequestInit, context: string): Promise<JsonRecord> => {
    let connection: { apiKey: string; baseUrl?: string } | null = null;
    try {
      connection = options.resolveConnection();
    } catch {
      // Credential resolution is deliberately deferred to a real network action.
      // Keep OS/keychain details private while preserving a structured provider error.
    }
    const apiKey = typeof connection?.apiKey === "string" ? connection.apiKey.trim() : "";
    if (!apiKey) throw new ApimartGenerationProviderError("APIMart connection is disabled, missing, or locked");
    const url = `${baseUrl(connection?.baseUrl)}${path}`;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          Authorization: `Bearer ${apiKey}`,
        },
      });
    } catch (error) {
      throw new ApimartGenerationProviderError(`APIMart ${context} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const payload = await readJson(response);
    const code = payload.code;
    if (!response.ok || (code !== undefined && code !== 200 && code !== 0)) {
      throw new ApimartGenerationProviderError(`APIMart ${context} rejected the request: ${providerMessage(payload)}`);
    }
    return payload;
  };
  const queryTask = async (providerTaskId: string) => {
    const taskId = providerTaskId.trim();
    if (!taskId) throw new ApimartGenerationProviderError("APIMart task id is missing");
    const payload = await request(`/v1/tasks/${encodeURIComponent(taskId)}`, {
      method: "GET",
    }, "task query");
    const data = record(payload.data, "task query");
    const status = typeof data.status === "string" ? data.status : "unknown";
    return { status, raw: payload };
  };
  return {
    providerId: "apimart",
    capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false, materialize: true },
    buildRequest: buildImageRequest,
    async submit(providerRequest) {
      const payload = await request("/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record(providerRequest, "submit")),
      }, "image submission");
      const first = Array.isArray(payload.data) ? payload.data[0] : undefined;
      const taskId = first && typeof first === "object" && !Array.isArray(first) ? (first as JsonRecord).task_id : undefined;
      if (typeof taskId !== "string" || !taskId.trim()) throw new ApimartGenerationProviderError("APIMart submission did not return a task id");
      return { providerTaskId: taskId.trim(), raw: payload };
    },
    query: queryTask,
    async materialize(input) {
      return { outputs: extractMaterializationOutputs(input.raw), raw: input.raw };
    },
    async reconcile(input) {
      if (!input.providerTaskId?.trim()) return { disposition: "indeterminate" };
      const result = await queryTask(input.providerTaskId);
      return { disposition: "found", providerTaskId: input.providerTaskId, raw: result.raw };
    },
  };
}
