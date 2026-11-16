import { BrowserWindow } from "electron";
import { mutateCatalog, readCatalog } from "./catalogStore";
import { normalizedConnectionScope } from "./vendorValidationInvalidation";
import { decryptApiKeyRecord } from "./secrets";
import type { Model, Vendor } from "./types";

/** Only a real successful execution can clear diagnostics; stale requests cannot certify replacement settings. */
export function recordModelExecutionResult<T extends { status: string; kind: string; assets: unknown[] }>(
  input: { vendor: Vendor; model: Model; apiKey: string }, result: T,
): T {
  if (result.status !== "succeeded" || (input.model.kind !== "text" && !result.assets.length)) return result;
  const state = readCatalog();
  const vendor = state.vendors.find((item) => item.key === input.vendor.key);
  const model = state.models.find((item) => item.vendorKey === input.vendor.key && item.modelKey === input.model.modelKey);
  if (!vendor || !model || normalizedConnectionScope(vendor) !== normalizedConnectionScope(input.vendor) || model.updatedAt !== input.model.updatedAt) return result;
  const credential = state.apiKeysByVendor[vendor.key];
  if ((vendor.authType !== "none" && !credential) || decryptApiKeyRecord(credential) !== input.apiKey) return result;
  const meta = model.meta && typeof model.meta === "object" ? model.meta as Record<string, unknown> : {};
  const adapter = meta.adapter as Record<string, unknown> | undefined;
  if (!credential?.verificationPending && (!adapter || adapter.state === "verified")) return result;
  mutateCatalog((tx, current) => {
    const record = current.apiKeysByVendor[vendor.key];
    if (record) delete record.verificationPending;
    tx.upsertModel({ ...model, meta: { ...meta, adapter: { ...adapter, state: "verified", updatedAt: new Date().toISOString() } } });
  });
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send("nomi:model-catalog:changed");
  return result;
}
