import type { ApiKeyRecord } from "../catalog/secrets";
import type {
  AiSdkProviderKind,
  BillingModelKind,
  CatalogState,
  Model,
  Vendor,
} from "../catalog/types";
import type { ModelListFailureKind, ModelListResult } from "../ai/onboarding/modelListProbe";
import { modelListErrorRedactor, publicModelListUrl } from "../ai/onboarding/modelListSafety";
import type { CertificationContractBinding } from "../integrationCertification/types";
import type { ProviderAdapterRun } from "./types";
import { derivePublishedExecution } from "../shared/modelPublication";

export type ExistingConnectionErrorCode =
  | "CONNECTION_NOT_FOUND"
  | "BASE_URL_MISSING"
  | "CREDENTIAL_MISSING"
  | "MODEL_LIST_UNAVAILABLE"
  | "NO_MODELS_SELECTED"
  | "RUN_NOT_FOUND"
  | "RUN_ACTIVE"
  | "RUN_MODELS_MISSING"
  | "START_FAILED";

export type ExistingConnectionModel = {
  modelKey: string;
  labelZh?: string;
  kind: BillingModelKind;
};

export type ExistingConnectionSummary = {
  vendorKey: string;
  vendorName: string;
  baseUrl: string;
  existingModels: Array<Pick<Model, "modelKey" | "labelZh" | "kind">>;
};

/**
 * Deliberately includes the catalog vendor key. A saved connection may have a
 * user-assigned key that cannot be re-derived from its host; the adapter must
 * append models to that exact identity instead of creating a second provider.
 * This type stays in Electron main and is never exposed through preload.
 */
export type ExistingConnectionAdapterStartInput = {
  vendorKey: string;
  vendorName: string;
  baseUrl: string;
  apiKey: string;
  authType: "none" | "bearer" | "x-api-key" | "query";
  providerKind: AiSdkProviderKind;
  authHeader?: string;
  authQueryParam?: string;
  headers?: Record<string, string>;
  proxyUrl?: string;
  models: ExistingConnectionModel[];
  certification: CertificationContractBinding;
};

export type PublicProviderAdapterRun = Omit<ProviderAdapterRun, "connectionFingerprint">;

type PublicFailure = {
  ok: false;
  code: ExistingConnectionErrorCode;
  error: string;
  status?: number;
  failureKind?: ModelListFailureKind;
  connection?: ExistingConnectionSummary;
};

export type ExistingConnectionListResult =
  | { ok: true; connection: ExistingConnectionSummary; models: string[]; partial?: boolean }
  | PublicFailure;

export type ExistingConnectionStartResult =
  | { ok: true; run: PublicProviderAdapterRun }
  | PublicFailure;

type ResolvedConnection = {
  summary: ExistingConnectionSummary;
  baseUrl: string;
  vendor: Vendor;
  apiKey: string;
  headers?: Record<string, string>;
};

export type ExistingConnectionActionsDependencies = {
  readCatalog: () => CatalogState;
  decryptApiKey: (record: ApiKeyRecord | undefined) => string;
  fetchModels: (input: {
    providerKind: AiSdkProviderKind;
    baseUrl: string;
    apiKey: string;
    authType: "none" | "bearer" | "x-api-key" | "query";
    authHeader?: string;
    authQueryParam?: string;
    headers: Record<string, string>;
    proxyUrl?: string;
    signal: AbortSignal;
  }) => Promise<ModelListResult>;
  startAdapter: (
    input: ExistingConnectionAdapterStartInput,
  ) => Promise<ProviderAdapterRun>;
  getAdapterRun: (runId: string) => ProviderAdapterRun | undefined;
  getCertificationSourceVendorKey?: (runId: string) => string | undefined;
  listTimeoutMs?: number;
};

export type ExistingConnectionActions = {
  listModels: (input: { vendorKey: string }) => Promise<ExistingConnectionListResult>;
  start: (input: {
    vendorKey: string;
    models: ExistingConnectionModel[];
    certification: CertificationContractBinding;
  }) => Promise<ExistingConnectionStartResult>;
  retry: (input: { runId: string; modelKey?: string; certification: CertificationContractBinding }) => Promise<ExistingConnectionStartResult>;
};

const TERMINAL_RUN_STAGES = new Set<ProviderAdapterRun["stage"]>([
  "completed",
  "partial",
  "failed",
  "needs_ai",
  "cancelled",
  "timed_out",
  "stale",
]);

function providerKind(value: Vendor["providerKind"]): AiSdkProviderKind {
  return value === "anthropic" || value === "openai-responses" ? value : "openai-compatible";
}

function extraHeaders(vendor: Vendor): Record<string, string> | undefined {
  const meta = vendor.meta && typeof vendor.meta === "object" && !Array.isArray(vendor.meta)
    ? vendor.meta as Record<string, unknown>
    : {};
  const raw = meta.extraHeaders;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const clean = Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .map(([key, value]) => [key.trim(), String(value ?? "").trim()] as const)
      .filter(([key, value]) => key && value),
  );
  return Object.keys(clean).length ? clean : undefined;
}

