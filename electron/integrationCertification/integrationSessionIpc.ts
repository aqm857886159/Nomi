import { ipcMain } from "electron";
import { assertTrustedSender } from "../ipcSenderGuard";
import { getIntegrationSessionService, type IntegrationSessionService } from "./integrationSession";
import { readCatalog } from "../catalog/catalogStore";
import { isComfyuiVendor } from "../catalog/types";

function objectPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid integration session request");
  return value as Record<string, unknown>;
}

/** Trusted renderer seam for credential entry and receipt minting. Secrets only
 * cross this main-window IPC boundary and are never returned in its projections. */
export function registerIntegrationSessionIpc(service?: IntegrationSessionService): void {
  const resolve = () => service || getIntegrationSessionService();
  ipcMain.handle("nomi:integration-session:get", (event, raw: unknown) => {
    assertTrustedSender(event);
    const payload = objectPayload(raw);
    return resolve().get(String(payload.sessionId || ""));
  });
  ipcMain.handle("nomi:integration-session:comfyui:prepare", (event, raw: unknown) => {
    assertTrustedSender(event);
    const payload = objectPayload(raw);
    const vendorKey = String(payload.vendorKey || "").trim();
    const vendor = readCatalog().vendors.find((candidate) => candidate.key === vendorKey && isComfyuiVendor(candidate));
    if (!vendor) throw new Error("ComfyUI connection not found");
    const modelKey = typeof payload.modelKey === "string" && payload.modelKey.trim() ? payload.modelKey.trim() : undefined;
    if (modelKey) {
      const owned = readCatalog().models.some((model) => model.vendorKey === vendorKey && model.modelKey === modelKey);
      if (!owned) throw new Error("ComfyUI workflow does not belong to the selected connection");
    }
    const service = resolve();
    const created = service.begin({
      kind: "comfyui-workflow",
      name: String(payload.name || "ComfyUI workflow"),
      baseUrl: String(vendor.baseUrlHint || ""),
    }, "nomi");
    const submitted = service.submitWorkflow(
      created.id,
      created.revision,
      "nomi",
      String(payload.workflow || ""),
      payload.binding,
      {
        ...(payload.enumOptions !== undefined ? { enumOptions: payload.enumOptions } : {}),
        ...(modelKey ? { modelKey } : {}),
        ...(typeof payload.uiWorkflow === "string" && payload.uiWorkflow
          ? { uiWorkflow: payload.uiWorkflow }
          : {}),
      },
    );
    const ready = service.resolveInput(submitted.id, submitted.revision, "nomi", {});
    service.requestConfirmation(ready.id, ready.revision, "nomi", `manual-${ready.id}`);
    return service.get(ready.id);
  });
  ipcMain.handle("nomi:integration-session:credential", (event, raw: unknown) => {
    assertTrustedSender(event);
    const payload = objectPayload(raw);
    return resolve().saveCredential(
      payload.sessionId,
      payload.expectedRevision,
      "nomi",
      payload.apiKey,
    );
  });
  ipcMain.handle("nomi:integration-session:confirm", async (event, raw: unknown) => {
    assertTrustedSender(event);
    const payload = objectPayload(raw);
    const frameId = event.senderFrame?.routingId;
    if (!Number.isInteger(frameId)) throw new Error("Trusted renderer frame is unavailable");
    let origin = "file://";
    try { origin = new URL(event.senderFrame?.url || "file://").origin || "file://"; } catch { /* trusted sender guard already checked origin */ }
    const confirmed = resolve().confirmFromTrustedUi({
      sessionId: String(payload.sessionId || ""),
      expectedRevision: Number(payload.expectedRevision),
      challengeId: String(payload.challengeId || ""),
      webContentsId: event.sender.id,
      frameId: frameId as number,
      origin,
    });
    return confirmed.ownerClientId === "nomi"
      ? resolve().startConfirmedFromTrustedUi(confirmed.id, confirmed.revision)
      : confirmed;
  });
}
