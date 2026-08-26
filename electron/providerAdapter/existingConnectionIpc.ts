import { ipcMain } from "electron";
import { authHeaders, authQueryParams } from "../ai/requestPipeline";
import { fetchModelList } from "../ai/onboarding/modelListProbe";
import { readCatalog } from "../catalog/catalogStore";
import { decryptApiKeyRecord } from "../catalog/secrets";
import { mergeHeadersCaseInsensitive } from "../jsonUtils";
import type { BillingModelKind } from "../catalog/types";
import {
  createExistingConnectionActions,
  type ExistingConnectionActions,
  type ExistingConnectionModel,
} from "./existingConnection";
import { getProviderAdapterService } from "./service";

import { assertTrustedSender } from "../ipcSenderGuard";
function modelKind(value: unknown): BillingModelKind {
  return value === "image" || value === "video" || value === "audio" || value === "model3d"
    ? value
    : "text";
}

function selectedModels(payload: unknown): ExistingConnectionModel[] {
  const raw = (payload || {}) as Record<string, unknown>;
  if (!Array.isArray(raw.models)) return [];
  return raw.models.map((item) => {
    const model = (item || {}) as Record<string, unknown>;
    const labelZh = String(model.labelZh || model.displayName || "").trim();
    return {
      modelKey: String(model.modelKey || model.id || "").trim(),
      ...(labelZh ? { labelZh } : {}),
      kind: modelKind(model.kind),
    };
  });
}

function defaultActions(): ExistingConnectionActions {
  const service = getProviderAdapterService();
  return createExistingConnectionActions({
    readCatalog,
    decryptApiKey: decryptApiKeyRecord,
    async fetchModels(input) {
      const headers = mergeHeadersCaseInsensitive(
        input.providerKind === "anthropic" ? { "anthropic-version": "2023-06-01" } : {},
        authHeaders(input.authType, input.apiKey, input.authHeader),
        input.headers,
      );
      const query = authQueryParams(input.authType, input.apiKey, input.authQueryParam);
      return fetchModelList(input.providerKind, input.baseUrl, headers, input.signal, { query });
    },
    registerAdapter: ({ vendorKey, ...input }) => service.register({
      ...input,
      catalogVendorKey: vendorKey,
      apiKey: "",
      preserveExistingCredential: true,
    }),
    startAdapter: ({ vendorKey, ...input }) => service.start({ ...input, catalogVendorKey: vendorKey }),
    getAdapterRun: (runId) => service.getRun(runId),
  });
}

export function registerExistingConnectionIpc(actions: ExistingConnectionActions = defaultActions()): void {
  ipcMain.handle("nomi:provider-adapter:existing:list-models", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const vendorKey = String((payload as { vendorKey?: unknown } | null)?.vendorKey || "").trim();
    return actions.listModels({ vendorKey });
  });
  ipcMain.handle("nomi:provider-adapter:existing:register", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const vendorKey = String((payload as { vendorKey?: unknown } | null)?.vendorKey || "").trim();
    return actions.register({ vendorKey, models: selectedModels(payload) });
  });
  ipcMain.handle("nomi:provider-adapter:existing:start", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const vendorKey = String((payload as { vendorKey?: unknown } | null)?.vendorKey || "").trim();
    return actions.start({ vendorKey, models: selectedModels(payload) });
  });
  ipcMain.handle("nomi:provider-adapter:existing:adapt", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const vendorKey = String((payload as { vendorKey?: unknown } | null)?.vendorKey || "").trim();
    return actions.adapt({ vendorKey, models: selectedModels(payload) });
  });
  ipcMain.handle("nomi:provider-adapter:retry", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const raw = (payload || {}) as Record<string, unknown>;
    const runId = String(raw.runId || "").trim();
    const modelKey = String(raw.modelKey || "").trim();
    return actions.retry({ runId, ...(modelKey ? { modelKey } : {}) });
  });
}
