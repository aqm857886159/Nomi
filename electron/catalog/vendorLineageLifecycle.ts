import { nowIso } from "../jsonUtils";
import {
  candidatePromotionPredecessors,
  candidateSourceVendorKey,
} from "./stagedVendorIdentity";
import type { CatalogState } from "./types";

export function vendorLineageClosure(state: CatalogState, rootKey: string): Set<string> {
  const keys = new Set([rootKey]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const vendor of state.vendors) {
      if (keys.has(vendor.key) || !keys.has(candidateSourceVendorKey(vendor.meta))) continue;
      keys.add(vendor.key);
      changed = true;
    }
  }
  return keys;
}

export function removeVendorLineage(state: CatalogState, rootKey: string): void {
  const keys = vendorLineageClosure(state, rootKey);
  state.vendors = state.vendors.filter((vendor) => !keys.has(vendor.key));
  state.models = state.models.filter((model) => !keys.has(model.vendorKey));
  state.mappings = state.mappings.filter((mapping) => !keys.has(mapping.vendorKey));
  for (const key of keys) delete state.apiKeysByVendor[key];
}

export function restoreSourceAfterCandidateDeletion(state: CatalogState, candidateKey: string): void {
  const candidate = state.vendors.find((vendor) => vendor.key === candidateKey);
  const predecessors = candidatePromotionPredecessors(candidate?.meta);
  if (Object.keys(predecessors).length === 0) return;
  const deleting = vendorLineageClosure(state, candidateKey);
  const restoredAt = nowIso();
  const restoredVendorKeys = new Set<string>();
  state.models = state.models.map((model) => {
    const predecessor = predecessors[model.modelKey];
    if (!predecessor || model.vendorKey !== predecessor.vendorKey || deleting.has(model.vendorKey)) return model;
    restoredVendorKeys.add(model.vendorKey);
    return { ...model, enabled: true, updatedAt: restoredAt };
  });
  state.mappings = state.mappings.map((mapping) => {
    if (!mapping.modelKey) return mapping;
    const predecessor = predecessors[mapping.modelKey];
    if (
      !predecessor ||
      mapping.vendorKey !== predecessor.vendorKey ||
      deleting.has(mapping.vendorKey) ||
      !predecessor.publishedModes.includes(mapping.taskKind)
    ) return mapping;
    return { ...mapping, enabled: true, updatedAt: restoredAt };
  });
  if (restoredVendorKeys.size > 0) {
    state.vendors = state.vendors.map((vendor) =>
      restoredVendorKeys.has(vendor.key) ? { ...vendor, enabled: true, updatedAt: restoredAt } : vendor,
    );
  }
}
