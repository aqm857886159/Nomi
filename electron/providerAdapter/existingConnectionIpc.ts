import { ipcMain } from "electron";
import type { BillingModelKind } from "../catalog/types";
import {
  type ExistingConnectionModel,
} from "./existingConnection";
import {
  getConnectionCertificationService,
  type ConnectionCertificationService,
} from "../integrationCertification/service";

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

export function registerExistingConnectionIpc(
  service: ConnectionCertificationService = getConnectionCertificationService(),
): void {
  ipcMain.handle("nomi:integration-certification:http:existing:list-models", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const vendorKey = String((payload as { vendorKey?: unknown } | null)?.vendorKey || "").trim();
    return service.listExistingHttpModels(vendorKey);
  });
  ipcMain.handle("nomi:integration-certification:http:existing:start", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const raw = (payload || {}) as Record<string, unknown>;
    try {
      return await service.startExistingHttp({
        entryPoint: "manual-ui",
        idempotencyKey: String(raw.idempotencyKey || "").trim(),
        vendorKey: String(raw.vendorKey || "").trim(),
        models: selectedModels(payload),
      });
    } catch {
      return { ok: false, code: "START_FAILED", error: "Certification start failed" };
    }
  });
  ipcMain.handle("nomi:integration-certification:http:retry", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const raw = (payload || {}) as Record<string, unknown>;
    const runId = String(raw.runId || "").trim();
    const modelKey = String(raw.modelKey || "").trim();
    try {
      return await service.retryHttp({
        runId,
        ...(modelKey ? { modelKey } : {}),
        idempotencyKey: String(raw.idempotencyKey || "").trim(),
      });
    } catch {
      return { ok: false, code: "START_FAILED", error: "Certification retry failed" };
    }
  });
}