function scrubCredential<T>(value: T, credential: string): T {
  if (!credential) return value;
  if (typeof value === "string") {
    const encoded = encodeURIComponent(credential);
    return value.replaceAll(credential, "[REDACTED]").replaceAll(encoded, "[REDACTED]") as T;
  }
  if (Array.isArray(value)) return value.map((item) => scrubCredential(item, credential)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, scrubCredential(item, credential)]),
    ) as T;
  }
  return value;
}

function publicRun(run: ProviderAdapterRun, credential: string): PublicProviderAdapterRun {
  const projected = structuredClone(run) as Partial<ProviderAdapterRun>;
  delete projected.connectionFingerprint;
  return scrubCredential(projected as PublicProviderAdapterRun, credential);
}

function resolveConnection(
  rawVendorKey: string,
  dependencies: Pick<ExistingConnectionActionsDependencies, "readCatalog" | "decryptApiKey">,
): ResolvedConnection | PublicFailure {
  const vendorKey = String(rawVendorKey || "").trim();
  const state = dependencies.readCatalog();
  const vendor = state.vendors.find((candidate) => candidate.key === vendorKey);
  if (!vendor) {
    return { ok: false, code: "CONNECTION_NOT_FOUND", error: "Saved connection was not found" };
  }
  const baseUrl = String(vendor.baseUrlHint || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(baseUrl)) {
    return { ok: false, code: "BASE_URL_MISSING", error: "Saved connection has no usable API address" };
  }
  const models = state.models
    .filter((candidate) => {
      if (candidate.vendorKey !== vendorKey || candidate.enabled !== true) return false;
      const adapter = candidate.meta && typeof candidate.meta === "object" && !Array.isArray(candidate.meta)
        ? candidate.meta as Record<string, unknown>
        : {};
      const adapterMeta = adapter.adapter;
      const adapterState = adapterMeta && typeof adapterMeta === "object" && !Array.isArray(adapterMeta)
        ? (adapterMeta as Record<string, unknown>).state
        : undefined;
      return adapterState === "verified"
        && derivePublishedExecution(candidate, { mappings: state.mappings }).published;
    })
    .map(({ modelKey, labelZh, kind }) => ({ modelKey, labelZh, kind }));
  const summary: ExistingConnectionSummary = {
    vendorKey,
    vendorName: vendor.name || vendorKey,
    baseUrl: publicModelListUrl(baseUrl),
    existingModels: models,
  };
  const authType = vendor.authType || "bearer";
  const apiKey = authType === "none"
    ? ""
    : dependencies.decryptApiKey(state.apiKeysByVendor[vendorKey]);
  if (authType !== "none" && !apiKey) {
    return {
      ok: false,
      code: "CREDENTIAL_MISSING",
      error: "The saved connection credential is missing; edit the connection and save it again",
      connection: summary,
    };
  }
  return {
    summary,
    baseUrl,
    vendor,
    apiKey,
    headers: extraHeaders(vendor),
  };
}

function selectedCertificationModels(
  rawModels: readonly ExistingConnectionModel[],
  connection: ExistingConnectionSummary,
): ExistingConnectionModel[] {
  const persisted = new Map(connection.existingModels.map((model) => [model.modelKey, model]));
  const seen = new Set<string>();
  const selected: ExistingConnectionModel[] = [];
  for (const raw of rawModels) {
    const modelKey = String(raw?.modelKey || "").trim();
    if (!modelKey || seen.has(modelKey)) continue;
    seen.add(modelKey);
    const existing = persisted.get(modelKey);
    const kind = existing?.kind || raw?.kind;
    if (kind !== "text" && kind !== "image" && kind !== "video" && kind !== "audio" && kind !== "model3d") continue;
    const labelZh = String(existing?.labelZh || raw?.labelZh || "").trim();
    selected.push({ modelKey, ...(labelZh ? { labelZh } : {}), kind });
  }
  return selected;
}

function persistedRetryModels(
  run: ProviderAdapterRun,
  connection: ExistingConnectionSummary,
  requestedModelKey?: string,
): ExistingConnectionModel[] | null {
  const runModels = new Map(run.models.map((model) => [model.modelKey, model]));
  const catalogModels = new Map(connection.existingModels.map((model) => [model.modelKey, model]));
  const seen = new Set<string>();
  const models: ExistingConnectionModel[] = [];
  const selectedModelKeys = requestedModelKey ? [requestedModelKey] : run.selectedModelKeys;
  for (const rawModelKey of selectedModelKeys) {
    const modelKey = String(rawModelKey || "").trim();
    if (!modelKey || seen.has(modelKey) || !run.selectedModelKeys.includes(modelKey)) continue;
    seen.add(modelKey);
    const persisted = runModels.get(modelKey);
    const catalog = catalogModels.get(modelKey);
    const kind = persisted?.kind ?? catalog?.kind;
    if (kind !== "text" && kind !== "image" && kind !== "video" && kind !== "audio" && kind !== "model3d") {
      return null;
    }
    const labelZh = String(persisted?.labelZh || catalog?.labelZh || "").trim();
    models.push({ modelKey, ...(labelZh ? { labelZh } : {}), kind });
  }
  return models.length > 0 ? models : null;
}

