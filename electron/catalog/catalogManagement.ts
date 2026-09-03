import { isJsonRecord, type JsonRecord } from "../jsonUtils";
import {
  deleteModelCatalogModel,
  deleteModelCatalogVendor,
  readCatalog,
  upsertModelCatalogVendor,
} from "./catalogStore";

/** Public management boundary: keys stay in the trusted credential page. */
export function manageModelCatalogConnection(input: unknown): unknown {
  if (!isJsonRecord(input)) throw new Error("Invalid integration management request");
  const action = String(input.action || "");
  const vendorKey = String(input.vendorKey || "").trim();
  if (!vendorKey) throw new Error("vendorKey is required");
  const catalog = readCatalog();
  const vendor = catalog.vendors.find((item) => item.key === vendorKey);
  if (!vendor) throw new Error(`Integration vendor not found: ${vendorKey}`);
  if (action === "update_vendor") {
    const patch: JsonRecord = { key: vendorKey };
    for (const key of ["name", "baseUrl", "authType", "authHeader", "authQueryParam", "providerKind"] as const) {
      if (input[key] !== undefined) patch[key === "baseUrl" ? "baseUrlHint" : key] = input[key];
    }
    return { action, vendor: upsertModelCatalogVendor(patch) };
  }
  if (action === "delete_vendor") {
    deleteModelCatalogVendor(vendorKey);
    return { action, vendorKey, deleted: true };
  }
  if (action === "delete_model") {
    const modelKey = String(input.modelKey || "").trim();
    if (!modelKey) throw new Error("modelKey is required for delete_model");
    if (!catalog.models.some((model) => model.vendorKey === vendorKey && model.modelKey === modelKey))
      throw new Error(`Integration model not found: ${vendorKey}/${modelKey}`);
    deleteModelCatalogModel(vendorKey, modelKey);
    return { action, vendorKey, modelKey, deleted: true };
  }
  if (action === "set_proxy") {
    if (typeof input.enabled !== "boolean") throw new Error("enabled is required for set_proxy");
    if (input.enabled && !vendor.network?.proxyUrl) throw new Error("No secure proxy is configured for this connection");
    const updated = upsertModelCatalogVendor({ key: vendorKey, network: { proxyEnabled: input.enabled } });
    return { action, vendorKey, enabled: input.enabled, vendor: updated };
  }
  throw new Error(`Unknown integration management action: ${action}`);
}
