import { modelHasPublishedExecution } from "../shared/modelPublication";
import { isJsonRecord } from "../jsonUtils";
import type { CatalogState } from "./types";

/** One-time data repair, without a format bump so released v13 writers remain compatible. */
export function repairUnverifiedUsable(state: CatalogState): CatalogState {
  if (state.unverifiedUsableRecovered) return state;
  const pending = new Set(Object.entries(state.apiKeysByVendor).filter(([, key]) => key.verificationPending).map(([key]) => key));
  const recovered = new Set<string>();
  const models = state.models.map((model) => {
    const meta = isJsonRecord(model.meta) ? model.meta : {};
    const adapter = isJsonRecord(meta.adapter) ? meta.adapter : undefined;
    const diagnostic = pending.has(model.vendorKey) && adapter?.state !== "failed"
      ? { ...model, meta: { ...meta, adapter: { ...adapter, state: "unverified" } } } : model;
    if (model.enabled || adapter?.state !== "failed") return diagnostic;
    const enabled = { ...diagnostic, enabled: true };
    if (!modelHasPublishedExecution(enabled, { mappings: state.mappings })) return diagnostic;
    recovered.add(model.vendorKey);
    return enabled;
  });
  const vendors = state.vendors.map((vendor) => pending.has(vendor.key) || recovered.has(vendor.key) ? { ...vendor, enabled: true } : vendor);
  const apiKeysByVendor = Object.fromEntries(Object.entries(state.apiKeysByVendor).map(([key, record]) => [key, pending.has(key) || recovered.has(key) ? { ...record, enabled: true } : record]));
  return { ...state, unverifiedUsableRecovered: true, models, vendors, apiKeysByVendor };
}
