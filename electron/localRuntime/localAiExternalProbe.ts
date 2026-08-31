import { createHash } from "node:crypto";

import { isJsonRecord, findIllegalHeader } from "../jsonUtils";
import { isPrivateHost } from "../networkHostPolicy";
import { parseModelListPage } from "../ai/onboarding/modelListResponse";
import { hardenedFetch } from "../hardenedFetch";
import type {
  LocalRuntimeCapability,
  LocalRuntimeDescriptor,
  LocalRuntimeDiagnostic,
  LocalRuntimeOutput,
  LocalRuntimeSupport,
} from "./localRuntimeDescriptor";

const PROBE_TIMEOUT_MS = 12_000;
const PROBE_MAX_BYTES = 2 * 1024 * 1024;
const MAX_MODELS = 2_000;

type LocalAiAuthHeader = "authorization" | "x-api-key" | "xi-api-key";

export type LocalAiExternalProbeInput = {
  baseUrl: string;
  apiKey?: string;
  authHeader?: LocalAiAuthHeader;
  authScope?: "user" | "admin" | "unknown";
  signal?: AbortSignal;
};

export type LocalAiProbeFetch = (request: {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  allowedPrivateOrigins: string[];
}) => Promise<{ status: number; body: string }>;

export type LocalAiExternalProbeDependencies = {
  fetch?: LocalAiProbeFetch;
  now?: () => string;
};

type NormalizedTarget = {
  origin: string;
  rootUrl: URL;
  apiBaseUrl: string;
  allowedPrivateOrigins: string[];
};

type WellKnown = {
  version?: string;
  modelCapabilitiesEndpoint?: string;
};

type ProbeState = {
  diagnostics: LocalRuntimeDiagnostic[];
  sawHttpResponse: boolean;
  degraded: boolean;
  unauthorized: boolean;
  modelAccessConfirmed: boolean;
};

function cleanString(value: unknown, maxLength = 200): string {
  if (typeof value !== "string") return "";
  const clean = value.trim();
  return clean && clean.length <= maxLength ? clean : "";
}

function uniqueStrings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const item of value) {
    const clean = cleanString(item, 80);
    if (!clean) return null;
    if (!output.includes(clean)) output.push(clean);
  }
  return output;
}

