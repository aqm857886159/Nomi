import type { GenerationProvider, GenerationProviderRequestInputV1 } from "./generationRuntimeAdapter";
import { appFetch } from "../appFetch";
import { extractMaterializationOutputs } from "./apimartGenerationOutputs";
import { joinUrl } from "../ai/requestPipeline";
import { productionGenerationPayloadHash } from "../productionRun/productionGenerationAuthorization";
import { readCatalog } from "../catalog/catalogStore";
import { builtinVendorScopeMatches, isBuiltinDirectKeyVendor } from "../catalog/builtinVendorSeeds";
import { hasBuiltinCuratedExecution } from "../catalog/seedBuiltins";
import {
  billingKindForTaskKind,
  selectTaskMapping,
  type CatalogState,
  type Mapping,
  type Model,
  type ProfileKind,
  type Vendor,
} from "../catalog/types";
import { derivePublishedExecution } from "../shared/modelPublication";
import { buildProfileHttpRequest } from "../catalog/profileHttpRequest";
import { extractVendorExtraHeaders } from "../catalog/catalogStore";
import { applyHeadlessParamDefaults } from "../catalog/taskParams";
import { bodyReferencedParamKeys } from "../catalog/paramTranslate";
import type { TaskRequest } from "../runtime";
import "../catalog/apimartMinimaxH3";
import { applyRequestTransformSync, validateRequestTransformSync } from "../tasks/requestTransforms";
import { apimartTaskQueryPath } from "./apimartGenerationQuery";
import { mirrorApimartReferenceParameterAliases } from "./apimartGenerationReferenceAliases";
import {
  assertReferenceParameters,
  assertReferencesReachBody,
  normalizeParameters,
  projectReferenceUrls,
  sameJson,
  type ApimartReferenceUrlResolver,
} from "./apimartGenerationProjection";
import { ApimartGenerationProviderError } from "./apimartGenerationErrors";

export type {
  ApimartImageReferenceWithRole,
  ApimartReferenceProjection,
  ApimartReferenceUrlResolver,
} from "./apimartGenerationProjection";
export { ApimartGenerationProviderError } from "./apimartGenerationErrors";

export type ApimartGenerationProviderOptions = {
  resolveConnection: () => { apiKey: string; baseUrl?: string } | null;
  fetchImpl?: typeof fetch;
  /**
   * Zero-cost Electron fixture seam. The bootstrap validates this as a
   * loopback origin and enables it only under the explicit production
   * fixture flag; the catalog/vendor contract remains canonical APIMart.
   */
  fixtureBaseUrlOverride?: string;
  /** Read the current, persisted catalog. A semantic request is never built
   * from a guessed endpoint or an ad-hoc model id; the selected mapping is
   * sealed against this snapshot before approval and checked again at submit. */
  catalogReader?: () => CatalogState;
  /**
   * Resolve the sealed contract's asset references to provider-reachable URLs.
   * This hook is synchronous because `buildRequest` runs twice before the
   * paid-operation approval is issued. The caller must complete local asset
   * upload before invoking the adapter; this adapter never uploads or
   * persists credentials.  Returning `undefined` leaves canonical URL
   * parameters untouched.
   */
  resolveReferenceUrls?: ApimartReferenceUrlResolver;
};

type JsonRecord = Record<string, unknown>;

type ApimartGenerationEndpoint = "images" | "videos";

type CatalogSelection = Readonly<{
  vendor: Vendor;
  model: Model;
  mapping: Mapping;
  endpoint: ApimartGenerationEndpoint;
  fingerprint: string;
}>;

type PreparedRequest = Readonly<{
  modelKey: string;
  mappingId: string;
  taskKind: ProfileKind;
  endpoint: ApimartGenerationEndpoint;
  fingerprint: string;
}>;

/** Explicit semantic aliases; unknown modes cannot fall through to a paid endpoint. */
const MODE_TO_TASK_KIND: Record<string, ProfileKind> = {
  text_to_image: "text_to_image",
  "text-to-image": "text_to_image",
  image_to_image: "image_edit",
  "image-to-image": "image_edit",
  image_edit: "image_edit",
  "image-edit": "image_edit",
  text_to_video: "text_to_video",
  "text-to-video": "text_to_video",
  image_to_video: "image_to_video",
  "image-to-video": "image_to_video",
  reference_to_video: "image_to_video",
  "reference-to-video": "image_to_video",
  first_last: "image_to_video",
  firstlast: "image_to_video",
  video_edit: "image_to_video",
  "video-edit": "image_to_video",
};

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApimartGenerationProviderError(`APIMart ${label} response is invalid`);
  return value as JsonRecord;
}

function strictBaseUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new ApimartGenerationProviderError("APIMart catalog vendor base URL is missing");
  const candidate = value.trim().replace(/\/+$/, "");
  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("invalid URL");
    return candidate;
  } catch {
    throw new ApimartGenerationProviderError("APIMart catalog vendor base URL is invalid");
  }
}

function safeFixtureBaseUrl(value: unknown): string | undefined {
  if (process.env.NOMI_E2E_PRODUCTION_FIXTURE !== "1" || typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function normalizedMode(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return MODE_TO_TASK_KIND[raw] || "";
}

function taskKindForMode(value: unknown): ProfileKind {
  const mode = normalizedMode(value);
  if (!mode) throw new ApimartGenerationProviderError(`APIMart generation mode is unsupported: ${String(value)}`);
  return mode as ProfileKind;
}

function readCatalogSnapshot(reader: () => CatalogState): CatalogState {
  let state: CatalogState;
  try {
    state = reader();
  } catch {
    throw new ApimartGenerationProviderError("APIMart catalog is unavailable");
  }
  if (!state || !Array.isArray(state.vendors) || !Array.isArray(state.models) || !Array.isArray(state.mappings)) {
    throw new ApimartGenerationProviderError("APIMart catalog is invalid");
  }
  return state;
}

function hasAdapterMetadata(meta: unknown): boolean {
  return Boolean(meta && typeof meta === "object" && !Array.isArray(meta)
    && Object.prototype.hasOwnProperty.call(meta, "adapter"));
}

/**
 * APIMart's built-in provider is a direct-key, code-owned transport.  A
 * certification-owned vendor/model carries an adapter contract whose auth,
 * endpoint, and lifecycle may differ (for example x-api-key or a custom
 * query path).  This provider cannot consume that contract safely, so it must
 * never silently take ownership of the row and force Bearer + APIMart paths.
 */
function assertDirectKeyContract(state: CatalogState, vendor: Vendor): void {
  if (!isBuiltinDirectKeyVendor(vendor.key)) return;
  const certificationOwned = hasAdapterMetadata(vendor.meta)
    || state.models.some((model) => model.vendorKey === vendor.key && hasAdapterMetadata(model.meta));
  if (certificationOwned) {
    throw new ApimartGenerationProviderError("APIMart certification-owned connection requires its certified transport");
  }
  if (!builtinVendorScopeMatches(vendor) || !hasBuiltinCuratedExecution(state, vendor.key)) {
    throw new ApimartGenerationProviderError("APIMart catalog direct-key contract is unavailable; restore the built-in Settings connection");
  }
}

function endpointForMapping(mapping: Mapping, taskKind: ProfileKind): ApimartGenerationEndpoint {
  const method = typeof mapping.create.method === "string" ? mapping.create.method.trim().toUpperCase() : "";
  if (method !== "POST") throw new ApimartGenerationProviderError(`APIMart catalog mapping ${mapping.id} must use POST`);
  const path = typeof mapping.create.path === "string" ? mapping.create.path.trim().replace(/\/+$/, "") : "";
  const endpoint = path === "/v1/images/generations" ? "images" : path === "/v1/videos/generations" ? "videos" : null;
  if (!endpoint) throw new ApimartGenerationProviderError(`APIMart catalog mapping ${mapping.id} has an unsupported create path`);
  const expected = billingKindForTaskKind(taskKind) === "video" ? "videos" : "images";
  if (endpoint !== expected) throw new ApimartGenerationProviderError(`APIMart catalog mapping ${mapping.id} does not match ${taskKind}`);
  return endpoint;
}

function assertCanonicalQueryMapping(mapping: Mapping): void {
  const query = mapping.query;
  const path = typeof query?.path === "string" ? query.path.trim().replace(/\/+$/, "") : "";
  const method = typeof query?.method === "string" ? query.method.trim().toUpperCase() : "";
  const canonicalPath = apimartTaskQueryPath() + "/{{providerMeta.task_id}}";
  if (method !== "GET" || path !== canonicalPath) {
    throw new ApimartGenerationProviderError("APIMart catalog mapping " + mapping.id + " has an unsupported query path");
  }
}

function catalogFingerprint(selection: { vendor: Vendor; model: Model; mapping: Mapping }): string {
  try {
    return productionGenerationPayloadHash({
      vendor: {
        key: selection.vendor.key,
        enabled: selection.vendor.enabled,
        baseUrlHint: selection.vendor.baseUrlHint,
        authType: selection.vendor.authType,
        authHeader: selection.vendor.authHeader,
        authQueryParam: selection.vendor.authQueryParam,
        providerKind: selection.vendor.providerKind,
        // Extra headers are part of the effective transport identity. They
        // must be frozen with the model/base URL so a header change after
        // approval cannot silently alter the paid request.
        extraHeaders: extractVendorExtraHeaders(selection.vendor),
      },
      model: {
        vendorKey: selection.model.vendorKey,
        modelKey: selection.model.modelKey,
        modelAlias: selection.model.modelAlias,
        kind: selection.model.kind,
        enabled: selection.model.enabled,
        meta: selection.model.meta,
      },
      mapping: {
        id: selection.mapping.id,
        vendorKey: selection.mapping.vendorKey,
        modelKey: selection.mapping.modelKey,
        taskKind: selection.mapping.taskKind,
        enabled: selection.mapping.enabled,
        create: selection.mapping.create,
        query: selection.mapping.query,
        statusMapping: selection.mapping.statusMapping,
      },
    });
  } catch {
    throw new ApimartGenerationProviderError("APIMart catalog identity is not serializable");
  }
}

function selectCatalogSelection(
  reader: () => CatalogState,
  modelKey: string,
  taskKind: ProfileKind,
): CatalogSelection {
  const state = readCatalogSnapshot(reader);
  const vendor = state.vendors.find((candidate) => candidate.key === "apimart" && candidate.enabled);
  if (!vendor) throw new ApimartGenerationProviderError("APIMart catalog vendor is unavailable");
  const model = state.models.find((candidate) => candidate.vendorKey === "apimart"
    && candidate.modelKey === modelKey
    && candidate.enabled
    && candidate.kind === billingKindForTaskKind(taskKind));
  if (!model) throw new ApimartGenerationProviderError(`APIMart catalog model is unavailable: ${modelKey}`);
  const publication = derivePublishedExecution(model, { mappings: state.mappings });
  if (!publication.publishedModes.includes(taskKind)) {
    throw new ApimartGenerationProviderError(`APIMart catalog mapping is unavailable: ${modelKey}/${taskKind}`);
  }
  const mapping = selectTaskMapping(state.mappings, "apimart", taskKind, model.modelKey);
  if (!mapping) throw new ApimartGenerationProviderError(`APIMart catalog mapping is unavailable: ${modelKey}/${taskKind}`);
  const endpoint = endpointForMapping(mapping, taskKind);
  assertCanonicalQueryMapping(mapping);
  strictBaseUrl(vendor.baseUrlHint);
  // Keep this check after ordinary catalog diagnostics so a missing mapping or
  // malformed endpoint reports its actionable cause rather than a generic
  // ownership error.
  assertDirectKeyContract(state, vendor);
  return { vendor, model, mapping, endpoint, fingerprint: catalogFingerprint({ vendor, model, mapping }) };
}

function projectionRequest(
  input: GenerationProviderRequestInputV1,
  selection: CatalogSelection,
  resolver: ApimartReferenceUrlResolver | undefined,
): JsonRecord {
  if (!input.prompt || !input.prompt.trim()) throw new ApimartGenerationProviderError("APIMart prompt is required");
  const projected = projectReferenceUrls(input, resolver);
  const parameters = normalizeParameters(projected.parameters, selection.mapping);
  mirrorApimartReferenceParameterAliases(parameters, selection.mapping.create.body, sameJson);
  const archetypeId = selection.model.meta && typeof selection.model.meta === "object" && !Array.isArray(selection.model.meta)
    ? (selection.model.meta as Record<string, unknown>).archetypeId
    : undefined;
  let defaulted: Record<string, unknown>;
  try {
    defaulted = applyHeadlessParamDefaults(parameters, typeof archetypeId === "string" ? archetypeId : undefined,
      selection.mapping.taskKind, "apimart", selection.mapping.create.defaultParams,
      selection.mapping.create.body, selection.model.modelKey) || {};
  } catch {
    throw new ApimartGenerationProviderError(`APIMart catalog mapping defaults are invalid: ${selection.mapping.id}`);
  }
  const bodyParameterKeys = bodyReferencedParamKeys(selection.mapping.create.body);
  if (bodyParameterKeys.includes("model")) {
    const transportModel = input.transportModelId?.trim();
    if (transportModel) defaulted.model = transportModel;
    else if (typeof defaulted.model !== "string" || !defaulted.model.trim()) defaulted.model = input.modelId;
  }
  const request = {
    kind: selection.mapping.taskKind,
    prompt: input.prompt,
    extras: defaulted,
  } as TaskRequest;
  let built: ReturnType<typeof buildProfileHttpRequest>;
  try {
    built = buildProfileHttpRequest({
      vendor: selection.vendor,
      model: selection.model,
      // The profile renderer needs a value for auth placeholders. This value
      // is never sent: submit resolves the real key only at the network edge.
      apiKey: "__nomi_catalog_projection__",
      request,
      operation: selection.mapping.create,
    });
  } catch {
    throw new ApimartGenerationProviderError(`APIMart catalog mapping cannot render: ${selection.mapping.id}`);
  }
  const body = record(built.body, "catalog request");
  assertNoProjectionCredential(body);
  const transformed = applyCatalogRequestTransform(body, selection, request);
  assertNoProjectionCredential(transformed);
  assertReferenceParameters(transformed);
  assertReferencesReachBody(input, defaulted, transformed);
  return transformed;
}

function transformRequestContext(input: GenerationProviderRequestInputV1): TaskRequest {
  return {
    kind: taskKindForMode(input.mode),
    prompt: input.prompt,
    extras: structuredClone(input.parameters),
  } as TaskRequest;
}

function assertNoProjectionCredential(body: JsonRecord): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(body);
  } catch {
    throw new ApimartGenerationProviderError("APIMart catalog request is not serializable");
  }
  if (serialized?.includes("__nomi_catalog_projection__")) {
    throw new ApimartGenerationProviderError("APIMart catalog mapping attempted to place credentials in the request body");
  }
}

