/**
 * Shared request-building pipeline — the SINGLE source of truth for turning a
 * (vendor, model, mapping-operation) into a concrete HTTP request.
 *
 * Both sides use it:
 *   - production generation   (electron/runtime.ts :: buildProfileHttpRequest)
 *   - onboarding test-curl    (electron/ai/onboarding/tools.ts :: execute_test_curl)
 *
 * Why this module exists (Plan B, docs/plan/2026-05-31-unify-request-pipeline.md):
 * these two callers used to each carry their OWN template engine, auth-header
 * logic, URL joiner and task-id extractor. They drifted, so a mapping that
 * "passed the wizard test" could still 401/422 in production (the wizard built
 * the request differently than prod). Unifying here makes test == prod.
 *
 * This file is intentionally ELECTRON-FREE so it can be unit-tested offline
 * (see requestPipeline.test.ts). Do not import `electron` here.
 */

export type JsonRecord = Record<string, unknown>;

/** How a vendor authenticates. Mirrors the catalog Vendor.authType field. */
export type AuthType = "none" | "bearer" | "x-api-key" | "query";

/** A single HTTP call template (matches the catalog HttpOperation shape). */
export interface HttpOperationLike {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
}

// ---------------------------------------------------------------------------
// internal primitives (private — not competing with runtime's general utils)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimVal(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    const text = trimVal(value);
    if (text) return text;
  }
  return "";
}

/** Follow a dot-path (`data.resultJson.resultUrls.0`) into an object/array. */
function followPath(root: unknown, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split(".").map((p) => p.trim()).filter(Boolean);
  let cur: unknown = root;
  for (const part of parts) {
    if (Array.isArray(cur)) {
      const idx = Number(part);
      if (!Number.isInteger(idx)) return undefined;
      cur = cur[idx];
    } else if (isRecord(cur)) {
      cur = cur[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

// ---------------------------------------------------------------------------
// template engine — `{{path.into.context}}`
// ---------------------------------------------------------------------------

/**
 * Resolve one `{{...}}` expression against the context. Returns the raw value
 * when the entire string is a single expression (so objects/arrays survive),
 * otherwise interpolates into the string (null/undefined → "").
 */
export function renderTemplateString(input: string, context: JsonRecord): unknown {
  const exact = input.match(/^\{\{\s*([^}]+)\s*\}\}$/);
  if (exact) return followPath(context, exact[1]);
  return input.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, expr: string) => {
    const value = followPath(context, expr);
    if (value == null) return "";
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

function isExactTemplateString(input: unknown): input is string {
  return typeof input === "string" && /^\{\{\s*([^}]+)\s*\}\}$/.test(input);
}

/** Deep-render an arbitrary value (string/array/object), dropping undefined. */
export function renderTemplateValue(value: unknown, context: JsonRecord): unknown {
  if (typeof value === "string") return renderTemplateString(value, context);
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const rendered = renderTemplateValue(item, context);
      if (typeof rendered === "undefined") return [];
      return Array.isArray(rendered) && isExactTemplateString(item) ? rendered : [rendered];
    });
  }
  if (isRecord(value)) {
    const out: JsonRecord = {};
    for (const [key, child] of Object.entries(value)) {
      const rendered = renderTemplateValue(child, context);
      if (typeof rendered !== "undefined") out[key] = rendered;
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// template context — the variables every mapping template can reference
// ---------------------------------------------------------------------------

/**
 * Build the one canonical template context. Both callers feed it the same
 * shape so `{{...}}` placeholders resolve identically in test and production.
 *
 * Placeholders supported:
 *   {{request.prompt}}, {{request.params.<key>}}
 *   {{model.modelKey}}, {{model.model_key}}, {{model.model_alias}}
 *   {{user_api_key}}            (onboarding standard)
 *   {{account.api_key}}, {{account.account_key}}  (legacy hand-authored)
 *   {{providerMeta.task_id}}, {{providerMeta.query_id}}
 */
export function buildTemplateContext(input: {
  request: JsonRecord;
  params: JsonRecord;
  model: JsonRecord;
  modelKey: string;
  apiKey: string;
  providerMeta?: JsonRecord;
}): JsonRecord {
  return {
    request: { ...input.request, params: input.params },
    model: {
      ...input.model,
      modelKey: input.modelKey,
      model_key: input.modelKey,
      model_alias: input.modelKey,
    },
    account: { account_key: input.apiKey, api_key: input.apiKey },
    user_api_key: input.apiKey,
    providerMeta: input.providerMeta ?? {},
  };
}

// ---------------------------------------------------------------------------
// auth + url
// ---------------------------------------------------------------------------

/** Auth headers by auth type. `query`/`none` carry no header. */
export function authHeaders(authType: AuthType, apiKey: string, headerName?: string): Record<string, string> {
  if (!apiKey || authType === "none" || authType === "query") return {};
  if (authType === "x-api-key") return { [headerName || "X-API-Key"]: apiKey };
  return { Authorization: `Bearer ${apiKey}` };
}

/** Auth query params (only for authType === "query"). */
export function authQueryParams(authType: AuthType, apiKey: string, paramName?: string): Record<string, string> {
  if (!apiKey || authType !== "query") return {};
  return { [paramName || "api_key"]: apiKey };
}

/** Join a (possibly absolute) operation path onto the vendor base URL. */
export function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("Base URL missing");
  const p = path.startsWith("/") ? path : `/${path}`;
  // Don't double-append when the base already ends with the path (users paste
  // full URLs like https://api.example.com/v1).
  if (base.endsWith(p)) return base;
  // Collapse a duplicate version segment: if base already ends with a version
  // segment (/v1, /v3, /api/v3, …/codex/v1 …) and the op path starts with /v1/,
  // drop the path's redundant /v1 so we don't build ".../v1/v1/..." (a 404 at
  // code-newcli-com, ".../v1/v1/images/generations") or ".../api/v3/v1/...".
  // SINGLE source of truth — endpoint() in vendorEndpoint.ts delegates here.
  if (p.startsWith("/v1/") && /\/v\d+$/.test(base)) {
    return `${base}${p.slice(3)}`;
  }
  return `${base}${p}`;
}

/** Append query params to a URL, skipping null/empty values. */
export function appendQueryParams(url: string, params: Record<string, unknown>): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (!key || value == null) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item == null || item === "") continue;
      parsed.searchParams.append(key, String(item));
    }
  }
  return parsed.toString();
}

