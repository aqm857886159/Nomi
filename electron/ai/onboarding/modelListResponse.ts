import { isJsonRecord, pickUpstreamMessage } from "../../jsonUtils";

export type ModelListFailureKind = "unsupported" | "auth" | "rate_limit" | "network" | "invalid_response" | "upstream";

export type ModelListPage =
  | { ok: true; models: string[]; descriptors?: ModelListDescriptor[]; next?: string; afterId?: string }
  | { ok: false; failureKind: ModelListFailureKind; error?: string };

/** Optional metadata carried by OpenRouter-style model records. Bare `{id}`
 * responses intentionally have no descriptor and must use the catalog match
 * or plain-text fallback at the integration boundary. */
export type ModelListDescriptor = {
  id: string;
  architecture?: {
    inputModalities?: string[];
    outputModalities?: string[];
    supportedParameters?: string[];
  };
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function failureCode(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  const code = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(code)) return code !== 0 && (code < 200 || code >= 300);
  return typeof value === "string" && !/^(ok|success|succeeded)$/i.test(value);
}

/** Check the business envelope before data:[]; HTTP 200 alone is not a success. */
function businessFailure(json: unknown, sanitize?: (message: string) => string): Extract<ModelListPage, { ok: false }> | null {
  if (!isJsonRecord(json)) return null;
  const error = json.error;
  const hasError = error !== undefined && error !== null && error !== false && error !== "";
  const nested = isJsonRecord(error) ? error : {};
  const failed = hasError || json.success === false || failureCode(json.code) || failureCode(json.status) ||
    (json.errors !== undefined && json.errors !== null && json.errors !== false && json.errors !== "");
  if (!failed) return null;
  const codes = [json.code, json.status, nested.code, nested.status, nested.type]
    .filter((value) => typeof value === "string" || typeof value === "number")
    .map(String);
  const labels = codes.join(" ");
  const failureKind: ModelListFailureKind = codes.some((code) => code === "401" || code === "403") ||
    /invalid[_ -]?(api[_ -]?)?key|authentication|unauthori[sz]ed|forbidden|permission[_ -]?(denied|error)/i.test(labels)
    ? "auth"
    : codes.includes("429") || /rate[_ -]?limit|too[_ -]?many[_ -]?requests/i.test(labels)
      ? "rate_limit"
      : "upstream";
  return { ok: false, failureKind, error: pickUpstreamMessage(json, sanitize) || "Model-list request was rejected by the upstream service" };
}

/** Response shape, not vendor identity, determines the list and pagination protocol. */
export function parseModelListPage(bodyText: string, sanitize?: (message: string) => string): ModelListPage {
  let json: unknown;
  try { json = JSON.parse(bodyText); } catch { return { ok: false, failureKind: "invalid_response" }; }
  const failed = businessFailure(json, sanitize);
  if (failed) return failed;
  const record = isJsonRecord(json) ? json : {};
  const nativeResults = Array.isArray(record.results) && !Array.isArray(record.data);
  const list = Array.isArray(json) ? json : Array.isArray(record.data) ? record.data : nativeResults ? record.results as unknown[] : null;
  if (!list) return { ok: false, failureKind: "invalid_response" };
  const descriptors = list.map((item): ModelListDescriptor | null => {
    if (!isJsonRecord(item)) return null;
    const id = nativeResults ? (() => {
      const owner = text(item.owner); const name = text(item.name);
      return owner && name ? `${owner}/${name}` : "";
    })() : text(item.id);
    if (!id) return null;
    const architecture = isJsonRecord(item.architecture) ? item.architecture : undefined;
    if (!architecture) return null;
    const arrayOfText = (value: unknown): string[] | undefined => {
      if (!Array.isArray(value)) return undefined;
      const values = value.map(text).filter(Boolean);
      return values.length ? values : undefined;
    };
    const inputModalities = arrayOfText(architecture.input_modalities);
    const outputModalities = arrayOfText(architecture.output_modalities);
    const supportedParameters = arrayOfText(architecture.supported_parameters);
    return {
      id,
      architecture: {
        ...(inputModalities ? { inputModalities } : {}),
        ...(outputModalities ? { outputModalities } : {}),
        ...(supportedParameters ? { supportedParameters } : {}),
      },
    };
  }).filter((item): item is ModelListDescriptor => Boolean(item));
  const ids = list.map((item) => {
    if (typeof item === "string") return item.trim();
    if (!isJsonRecord(item)) return "";
    if (nativeResults) {
      const owner = text(item.owner);
      const name = text(item.name);
      return owner && name ? `${owner}/${name}` : "";
    }
    return text(item.id);
  }).filter(Boolean);
  if (list.length > 0 && ids.length === 0) return { ok: false, failureKind: "invalid_response" };
  const models = [...new Set(ids)];
  // Replicate official HTTP API /models + SDK paginate(): results and next URL.
  // https://replicate.com/docs/reference/http/#models.list (checked 2026-08-27)
  const uniqueDescriptors = [...new Map(descriptors.map((descriptor) => [descriptor.id, descriptor])).values()];
  const detail = uniqueDescriptors.length ? { descriptors: uniqueDescriptors } : {};
  if (record.next !== undefined && record.next !== null) {
    if (!text(record.next)) return { ok: false, failureKind: "invalid_response", error: "Invalid model-list pagination link" };
    return { ok: true, models, ...detail, next: text(record.next) };
  }
  // Anthropic's official list protocol uses last_id as the after_id query cursor.
  // https://platform.claude.com/docs/en/api/models/list (checked 2026-08-27)
  if (record.has_more !== undefined && typeof record.has_more !== "boolean") {
    return { ok: false, failureKind: "invalid_response", error: "Invalid model-list pagination state" };
  }
  if (record.has_more === true) {
    const afterId = text(record.last_id);
    if (!afterId) return { ok: false, failureKind: "invalid_response", error: "Missing model-list pagination cursor" };
    return { ok: true, models, ...detail, afterId };
  }
  return { ok: true, models, ...detail };
}

/** null is malformed/not a list; [] is a genuinely empty list. No ID coercion. */
export function parseModelListResponse(bodyText: string): string[] | null {
  const page = parseModelListPage(bodyText);
  return page.ok ? page.models : null;
}
