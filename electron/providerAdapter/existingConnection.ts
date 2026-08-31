import type { ApiKeyRecord } from "../catalog/secrets";
import type {
  AiSdkProviderKind,
  BillingModelKind,
  CatalogState,
  Model,
  Vendor,
} from "../catalog/types";
import type { ModelListResult } from "../ai/onboarding/modelListProbe";
import type { ProviderAdapterRegistration, ProviderAdapterRun } from "./types";

export type ExistingConnectionErrorCode =
  | "CONNECTION_NOT_FOUND"
  | "BASE_URL_MISSING"
  | "CREDENTIAL_MISSING"
  | "MODEL_LIST_UNAVAILABLE"
  | "NO_NEW_MODELS"
  | "NO_MODELS_SELECTED"
  | "RUN_NOT_FOUND"
  | "RUN_ACTIVE"
  | "RUN_MODELS_MISSING"
  | "START_FAILED"
  | "REGISTER_FAILED";

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
  models: ExistingConnectionModel[];
};

export type ExistingConnectionAdapterRegisterInput = Omit<ExistingConnectionAdapterStartInput, "apiKey">;

export type PublicProviderAdapterRun = Omit<ProviderAdapterRun, "connectionFingerprint">;

type PublicFailure = {
  ok: false;
  code: ExistingConnectionErrorCode;
  error: string;
  connection?: ExistingConnectionSummary;
};

export type ExistingConnectionListResult =
  | { ok: true; connection: ExistingConnectionSummary; models: string[] }
  | PublicFailure;

export type ExistingConnectionStartResult =
  | { ok: true; run: PublicProviderAdapterRun }
  | PublicFailure;

export type ExistingConnectionRegisterResult =
  | { ok: true; registration: ProviderAdapterRegistration }
  | PublicFailure;

type ResolvedConnection = {
  summary: ExistingConnectionSummary;
  vendor: Vendor;
  apiKey: string;
  headers?: Record<string, string>;
  existingModelKeys: Set<string>;
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
    signal: AbortSignal;
  }) => Promise<ModelListResult>;
  startAdapter: (
    input: ExistingConnectionAdapterStartInput,
  ) => ProviderAdapterRun | Promise<ProviderAdapterRun>;
  registerAdapter: (
    input: ExistingConnectionAdapterRegisterInput,
  ) => ProviderAdapterRegistration | Promise<ProviderAdapterRegistration>;
  getAdapterRun: (runId: string) => ProviderAdapterRun | undefined;
  listTimeoutMs?: number;
};

export type ExistingConnectionActions = {
  listModels: (input: { vendorKey: string }) => Promise<ExistingConnectionListResult>;
  register: (input: {
    vendorKey: string;
    models: ExistingConnectionModel[];
  }) => Promise<ExistingConnectionRegisterResult>;
  start: (input: {
    vendorKey: string;
    models: ExistingConnectionModel[];
  }) => Promise<ExistingConnectionStartResult>;
  adapt: (input: {
    vendorKey: string;
    models: ExistingConnectionModel[];
  }) => Promise<ExistingConnectionStartResult>;
  retry: (input: { runId: string; modelKey?: string }) => Promise<ExistingConnectionStartResult>;
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
  return scrubCredential({
    id: run.id,
    vendorKey: run.vendorKey,
    vendorName: run.vendorName,
    selectedModelKeys: [...run.selectedModelKeys],
    stage: run.stage,
    ...(run.currentModelKey ? { currentModelKey: run.currentModelKey } : {}),
    ...(run.completedCount !== undefined ? { completedCount: run.completedCount } : {}),
    ...(run.totalCount !== undefined ? { totalCount: run.totalCount } : {}),
    ...(run.lastProgressAt ? { lastProgressAt: run.lastProgressAt } : {}),
    ...(run.stageStartedAt ? { stageStartedAt: run.stageStartedAt } : {}),
    ...(run.deadlineAt ? { deadlineAt: run.deadlineAt } : {}),
    repairAttempt: run.repairAttempt,
    models: structuredClone(run.models),
    sourceUrls: [...run.sourceUrls],
    ...(run.activeRevision ? { activeRevision: run.activeRevision } : {}),
    ...(run.error ? { error: run.error } : {}),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  }, credential);
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
    .filter((candidate) => candidate.vendorKey === vendorKey)
    .map(({ modelKey, labelZh, kind }) => ({ modelKey, labelZh, kind }));
  const summary: ExistingConnectionSummary = {
    vendorKey,
    vendorName: vendor.name || vendorKey,
    baseUrl,
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
    vendor,
    apiKey,
    headers: extraHeaders(vendor),
    existingModelKeys: new Set(models.map((model) => model.modelKey)),
  };
}

function dedupeNewModels(
  rawModels: readonly ExistingConnectionModel[],
  existing: ReadonlySet<string>,
): ExistingConnectionModel[] {
  const seen = new Set<string>();
  return rawModels
    .map((model) => {
      const labelZh = String(model?.labelZh || "").trim();
      return {
        modelKey: String(model?.modelKey || "").trim(),
        ...(labelZh ? { labelZh } : {}),
        kind: model?.kind,
      };
    })
    .filter((model): model is ExistingConnectionModel => {
      if (!model.modelKey || existing.has(model.modelKey) || seen.has(model.modelKey)) return false;
      seen.add(model.modelKey);
      return model.kind === "text" || model.kind === "image" || model.kind === "video" ||
        model.kind === "audio" || model.kind === "model3d";
    });
}