/**
 * Run the catalog's declared request transform at both approval and network
 * boundaries.  `buildRequest` is intentionally synchronous, so the shared
 * registry's sync bridge rejects an async transform instead of accidentally
 * approving a Promise or bypassing a model-specific guard.
 */
function applyCatalogRequestTransform(
  body: JsonRecord,
  selection: CatalogSelection,
  request?: TaskRequest,
  options: { requireStable?: boolean } = {},
): JsonRecord {
  const name = selection.mapping.create.request_transform;
  if (!name) return body;
  const context = {
    baseUrl: strictBaseUrl(selection.vendor.baseUrlHint),
    request,
  };
  try {
    validateRequestTransformSync(name, body, context);
    const transformed = record(applyRequestTransformSync(name, body, context), "transformed catalog request");
    if (options.requireStable && !sameJson(body, transformed)) {
      throw new ApimartGenerationProviderError("APIMart request transform changed the approved payload; rebuild the request");
    }
    return transformed;
  } catch (error) {
    if (error instanceof ApimartGenerationProviderError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ApimartGenerationProviderError(`APIMart request transform ${name} rejected: ${message}`);
  }
}

function preparedForSelection(selection: CatalogSelection): PreparedRequest {
  return {
    modelKey: selection.model.modelKey,
    mappingId: selection.mapping.id,
    taskKind: selection.mapping.taskKind,
    endpoint: selection.endpoint,
    fingerprint: selection.fingerprint,
  };
}

function findPrepared(
  entries: readonly PreparedRequest[] | undefined,
  selection: CatalogSelection,
): PreparedRequest | undefined {
  return entries?.find((entry) => entry.modelKey === selection.model.modelKey
    && entry.mappingId === selection.mapping.id
    && entry.taskKind === selection.mapping.taskKind
    && entry.endpoint === selection.endpoint
    && entry.fingerprint === selection.fingerprint);
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

export function createApimartGenerationProvider(options: ApimartGenerationProviderOptions): GenerationProvider {
  const fetchImpl = options.fetchImpl ?? appFetch;
  const catalogReader = options.catalogReader ?? readCatalog;
  const fixtureBaseUrl = safeFixtureBaseUrl(options.fixtureBaseUrlOverride);
  const networkBaseUrl = (canonical: unknown): string => fixtureBaseUrl ?? strictBaseUrl(canonical);
  // A payload hash alone cannot identify a mode; keep catalog identity alongside every prepared
  // hash and require it again at submit. This also makes a restart fail closed
  // instead of guessing an endpoint from model names or body fields.
  const preparedByPayloadHash = new Map<string, PreparedRequest[]>();
  const projectionCache = new Map<string, { inputHash: string; body: JsonRecord; prepared: PreparedRequest }>();

  const currentVendor = (): { vendor: Vendor; baseUrl: string } => {
    const state = readCatalogSnapshot(catalogReader);
    const vendor = state.vendors.find((candidate) => candidate.key === "apimart" && candidate.enabled);
    if (!vendor) throw new ApimartGenerationProviderError("APIMart catalog vendor is unavailable");
    assertDirectKeyContract(state, vendor);
    return { vendor, baseUrl: networkBaseUrl(vendor.baseUrlHint) };
  };

  const request = async (base: string, pathValue: string, init: RequestInit, context: string): Promise<JsonRecord> => {
    let connection: { apiKey: string; baseUrl?: string } | null = null;
    try {
      connection = options.resolveConnection();
    } catch {
      // Credential resolution is deliberately deferred to a real network action.
      // Keep OS/keychain details private while preserving a structured provider error.
    }
    const apiKey = typeof connection?.apiKey === "string" ? connection.apiKey.trim() : "";
    if (!apiKey) throw new ApimartGenerationProviderError("APIMart connection is disabled, missing, or locked");
    const url = joinUrl(strictBaseUrl(base), pathValue);
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
    const { baseUrl, vendor } = currentVendor();
    const extraHeaders = extractVendorExtraHeaders(vendor);
    const payload = await request(`${baseUrl}`, `${apimartTaskQueryPath()}/${encodeURIComponent(taskId)}`, {
      method: "GET",
      ...(extraHeaders ? { headers: extraHeaders } : {}),
    }, "task query");
    const data = record(payload.data, "task query");
    const status = typeof data.status === "string" ? data.status : "unknown";
    return { status, raw: payload };
  };

  const submitForSelection = async (
    providerRequest: unknown,
    selection: CatalogSelection,
    requestInput?: GenerationProviderRequestInputV1,
  ) => {
    const preparedBody = record(providerRequest, "submit");
    // Re-run the same pure transform immediately before the network request as
    // defense-in-depth.  H3 normalization is idempotent; any deterministic
    // transform that cannot run synchronously is rejected by the shared bridge.
    const body = applyCatalogRequestTransform(
      preparedBody,
      selection,
      requestInput ? transformRequestContext(requestInput) : undefined,
      { requireStable: true },
    );
    assertNoProjectionCredential(body);
    assertReferenceParameters(body);
    const createPath = typeof selection.mapping.create.path === "string"
      ? selection.mapping.create.path.trim().replace(/\/+$/, "")
      : "";
    if (!createPath) throw new ApimartGenerationProviderError(`APIMart catalog mapping ${selection.mapping.id} has no create path`);
    const extraHeaders = extractVendorExtraHeaders(selection.vendor);
    const payload = await request(networkBaseUrl(selection.vendor.baseUrlHint), createPath, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(extraHeaders || {}) },
      body: JSON.stringify(body),
    }, `${selection.endpoint === "videos" ? "video" : "image"} submission`);
    const first = Array.isArray(payload.data) ? payload.data[0] : undefined;
    const taskId = first && typeof first === "object" && !Array.isArray(first) ? (first as JsonRecord).task_id : undefined;
    if (typeof taskId !== "string" || !taskId.trim()) throw new ApimartGenerationProviderError("APIMart submission did not return a task id");
    return { providerTaskId: taskId.trim(), raw: payload };
  };

  const rememberPrepared = (body: JsonRecord, prepared: PreparedRequest): void => {
    const hash = productionGenerationPayloadHash(body);
    const entries = preparedByPayloadHash.get(hash) ?? [];
    if (!entries.some((entry) => sameJson(entry, prepared))) entries.push(prepared);
    preparedByPayloadHash.set(hash, entries);
    // Keep the in-memory seal bounded; durable ProductionRun callers must
    // rebuild with a fresh catalog identity after a process restart.
    while (preparedByPayloadHash.size > 256) {
      const oldest = preparedByPayloadHash.keys().next().value;
      if (typeof oldest !== "string") break;
      preparedByPayloadHash.delete(oldest);
    }
  };

  const inputCacheKey = (input: GenerationProviderRequestInputV1): { key: string; hash: string } => {
    let hash: string;
    try {
      hash = productionGenerationPayloadHash(input);
    } catch {
      throw new ApimartGenerationProviderError("APIMart generation input is not serializable");
    }
    return { key: `${input.contractHash}:${input.idempotencyKey}:${hash}`, hash };
  };

  const selectionForPrepared = (prepared: PreparedRequest): CatalogSelection =>
    selectCatalogSelection(catalogReader, prepared.modelKey, prepared.taskKind);

  const provider: GenerationProvider & {
    submitWithContext: (
      providerRequest: unknown,
      idempotencyKey: string,
      input: GenerationProviderRequestInputV1,
    ) => Promise<{ providerTaskId: string; raw?: unknown }>;
  } = {
    providerId: "apimart",
    capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false, materialize: true },
    buildRequest(input) {
      if (input.providerId !== "apimart") throw new ApimartGenerationProviderError("APIMart provider identity does not match the request");
      const taskKind = taskKindForMode(input.mode);
      const selection = selectCatalogSelection(catalogReader, input.modelId, taskKind);
      const { key, hash } = inputCacheKey(input);
      const cached = projectionCache.get(key);
      if (cached && cached.inputHash === hash && cached.prepared.fingerprint === selection.fingerprint) {
        rememberPrepared(cached.body, cached.prepared);
        return structuredClone(cached.body);
      }
      const body = projectionRequest(input, selection, options.resolveReferenceUrls);
      const prepared = preparedForSelection(selection);
      projectionCache.set(key, { inputHash: hash, body: structuredClone(body), prepared });
      while (projectionCache.size > 128) {
        const oldest = projectionCache.keys().next().value;
        if (typeof oldest !== "string") break;
        projectionCache.delete(oldest);
      }
      rememberPrepared(body, prepared);
      return body;
    },
    async submit(providerRequest) {
      const body = record(providerRequest, "submit");
      const entries = preparedByPayloadHash.get(productionGenerationPayloadHash(body));
      if (!entries || entries.length !== 1) {
        throw new ApimartGenerationProviderError("APIMart sealed catalog identity is missing; rebuild the request before submission");
      }
      const prepared = entries[0];
      const selection = selectionForPrepared(prepared);
      if (!findPrepared(entries, selection)) {
        throw new ApimartGenerationProviderError("APIMart catalog changed after authorization; rebuild the request");
      }
      return submitForSelection(body, selection);
    },
    async submitWithContext(providerRequest, _idempotencyKey, input) {
      const body = record(providerRequest, "submit");
      const entries = preparedByPayloadHash.get(productionGenerationPayloadHash(body));
      if (!entries || entries.length === 0) {
        throw new ApimartGenerationProviderError("APIMart sealed catalog identity is missing; rebuild the request before submission");
      }
      if (input.providerId !== "apimart") throw new ApimartGenerationProviderError("APIMart provider identity does not match the request");
      const taskKind = taskKindForMode(input.mode);
      const selection = selectCatalogSelection(catalogReader, input.modelId, taskKind);
      if (!findPrepared(entries, selection)) {
        throw new ApimartGenerationProviderError("APIMart catalog changed or request identity does not match authorization");
      }
      return submitForSelection(body, selection, input);
    },
    query: queryTask,
    async materialize(input) {
      return { outputs: extractMaterializationOutputs(input.raw), raw: input.raw };
    },
    async reconcile(input) {
      if (!input.providerTaskId?.trim()) return { disposition: "indeterminate" };
      const result = await queryTask(input.providerTaskId);
      // A successful HTTP response with an unrecognised/missing task status is
      // not proof that the paid operation exists. Keep it in manual
      // reconciliation (indeterminate): callers must not materialize outputs or
      // resubmit from an ambiguous provider receipt. A recognised status proves
      // the task exists → found.
      const status = result.status.trim().toLowerCase();
      const knownStatuses = new Set([
        "submitted", "queued", "pending", "processing", "running",
        "completed", "succeeded", "success", "failed", "error",
        "cancelled", "canceled", "rejected",
      ]);
      return knownStatuses.has(status)
        ? { disposition: "found", providerTaskId: input.providerTaskId, raw: result.raw }
        : { disposition: "indeterminate", providerTaskId: input.providerTaskId, raw: result.raw };
    },
  };
  return provider;
}
