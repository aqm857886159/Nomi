import { apiKeyDecryptStatus } from "./secrets";
import type { BillingModelKind, CatalogState } from "./types";
import { modelHasPublishedExecution } from "../shared/modelPublication";

export function deriveModelCatalogHealth(state: CatalogState): unknown {
  const enabledVendors = state.vendors.filter((vendor) => vendor.enabled);
  const enabledModels = state.models.filter((model) => model.enabled);
  const credentialStatus = new Map(
    Object.entries(state.apiKeysByVendor).map(([vendorKey, key]) => [vendorKey, apiKeyDecryptStatus(key)] as const),
  );
  const enabledApiKeys = Object.entries(state.apiKeysByVendor).filter(
    ([vendorKey, key]) => key.enabled && credentialStatus.get(vendorKey) === "ok",
  ).length;
  const executableModels = enabledModels.filter((model) => {
    const vendor = state.vendors.find((item) => item.key === model.vendorKey);
    const apiKey = state.apiKeysByVendor[model.vendorKey];
    return Boolean(modelHasPublishedExecution(model, { mappings: state.mappings }) && vendor?.enabled && (
      vendor.authType === "none" || (apiKey?.enabled && credentialStatus.get(model.vendorKey) === "ok")
    ));
  });
  const byKind = (["text", "image", "video", "audio"] as BillingModelKind[]).map((kind) => ({
    kind,
    enabledModels: enabledModels.filter((model) => model.kind === kind).length,
    executableModels: executableModels.filter((model) => model.kind === kind).length,
  }));
  const issues = [];
  if (state.vendors.length === 0 || state.models.length === 0) {
    issues.push({ code: "catalog_empty", severity: "error", message: "Local model catalog is empty" });
  }
  for (const model of enabledModels) {
    const vendor = state.vendors.find((item) => item.key === model.vendorKey);
    const apiKey = state.apiKeysByVendor[model.vendorKey];
    if (!vendor?.enabled) {
      issues.push({
        code: "vendor_disabled",
        severity: "error",
        message: `Vendor disabled: ${model.vendorKey}`,
        vendorKey: model.vendorKey,
        modelKey: model.modelKey,
        kind: model.kind,
      });
    } else if (vendor.authType !== "none") {
      const status = credentialStatus.get(model.vendorKey) || "missing";
      if (!apiKey?.enabled || status !== "ok") {
        const code = status === "needs_resave"
          ? "vendor_api_key_needs_resave"
          : status === "locked"
            ? "vendor_api_key_locked"
            : "vendor_api_key_missing";
        const detail = status === "needs_resave"
          ? "API key needs secure re-save"
          : status === "locked"
            ? "API key is locked"
            : "API key missing";
        issues.push({
          code,
          severity: "error",
          message: `${detail}: ${model.vendorKey}`,
          vendorKey: model.vendorKey,
          modelKey: model.modelKey,
          kind: model.kind,
        });
      }
    }
  }
  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    counts: {
      vendors: state.vendors.length,
      enabledVendors: enabledVendors.length,
      models: state.models.length,
      enabledModels: enabledModels.length,
      mappings: state.mappings.length,
      enabledMappings: state.mappings.filter((mapping) => mapping.enabled).length,
      enabledApiKeys,
    },
    byKind,
    issues,
  };
}
