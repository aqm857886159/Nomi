import { apiKeyDecryptStatus } from "./secrets";
import { CURRENT_CATALOG_VERSION, type BillingModelKind, type CatalogState } from "./types";
import { modelHasPublishedExecution } from "../shared/modelPublication";

export function deriveModelCatalogHealth(state: CatalogState): unknown {
  // 只读版本偏移是**可观测状态**，不是只能从 writeCatalog 抛的异常里捞的隐藏事实。
  // writeCatalog 的 fail-closed 守卫保证不降级；这里让「守卫已生效」有唯一一处可读来源，
  // 产品横幅与走查 fail-fast 都从它 derive，不各自重算版本比较（避免第二份真相源）。
  const diskVersion = state.version as number;
  const writable = diskVersion <= CURRENT_CATALOG_VERSION;
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
  if (!writable) {
    issues.push({
      code: "catalog_read_only_version_skew",
      severity: "error",
      message: `Catalog is read-only: on-disk version ${diskVersion} > app version ${CURRENT_CATALOG_VERSION}`,
      diskVersion,
      appVersion: CURRENT_CATALOG_VERSION,
    });
  }
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
    writable,
    diskVersion,
    appVersion: CURRENT_CATALOG_VERSION,
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
