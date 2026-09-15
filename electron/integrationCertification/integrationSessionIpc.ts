import { ipcMain } from "electron";
import { assertTrustedSender } from "../ipcSenderGuard";
import type { IntegrationSessionService } from "./integrationSession";
import { readCatalog } from "../catalog/catalogStore";
import { isComfyuiVendor } from "../catalog/types";

function objectPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid integration session request");
  return value as Record<string, unknown>;
}

/** Trusted renderer seam for credential entry and for starting the free self-check.
 * Secrets only cross this main-window IPC boundary and are never returned in its projections.
 *
 * `service` 必填：以前它是 optional、缺席时回落到单例零参兜底构造，于是整条 ComfyUI
 * 认证链拿不到运行时依赖而必炸且静默（2026-09-11 真机矩阵 §BUG-2）。装配处见
 * `integrationSessionRuntimeInstall.installIntegrationSessionRuntime`。 */
export function registerIntegrationSessionIpc(service: IntegrationSessionService): void {
  ipcMain.handle("nomi:integration-session:get", (event, raw: unknown) => {
    assertTrustedSender(event);
    const payload = objectPayload(raw);
    return service.get(String(payload.sessionId || ""));
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
    // resolveInput 把会话推到 `ready_to_certify`，会话服务在那一刻自己递交接单（见
    // integrationSession.announceReadyToCertify）。这里不再签发花费挑战：自检不花钱。
    const ready = service.resolveInput(submitted.id, submitted.revision, "nomi", {});
    return service.get(ready.id);
  });
  ipcMain.handle("nomi:integration-session:credential", async (event, raw: unknown) => {
    assertTrustedSender(event);
    const payload = objectPayload(raw);
    const saved = service.saveCredential(
      payload.sessionId,
      payload.expectedRevision,
      "nomi",
      payload.apiKey,
    );
    // Saving a key is the shared discovery boundary: immediately populate the
    // durable session from the provider's authoritative list endpoint.
    if (saved.kind === "http-api-provider") {
      return service.propose(saved.id, saved.revision, "nomi", {});
    }
    return saved;
  });
  /** 用户在模型页按下「开始自检」。自检不发生成请求、不消耗额度，所以这里没有挑战、
   * 没有收据、没有手势章——只有一次普通的、以 Nomi 为 owner 的 start。 */
  ipcMain.handle("nomi:integration-session:start-self-check", async (event, raw: unknown) => {
    assertTrustedSender(event);
    const payload = objectPayload(raw);
    const sessionId = String(payload.sessionId || "");
    return service.start(sessionId, Number(payload.expectedRevision), "nomi", `manual-${sessionId}`);
  });
}
