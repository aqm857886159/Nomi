import { ipcMain } from "electron";
import type { AdapterAuthType } from "./types";
import type { ProviderAdapterRegisterInput } from "./service";
import {
  getConnectionCertificationService,
  type ConnectionCertificationService,
} from "../integrationCertification/service";
import { runLiveProviderAdapterHarnessFromEnv } from "./liveHarness";
import { ProviderAdapterRunActiveError } from "./store";

import { assertTrustedSender } from "../ipcSenderGuard";

function adapterConnectionInput(payload: unknown): ProviderAdapterRegisterInput {
  const raw = (payload || {}) as Record<string, unknown>;
  const models = Array.isArray(raw.models)
    ? raw.models.map((item) => {
        const model = (item || {}) as Record<string, unknown>;
        const kind = String(model.kind || "text");
        return {
          modelKey: String(model.modelKey || model.id || ""),
          labelZh: String(model.labelZh || model.displayName || "") || undefined,
          kind: (kind === "image" || kind === "video" || kind === "audio" || kind === "model3d" ? kind : "text") as ProviderAdapterRegisterInput["models"][number]["kind"],
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
    ...(typeof raw.proxyUrl === "string" ? { proxyUrl: raw.proxyUrl } : {}),
    headers,
    models,
  };
}

export function registerProviderAdapterIpc(service: ConnectionCertificationService = getConnectionCertificationService()): void {
  ipcMain.handle("nomi:integration-certification:http:configure", async (event, payload: unknown) => {
    assertTrustedSender(event);
    try {
      return { ok: true, registration: service.configureHttpConnection(adapterConnectionInput(payload)) };
    } catch (error) {
      void error;
      return { ok: false, code: "START_FAILED", error: "Connection configuration failed" };
    }
  });
  ipcMain.handle("nomi:integration-certification:http:start", async (event, payload: unknown) => {
    assertTrustedSender(event);
    try {
      const raw = (payload || {}) as Record<string, unknown>;
      return {
        ok: true,
        run: await service.startHttp({
          entryPoint: "manual-ui",
          idempotencyKey: String(raw.idempotencyKey || "").trim(),
          connection: adapterConnectionInput(payload),
        }),
      };
    } catch (error) {
      void error;
      return { ok: false, code: "START_FAILED", error: "Certification start failed" };
    }
  });
  ipcMain.handle("nomi:integration-certification:get", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const runId = String((payload as { runId?: unknown } | null)?.runId || "").trim();
    const run = runId ? service.get(runId) : undefined;
    return run ? { ok: true, run } : { ok: false, code: "RUN_NOT_FOUND", error: "Certification run not found" };
  });
  ipcMain.handle("nomi:integration-certification:cancel", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const runId = String((payload as { runId?: unknown } | null)?.runId || "").trim();
    const run = runId ? service.cancel(runId) : undefined;
    return run ? { ok: true, run } : { ok: false, code: "RUN_NOT_FOUND", error: "Certification run not found" };
  });
  ipcMain.handle("nomi:integration-certification:delete", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const runId = String((payload as { runId?: unknown } | null)?.runId || "").trim();
    if (!runId) return { ok: false, code: "RUN_NOT_FOUND", error: "Certification run not found" };
    try {
      const run = service.deleteRun(runId);
      return run ? { ok: true, run } : { ok: false, code: "RUN_NOT_FOUND", error: "Certification run not found" };
    } catch (error) {
      if (error instanceof ProviderAdapterRunActiveError || (error as { code?: unknown })?.code === "RUN_ACTIVE") {
        return { ok: false, code: "RUN_ACTIVE", error: "Active certification runs cannot be cleared" };
      }
      return { ok: false, code: "START_FAILED", error: "Certification record could not be cleared" };
    }
  });
  ipcMain.handle("nomi:integration-certification:list", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const raw = (payload || {}) as Record<string, unknown>;
    const vendorKey = String(raw.vendorKey || "").trim();
    const requestedLimit = Number(raw.limit);
    const options = {
      ...(vendorKey ? { vendorKey } : {}),
      activeOnly: raw.activeOnly === true,
      ...(Number.isFinite(requestedLimit) ? { limit: requestedLimit } : {}),
    };
    return { ok: true, runs: service.list(options) };
  });
  service.resumeInterrupted();
  void runLiveProviderAdapterHarnessFromEnv(service);
}