function parseJsonRecord(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return isJsonRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeTarget(rawBaseUrl: string): NormalizedTarget {
  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl.trim());
  } catch {
    throw new Error("Invalid LocalAI address");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Invalid LocalAI address");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  const rootUrl = new URL(parsed.toString());
  rootUrl.pathname = rootUrl.pathname.replace(/\/v1$/i, "") || "/";
  const apiUrl = new URL(rootUrl.toString());
  apiUrl.pathname = `${rootUrl.pathname.replace(/\/+$/, "")}/v1`.replace(/^\/\//, "/");
  return {
    origin: parsed.origin,
    rootUrl,
    apiBaseUrl: apiUrl.toString().replace(/\/+$/, ""),
    allowedPrivateOrigins: isPrivateHost(parsed.hostname) ? [parsed.origin] : [],
  };
}

function rootEndpoint(target: NormalizedTarget, path: string): string {
  const endpoint = new URL(target.rootUrl.toString());
  endpoint.pathname = `${target.rootUrl.pathname.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.toString();
}

function protectedHeaders(input: LocalAiExternalProbeInput): Record<string, string> {
  const apiKey = String(input.apiKey || "").trim();
  if (!apiKey) return {};
  const header = input.authHeader || "authorization";
  const headers = header === "authorization"
    ? { authorization: `Bearer ${apiKey}` }
    : { [header]: apiKey };
  if (findIllegalHeader(headers)) throw new Error("Invalid LocalAI credential");
  return headers;
}

async function defaultProbeFetch(request: Parameters<LocalAiProbeFetch>[0]): Promise<{ status: number; body: string }> {
  const response = await hardenedFetch(request.url, {
    method: "GET",
    headers: request.headers,
    signal: request.signal,
    allowRedirect: false,
    throwOnNon2xx: false,
    maxBytes: PROBE_MAX_BYTES,
    allowedPrivateOrigins: request.allowedPrivateOrigins,
  });
  return { status: response.status, body: response.bytes.toString("utf8") };
}

function parseWellKnown(body: string): WellKnown | null {
  const record = parseJsonRecord(body);
  if (!record || !isJsonRecord(record.endpoints)) return null;
  const version = cleanString(record.version, 120);
  const modelCapabilitiesEndpoint = cleanString(record.endpoints.models_capabilities, 2_000);
  return {
    ...(version ? { version } : {}),
    ...(modelCapabilitiesEndpoint ? { modelCapabilitiesEndpoint } : {}),
  };
}

function safeAdvertisedEndpoint(
  target: NormalizedTarget,
  advertised: string | undefined,
  fallbackPath: string,
): string {
  if (advertised) {
    try {
      const candidate = new URL(advertised, `${target.origin}/`);
      if (
        candidate.origin === target.origin &&
        !candidate.username &&
        !candidate.password &&
        !candidate.hash &&
        (candidate.protocol === "http:" || candidate.protocol === "https:")
      ) {
        return candidate.toString();
      }
    } catch {
      // Fall back to the fixed, same-origin LocalAI contract.
    }
  }
  return rootEndpoint(target, fallbackPath);
}

const OUTPUT_ORDER: LocalRuntimeOutput[] = ["text", "image", "video", "audio", "model3d"];
const SUPPORT_ORDER: LocalRuntimeSupport[] = ["stream", "tools", "submit", "query", "reconcile", "cancel"];

function outputKinds(modalities: string[], capabilities: string[]): LocalRuntimeOutput[] {
  const declared = new Set(modalities.map((item) => item.toLowerCase()));
  const usecases = new Set(capabilities.map((item) => item.toLowerCase()));
  if (declared.has("3d") || declared.has("model3d") || usecases.has("3d") || usecases.has("model3d")) {
    declared.add("model3d");
  }
  return OUTPUT_ORDER.filter((kind) => declared.has(kind));
}

function supportedOperations(capabilities: string[]): LocalRuntimeSupport[] {
  const declared = new Set(capabilities.map((item) => item.toLowerCase()));
  return SUPPORT_ORDER.filter((support) => support === "stream" || support === "tools"
    ? declared.has(support)
    : false);
}

function parseCapabilities(body: string, endpoint: string, checkedAt: string): LocalRuntimeCapability[] | null {
  const record = parseJsonRecord(body);
  if (!record || !Array.isArray(record.data) || record.data.length > MAX_MODELS) return null;
  const capabilities: LocalRuntimeCapability[] = [];
  const seen = new Set<string>();
  for (const item of record.data) {
    if (!isJsonRecord(item)) return null;
    const modelId = cleanString(item.id, 500);
    const declaredCapabilities = uniqueStrings(item.capabilities);
    const inputModes = uniqueStrings(item.input_modalities);
    const outputModes = uniqueStrings(item.output_modalities);
    if (!modelId || !declaredCapabilities || !inputModes || !outputModes) return null;
    if (seen.has(modelId)) continue;
    seen.add(modelId);
    capabilities.push({
      modelId,
      outputs: outputKinds(outputModes, declaredCapabilities),
      inputModes,
      supports: supportedOperations(declaredCapabilities),
      evidence: {
        source: "discovery",
        endpoint: new URL(endpoint).pathname,
        checkedAt,
      },
    });
  }
  return capabilities;
}

function parseFallbackModels(body: string, endpoint: string, checkedAt: string): LocalRuntimeCapability[] | null {
  const parsed = parseModelListPage(body);
  if (!parsed.ok || parsed.next || parsed.afterId || parsed.models.length > MAX_MODELS) return null;
  return parsed.models.map((modelId) => ({
    modelId,
    outputs: [],
    inputModes: [],
    supports: [],
    evidence: {
      source: "discovery",
      endpoint: new URL(endpoint).pathname,
      checkedAt,
    },
  }));
}

function diagnostic(
  state: ProbeState,
  stage: LocalRuntimeDiagnostic["stage"],
  code: LocalRuntimeDiagnostic["code"],
  status?: number,
): void {
  state.diagnostics.push({ stage, code, ...(status !== undefined ? { status } : {}) });
  if (code === "unauthorized") state.unauthorized = true;
  if (code !== "unsupported" && code !== "network") state.degraded = true;
}

function classifyHttpFailure(
  state: ProbeState,
  stage: LocalRuntimeDiagnostic["stage"],
  status: number,
): void {
  if (status === 401 || status === 403) diagnostic(state, stage, "unauthorized", status);
  else if (status === 404 || status === 405) diagnostic(state, stage, "unsupported", status);
  else if (status >= 300 && status < 400) diagnostic(state, stage, "invalid_response", status);
  else diagnostic(state, stage, "upstream", status);
}

function stableRuntimeId(origin: string): string {
  return `localai:${createHash("sha256").update(origin).digest("hex").slice(0, 16)}`;
}

function combinedSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function probeLocalAiExternalRuntime(
  input: LocalAiExternalProbeInput,
  dependencies: LocalAiExternalProbeDependencies = {},
): Promise<LocalRuntimeDescriptor> {
  const target = normalizeTarget(input.baseUrl);
  const requestTransport = dependencies.fetch || defaultProbeFetch;
  const checkedAt = (dependencies.now || (() => new Date().toISOString()))();
  const signal = combinedSignal(input.signal);
  const authHeaders = protectedHeaders(input);
  const state: ProbeState = {
    diagnostics: [],
    sawHttpResponse: false,
    degraded: false,
    unauthorized: false,
    modelAccessConfirmed: false,
  };
  const request = async (
    stage: LocalRuntimeDiagnostic["stage"],
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: string } | null> => {
    try {
      const result = await requestTransport({
        url,
        headers,
        signal,
        allowedPrivateOrigins: target.allowedPrivateOrigins,
      });
      state.sawHttpResponse = true;
      return result;
    } catch {
      diagnostic(state, stage, "network");
      return null;
    }
  };

  let identity: LocalRuntimeDescriptor["identity"] = "assumed";
  let version: string | undefined;
  let advertisedCapabilitiesEndpoint: string | undefined;

  const discovery = await request(
    "discovery",
    rootEndpoint(target, "/.well-known/localai.json"),
    {},
  );
  if (discovery) {
    if (discovery.status >= 200 && discovery.status < 300) {
      const parsed = parseWellKnown(discovery.body);
      if (parsed) {
        identity = "confirmed";
        version = parsed.version;
        advertisedCapabilitiesEndpoint = parsed.modelCapabilitiesEndpoint;
      } else {
        diagnostic(state, "discovery", "invalid_response", discovery.status);
      }
    } else if (discovery.status !== 404 && discovery.status !== 405) {
      classifyHttpFailure(state, "discovery", discovery.status);
    }
  }

  const readiness = await request("readiness", rootEndpoint(target, "/readyz"), {});
  if (readiness) {
    if (readiness.status === 503) diagnostic(state, "readiness", "starting", 503);
    else if (readiness.status < 200 || readiness.status >= 300) {
      if (readiness.status !== 404 && readiness.status !== 405) {
        classifyHttpFailure(state, "readiness", readiness.status);
      }
    }
  }

  if (!version && identity === "assumed") {
    const versionResult = await request("version", rootEndpoint(target, "/version"), authHeaders);
    if (versionResult) {
      if (versionResult.status >= 200 && versionResult.status < 300) {
        const record = parseJsonRecord(versionResult.body);
        version = cleanString(record?.version, 120) || undefined;
        if (!version) diagnostic(state, "version", "invalid_response", versionResult.status);
      } else if (versionResult.status !== 404 && versionResult.status !== 405) {
        classifyHttpFailure(state, "version", versionResult.status);
      }
    }
  }

  const capabilitiesUrl = safeAdvertisedEndpoint(
    target,
    advertisedCapabilitiesEndpoint,
    "/v1/models/capabilities",
  );
  let capabilities: LocalRuntimeCapability[] = [];
  let fallbackRequired = true;
  const capabilityResult = await request("capabilities", capabilitiesUrl, authHeaders);
  if (capabilityResult) {
    if (capabilityResult.status >= 200 && capabilityResult.status < 300) {
      const parsed = parseCapabilities(capabilityResult.body, capabilitiesUrl, checkedAt);
      if (parsed) {
        capabilities = parsed;
        state.modelAccessConfirmed = true;
        fallbackRequired = false;
      } else {
        diagnostic(state, "capabilities", "invalid_response", capabilityResult.status);
      }
    } else {
      classifyHttpFailure(state, "capabilities", capabilityResult.status);
      if (capabilityResult.status === 401 || capabilityResult.status === 403) fallbackRequired = false;
    }
  }

  if (fallbackRequired) {
    const modelsUrl = rootEndpoint(target, "/v1/models");
    const modelsResult = await request("models", modelsUrl, authHeaders);
    if (modelsResult) {
      if (modelsResult.status >= 200 && modelsResult.status < 300) {
        const parsed = parseFallbackModels(modelsResult.body, modelsUrl, checkedAt);
        if (parsed) {
          capabilities = parsed;
          state.modelAccessConfirmed = true;
        } else {
          diagnostic(state, "models", "invalid_response", modelsResult.status);
        }
      } else {
        classifyHttpFailure(state, "models", modelsResult.status);
      }
    }
  }

  const health = state.unauthorized
    ? "unauthorized"
    : !state.sawHttpResponse
      ? "offline"
      : state.degraded || !state.modelAccessConfirmed
        ? "degraded"
        : "ready";
  const hasApiKey = Boolean(String(input.apiKey || "").trim());

  return {
    schemaVersion: 1,
    deployment: "external",
    runtimeId: stableRuntimeId(target.origin),
    kind: "localai",
    origin: target.origin,
    apiBaseUrl: target.apiBaseUrl,
    ...(version ? { version } : {}),
    identity,
    auth: {
      mode: hasApiKey ? "api-key" : "none",
      scope: hasApiKey ? input.authScope || "unknown" : "none",
    },
    health,
    capabilities,
    certification: "uncertified",
    diagnostics: state.diagnostics,
    checkedAt,
  };
}
