import { ipcMain } from "electron";
import type { AdapterAuthType, ProviderAdapterRun } from "./types";
import {
  getProviderAdapterService,
  type ProviderAdapterService,
  type ProviderAdapterStartInput,
} from "./service";
import { runLiveProviderAdapterHarnessFromEnv } from "./liveHarness";

import { assertTrustedSender } from "../ipcSenderGuard";
type PublicProviderAdapterRun = Omit<ProviderAdapterRun, "connectionFingerprint">;

function publicRun(run: ProviderAdapterRun): PublicProviderAdapterRun {
  const projected = structuredClone(run) as Partial<ProviderAdapterRun>;
  delete projected.connectionFingerprint;
  return projected as PublicProviderAdapterRun;
}

function adapterStartInput(payload: unknown): ProviderAdapterStartInput {
  const raw = (payload || {}) as Record<string, unknown>;
  const models = Array.isArray(raw.models)
    ? raw.models.map((item) => {
        const model = (item || {}) as Record<string, unknown>;
        const kind = String(model.kind || "text");
        return {
          modelKey: String(model.modelKey || model.id || ""),
          labelZh: String(model.labelZh || model.displayName || "") || undefined,
          kind: (kind === "image" || kind === "video" || kind === "audio" || kind === "model3d" ? kind : "text") as ProviderAdapterStartInput["models"][number]["kind"],
        };
      })
    : [];
  const headers: Record<string, string> = {};
  if (raw.headers && typeof raw.headers === "object") {
    for (const [key, value] of Object.entries(raw.headers as Record<string, unknown>)) {
      const cleanKey = key.trim();
      const cleanValue = String(value ?? "").trim();
      if (cleanKey && cleanValue) headers[cleanKey] = cleanValue;
    }
  }
  const authType = String(raw.authType || "bearer") as AdapterAuthType;
  return {
    vendorName: String(raw.vendorName || "").trim(),
    baseUrl: String(raw.baseUrl || "").trim(),
    apiKey: String(raw.apiKey || "").trim(),
    authType: authType === "none" || authType === "x-api-key" || authType === "query" ? authType : "bearer",
    providerKind:
      raw.providerKind === "anthropic" || raw.providerKind === "openai-responses"
        ? raw.providerKind
        : "openai-compatible",
    ...(typeof raw.authHeader === "string" ? { authHeader: raw.authHeader } : {}),
    ...(typeof raw.authQueryParam === "string" ? { authQueryParam: raw.authQueryParam } : {}),
    headers,
    models,
  };
}

export function registerProviderAdapterIpc(service: ProviderAdapterService = getProviderAdapterService()): void {
  ipcMain.handle("nomi:provider-adapter:register", async (event, payload: unknown) => {
    assertTrustedSender(event);
    try {
      return { ok: true, registration: service.register(adapterStartInput(payload)) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle("nomi:provider-adapter:start", async (event, payload: unknown) => {
    assertTrustedSender(event);
    try {
      return { ok: true, run: publicRun(service.start(adapterStartInput(payload))) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle("nomi:provider-adapter:get", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const runId = String((payload as { runId?: unknown } | null)?.runId || "").trim();
    const run = runId ? service.getRun(runId) : undefined;
    return run ? { ok: true, run: publicRun(run) } : { ok: false, error: "Provider adapter run not found" };
  });
  ipcMain.handle("nomi:provider-adapter:latest", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const vendorKey = String((payload as { vendorKey?: unknown } | null)?.vendorKey || "").trim();
    const run = vendorKey ? service.latestRun(vendorKey) : undefined;
    return run ? { ok: true, run: publicRun(run) } : { ok: false, error: "Provider adapter run not found" };
  });
  ipcMain.handle("nomi:provider-adapter:cancel", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const runId = String((payload as { runId?: unknown } | null)?.runId || "").trim();
    const run = runId ? service.cancel(runId) : undefined;
    return run ? { ok: true, run: publicRun(run) } : { ok: false, error: "Provider adapter run not found" };
  });
  ipcMain.handle("nomi:provider-adapter:list", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const raw = (payload || {}) as Record<string, unknown>;
    const vendorKey = String(raw.vendorKey || "").trim();
    const requestedLimit = Number(raw.limit);
    const options = {
      ...(vendorKey ? { vendorKey } : {}),
      activeOnly: raw.activeOnly === true,
      ...(Number.isFinite(requestedLimit) ? { limit: requestedLimit } : {}),
    };
    return { ok: true, runs: service.listRuns(options).map(publicRun) };
  });
  service.resumeInterrupted();
  void runLiveProviderAdapterHarnessFromEnv(service);
}