function stringifyHeaders(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(headers)) return out;
  for (const [key, value] of Object.entries(headers)) {
    if (!key || value == null || value === "") continue;
    out[key] = String(value);
  }
  return out;
}

/** Redact secret-bearing header values for logging/preview. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = /authorization|api[-_]?key|token/i.test(key) ? "[redacted]" : value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// the request builder — single source of truth
// ---------------------------------------------------------------------------

export interface BuiltRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  preview: { method: string; url: string; headers: Record<string, string>; body: unknown };
}

/**
 * Build a concrete HTTP request from a mapping operation + an already-built
 * template context. Auth headers are applied first, then mapping headers
 * override them (so an explicit mapping header always wins — and an empty
 * `Authorization: Bearer {{user_api_key}}` can no longer silently beat the
 * correct auth header, because the context now always carries user_api_key).
 */
export function buildHttpRequest(input: {
  baseUrl: string;
  authType: AuthType;
  authHeaderName?: string;
  apiKey: string;
  context: JsonRecord;
  operation: HttpOperationLike;
  /**
   * Relay/proxy-gateway custom auth headers (vendor.meta.extraHeaders). Applied
   * as a base layer alongside standard auth — an explicit mapping header of the
   * same name still wins. This is what makes the image/video profile path carry
   * the same gateway headers the text/AI-SDK path already injects.
   */
  extraHeaders?: Record<string, string>;
}): BuiltRequest {
  const { context, operation } = input;
  const method = (pickString(operation.method) || "POST").toUpperCase();
  const renderedPath = String(renderTemplateValue(operation.path || "/v1/tasks", context) || "/v1/tasks");
  const url = joinUrl(input.baseUrl, renderedPath);

  const renderedHeaders = stringifyHeaders(renderTemplateValue(operation.headers, context));
  const headers: Record<string, string> = {
    ...authHeaders(input.authType, input.apiKey, input.authHeaderName),
    ...(input.extraHeaders || {}),
    ...renderedHeaders,
  };

  const body = renderTemplateValue(operation.body, context);
  if (method !== "GET" && method !== "HEAD" && body != null && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
    headers["Content-Type"] = "application/json";
  }

  const query = isRecord(renderTemplateValue(operation.query, context))
    ? (renderTemplateValue(operation.query, context) as JsonRecord)
    : {};

  return {
    method,
    url,
    headers,
    query,
    body,
    preview: {
      method,
      url: appendQueryParams(url, query),
      headers: redactHeaders(headers),
      body,
    },
  };
}

// ---------------------------------------------------------------------------
// response reading shared by both callers
// ---------------------------------------------------------------------------

/**
 * Extract the upstream task id from a create/query response. Probes (in order):
 *   - an explicit dot-path (from response_mapping.task_id) when provided
 *   - top-level id/taskId/task_id/jobId
 *   - one level into a `data` envelope (kie: data.taskId) — the very common
 *     "{ code, msg, data: {...} }" wrapper.
 *
 * The data-envelope probe is what makes async kie-style APIs poll the RIGHT
 * id instead of a locally-fabricated fallback (which yields "recordInfo is null").
 */
export function extractTaskId(raw: unknown, explicitPath?: string): string {
  if (!isRecord(raw)) return "";
  if (explicitPath) {
    const v = followPath(raw, explicitPath);
    if (typeof v === "string" || typeof v === "number") return String(v);
  }
  const data = isRecord(raw.data) ? raw.data : undefined;
  return pickString(
    raw.id,
    raw.taskId,
    raw.task_id,
    raw.jobId,
    data?.id,
    data?.taskId,
    data?.task_id,
    data?.jobId,
  );
}

/**
 * Many providers (kie.ai and other Java/Spring backends) return HTTP 200 with a
 * logical-error envelope `{ code: 4xx/5xx, msg: "..." }` instead of a real error
 * status. Returns the logical error code if detected, else null.
 */
export function looksLikeLogicalError(body: unknown): number | null {
  if (!isRecord(body)) return null;
  const code = body.code;
  if (typeof code === "number" && code >= 400 && code < 600) return code;
  if (typeof code === "string" && /^\d{3}$/.test(code) && Number(code) >= 400) return Number(code);
  return null;
}
