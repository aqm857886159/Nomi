import { nowIso } from "../jsonUtils";
import type { AiSdkProviderKind, CatalogState, Vendor } from "./types";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeProviderKind(value: unknown): AiSdkProviderKind {
  return value === "anthropic" || value === "openai-compatible" || value === "openai-responses"
    ? value
    : "openai-compatible";
}

export function normalizedConnectionScope(vendor: Vendor | undefined): string {
  if (!vendor) return "";
  return JSON.stringify([
    vendor.baseUrlHint || null,
    vendor.authType || null,
    vendor.authHeader || null,
    vendor.authQueryParam || null,
    normalizeProviderKind(vendor.providerKind),
  ]);
}

/** Invalidate transient validation evidence while retaining any published revision. */
export function invalidateVendorValidation(state: CatalogState, vendorKey: string): void {
  const now = nowIso();
  state.models = state.models.map((model) => {
    if (model.vendorKey !== vendorKey) return model;
    const meta = record(model.meta);
    const adapter = record(meta.adapter);
    if (!["failed", "testing", "repairing", "partial"].includes(String(adapter.state))) return model;
    const activeRevision = typeof adapter.activeRevision === "string" && adapter.activeRevision.trim();
    const nextAdapter: Record<string, unknown> = { ...adapter, state: activeRevision ? "verified" : "unverified", updatedAt: now };
    delete nextAdapter.runId;
    if (!activeRevision) delete nextAdapter.modes;
    return { ...model, meta: { ...meta, adapter: nextAdapter }, updatedAt: now };
  });
}