async function startResolvedConnection(
  dependencies: ExistingConnectionActionsDependencies,
  connection: ResolvedConnection,
  models: ExistingConnectionModel[],
  certification: CertificationContractBinding,
): Promise<ExistingConnectionStartResult> {
  try {
    const run = await dependencies.startAdapter({
      vendorKey: connection.summary.vendorKey,
      vendorName: connection.summary.vendorName,
      baseUrl: connection.baseUrl,
      apiKey: connection.apiKey,
      authType: connection.vendor.authType || "bearer",
      providerKind: providerKind(connection.vendor.providerKind),
      ...(connection.vendor.authHeader ? { authHeader: connection.vendor.authHeader } : {}),
      ...(connection.vendor.authQueryParam ? { authQueryParam: connection.vendor.authQueryParam } : {}),
      ...(connection.headers ? { headers: connection.headers } : {}),
      ...(connection.vendor.network?.proxyUrl ? { proxyUrl: connection.vendor.network.proxyUrl } : {}),
      models,
      certification,
    });
    return { ok: true, run: publicRun(run, connection.apiKey) };
  } catch (error) {
    return {
      ok: false,
      code: "START_FAILED",
      error: scrubCredential(error instanceof Error ? error.message : String(error), connection.apiKey),
      connection: connection.summary,
    };
  }
}

export function createExistingConnectionActions(
  dependencies: ExistingConnectionActionsDependencies,
): ExistingConnectionActions {
  return {
    async listModels({ vendorKey }) {
      const connection = resolveConnection(vendorKey, dependencies);
      if ("ok" in connection) return connection;
      const redact = modelListErrorRedactor(connection.baseUrl, { ...connection.headers, "saved-api-key": connection.apiKey });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), dependencies.listTimeoutMs ?? 12_000);
      try {
        const listed = await dependencies.fetchModels({
          providerKind: providerKind(connection.vendor.providerKind),
          baseUrl: connection.baseUrl,
          apiKey: connection.apiKey,
          authType: connection.vendor.authType || "bearer",
          ...(connection.vendor.authHeader ? { authHeader: connection.vendor.authHeader } : {}),
          ...(connection.vendor.authQueryParam ? { authQueryParam: connection.vendor.authQueryParam } : {}),
          headers: connection.headers || {},
          ...(connection.vendor.network?.proxyUrl ? { proxyUrl: connection.vendor.network.proxyUrl } : {}),
          signal: controller.signal,
        });
        if (!listed.ok) {
          return {
            ok: false,
            code: "MODEL_LIST_UNAVAILABLE",
            error: redact(scrubCredential(listed.error, connection.apiKey)),
            ...(listed.status !== undefined ? { status: listed.status } : {}),
            ...(listed.failureKind ? { failureKind: listed.failureKind } : {}),
            connection: connection.summary,
          };
        }
        return { ok: true, connection: connection.summary, models: [...new Set(listed.models)], ...(listed.partial ? { partial: true } : {}) };
      } catch (error) {
        return {
          ok: false,
          code: "MODEL_LIST_UNAVAILABLE",
          error: redact(error instanceof Error ? error.message : String(error)),
          failureKind: "network",
          connection: connection.summary,
        };
      } finally {
        clearTimeout(timeout);
      }
    },

    async start({ vendorKey, models, certification }) {
      const connection = resolveConnection(vendorKey, dependencies);
      if ("ok" in connection) return connection;
      const selected = selectedCertificationModels(Array.isArray(models) ? models : [], connection.summary);
      if (selected.length === 0) {
        return {
          ok: false,
          code: "NO_MODELS_SELECTED",
          error: "Select at least one model to certify",
          connection: connection.summary,
        };
      }
      return startResolvedConnection(dependencies, connection, selected, certification);
    },

    async retry({ runId, modelKey, certification }) {
      const previous = dependencies.getAdapterRun(String(runId || "").trim());
      if (!previous) {
        return {
          ok: false,
          code: "RUN_NOT_FOUND",
          error: "The saved verification task was not found",
        };
      }
      if (!TERMINAL_RUN_STAGES.has(previous.stage)) {
        return {
          ok: false,
          code: "RUN_ACTIVE",
          error: "This verification task is still running and cannot be retried yet",
        };
      }
      const sourceVendorKey = previous.lineageRootVendorKey
        || dependencies.getCertificationSourceVendorKey?.(previous.id)
        || previous.vendorKey;
      const connection = resolveConnection(sourceVendorKey, dependencies);
      if ("ok" in connection) return connection;
      const requestedModelKey = String(modelKey || "").trim() || undefined;
      const models = persistedRetryModels(previous, connection.summary, requestedModelKey);
      if (!models) {
        return {
          ok: false,
          code: "RUN_MODELS_MISSING",
          error: "The saved verification task has no usable model definitions",
          connection: connection.summary,
        };
      }
      return startResolvedConnection(dependencies, connection, models, certification);
    },
  };
}