function selectedPersistedModels(
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
    const model = persisted.get(modelKey);
    if (!model) continue;
    selected.push({ modelKey, labelZh: model.labelZh, kind: model.kind });
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
): Promise<ExistingConnectionStartResult> {
  try {
    const run = await dependencies.startAdapter({
      vendorKey: connection.summary.vendorKey,
      vendorName: connection.summary.vendorName,
      baseUrl: connection.summary.baseUrl,
      apiKey: connection.apiKey,
      authType: connection.vendor.authType || "bearer",
      providerKind: providerKind(connection.vendor.providerKind),
      ...(connection.vendor.authHeader ? { authHeader: connection.vendor.authHeader } : {}),
      ...(connection.vendor.authQueryParam ? { authQueryParam: connection.vendor.authQueryParam } : {}),
      ...(connection.headers ? { headers: connection.headers } : {}),
      models,
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

async function registerResolvedConnection(
  dependencies: ExistingConnectionActionsDependencies,
  connection: ResolvedConnection,
  models: ExistingConnectionModel[],
): Promise<ExistingConnectionRegisterResult> {
  try {
    const registration = await dependencies.registerAdapter({
      vendorKey: connection.summary.vendorKey,
      vendorName: connection.summary.vendorName,
      baseUrl: connection.summary.baseUrl,
      authType: connection.vendor.authType || "bearer",
      providerKind: providerKind(connection.vendor.providerKind),
      ...(connection.vendor.authHeader ? { authHeader: connection.vendor.authHeader } : {}),
      ...(connection.vendor.authQueryParam ? { authQueryParam: connection.vendor.authQueryParam } : {}),
      ...(connection.headers ? { headers: connection.headers } : {}),
      models,
    });
    return { ok: true, registration: scrubCredential(registration, connection.apiKey) };
  } catch (error) {
    return {
      ok: false,
      code: "REGISTER_FAILED",
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), dependencies.listTimeoutMs ?? 12_000);
      try {
        const listed = await dependencies.fetchModels({
          providerKind: providerKind(connection.vendor.providerKind),
          baseUrl: connection.summary.baseUrl,
          apiKey: connection.apiKey,
          authType: connection.vendor.authType || "bearer",
          ...(connection.vendor.authHeader ? { authHeader: connection.vendor.authHeader } : {}),
          ...(connection.vendor.authQueryParam ? { authQueryParam: connection.vendor.authQueryParam } : {}),
          headers: connection.headers || {},
          signal: controller.signal,
        });
        if (!listed.ok) {
          return {
            ok: false,
            code: "MODEL_LIST_UNAVAILABLE",
            error: scrubCredential(listed.error, connection.apiKey),
            connection: connection.summary,
          };
        }
        return { ok: true, connection: connection.summary, models: [...new Set(listed.models)] };
      } catch (error) {
        return {
          ok: false,
          code: "MODEL_LIST_UNAVAILABLE",
          error: scrubCredential(error instanceof Error ? error.message : String(error), connection.apiKey),
          connection: connection.summary,
        };
      } finally {
        clearTimeout(timeout);
      }
    },

    async register({ vendorKey, models }) {
      const connection = resolveConnection(vendorKey, dependencies);
      if ("ok" in connection) return connection;
      const selected = dedupeNewModels(Array.isArray(models) ? models : [], connection.existingModelKeys);
      if (selected.length === 0) {
        return {
          ok: false,
          code: "NO_NEW_MODELS",
          error: "Select at least one model that is not already in this connection",
          connection: connection.summary,
        };
      }
      return registerResolvedConnection(dependencies, connection, selected);
    },

    async start({ vendorKey, models }) {
      const connection = resolveConnection(vendorKey, dependencies);
      if ("ok" in connection) return connection;
      const selected = dedupeNewModels(Array.isArray(models) ? models : [], connection.existingModelKeys);
      if (selected.length === 0) {
        return {
          ok: false,
          code: "NO_NEW_MODELS",
          error: "Select at least one model that is not already in this connection",
          connection: connection.summary,
        };
      }
      return startResolvedConnection(dependencies, connection, selected);
    },

    async adapt({ vendorKey, models }) {
      const connection = resolveConnection(vendorKey, dependencies);
      if ("ok" in connection) return connection;
      const selected = selectedPersistedModels(Array.isArray(models) ? models : [], connection.summary);
      if (selected.length === 0) {
        return {
          ok: false,
          code: "NO_MODELS_SELECTED",
          error: "Select at least one saved model to adapt",
          connection: connection.summary,
        };
      }
      return startResolvedConnection(dependencies, connection, selected);
    },

    async retry({ runId, modelKey }) {
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
      const connection = resolveConnection(previous.vendorKey, dependencies);
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
      return startResolvedConnection(dependencies, connection, models);
    },
  };
}
