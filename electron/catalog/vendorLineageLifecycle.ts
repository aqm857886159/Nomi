import { nowIso } from "../jsonUtils";
import {
  candidateModelPredecessors,
  candidatePromotionPredecessors,
  candidateSourceVendorKey,
  modelSuccessorDepth,
} from "../shared/vendorLineage";
import {
  adapterPublicationModeMask,
  derivePublishedExecution,
  withAdapterPublicationModeMask,
} from "../shared/modelPublication";
import type { CatalogState, ProfileKind } from "./types";

function predecessorVendorKeys(meta: unknown): Set<string> {
  return new Set([
    ...Object.values(candidateModelPredecessors(meta)),
    ...Object.values(candidatePromotionPredecessors(meta)),
  ].map((predecessor) => predecessor.vendorKey));
}

export function vendorLineageClosure(state: CatalogState, rootKey: string): Set<string> {
  const keys = new Set([rootKey]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const vendor of state.vendors) {
      if (keys.has(vendor.key)) continue;
      const directlyDependsOnClosure = keys.has(candidateSourceVendorKey(vendor.meta))
        || [...predecessorVendorKeys(vendor.meta)].some((vendorKey) => keys.has(vendorKey));
      if (!directlyDependsOnClosure) continue;
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

type RestorationTarget = {
  vendorKey: string;
  modelKey: string;
  publishedModes: Set<ProfileKind>;
};

function externalRestorationTargets(state: CatalogState, deleting: ReadonlySet<string>): RestorationTarget[] {
  const targets = new Map<string, RestorationTarget>();
  for (const vendor of state.vendors) {
    if (!deleting.has(vendor.key)) continue;
    for (const [modelKey, predecessor] of Object.entries(candidatePromotionPredecessors(vendor.meta))) {
      if (deleting.has(predecessor.vendorKey)) continue;
      const id = `${predecessor.vendorKey}\0${modelKey}`;
      const target = targets.get(id) || {
        vendorKey: predecessor.vendorKey,
        modelKey,
        publishedModes: new Set<ProfileKind>(),
      };
      predecessor.publishedModes.forEach((mode) => target.publishedModes.add(mode));
      targets.set(id, target);
    }
  }
  return [...targets.values()];
}

function survivingPublishedModes(
  state: CatalogState,
  target: Pick<RestorationTarget, "vendorKey" | "modelKey">,
): Set<ProfileKind> {
  const modes = new Set<ProfileKind>();
  for (const model of state.models) {
    if (model.modelKey !== target.modelKey || model.vendorKey === target.vendorKey) continue;
    const depth = modelSuccessorDepth(
      state.vendors,
      model.vendorKey,
      target.vendorKey,
      [target.modelKey, model.modelAlias || ""].filter(Boolean),
    );
    if (depth == null || depth <= 0) continue;
    const publication = derivePublishedExecution(model, {
      mappings: state.mappings,
      legacyWithoutAdapter: "text-only",
    });
    if (publication.published) publication.publishedModes.forEach((mode) => modes.add(mode));
  }
  return modes;
}

function restoreExternalPredecessors(state: CatalogState, targets: readonly RestorationTarget[]): void {
  const restoredAt = nowIso();
  const restoredVendorKeys = new Set<string>();
  const modesByModel = new Map<string, { restorable: Set<ProfileKind>; publication: Set<ProfileKind> }>();
  for (const target of targets) {
    const replacingModes = survivingPublishedModes(state, target);
    const restorableModes = new Set([...target.publishedModes].filter((mode) => !replacingModes.has(mode)));
    if (restorableModes.size === 0) continue;
    const sourceModel = state.models.find((model) =>
      model.vendorKey === target.vendorKey && model.modelKey === target.modelKey);
    const existingMask = adapterPublicationModeMask(sourceModel?.meta);
    const publication = new Set<ProfileKind>([
      ...(existingMask.present ? existingMask.modes : []),
      ...restorableModes,
    ].filter((mode) => !replacingModes.has(mode)));
    modesByModel.set(`${target.vendorKey}\0${target.modelKey}`, { restorable: restorableModes, publication });
  }
  state.models = state.models.map((model) => {
    const restoration = modesByModel.get(`${model.vendorKey}\0${model.modelKey}`);
    if (!restoration) return model;
    restoredVendorKeys.add(model.vendorKey);
    return {
      ...model,
      enabled: restoration.publication.size > 0,
      meta: withAdapterPublicationModeMask(model.meta, [...restoration.publication]),
      updatedAt: restoredAt,
    };
  });
  state.mappings = state.mappings.map((mapping) => {
    if (!mapping.modelKey) return mapping;
    const restoration = modesByModel.get(`${mapping.vendorKey}\0${mapping.modelKey}`);
    if (!restoration?.restorable.has(mapping.taskKind)) return mapping;
    return { ...mapping, enabled: true, updatedAt: restoredAt };
  });
  if (restoredVendorKeys.size > 0) {
    state.vendors = state.vendors.map((vendor) =>
      restoredVendorKeys.has(vendor.key) ? { ...vendor, enabled: true, updatedAt: restoredAt } : vendor,
    );
  }
}

/** Delete a candidate dependency closure, then restore only external contracts not replaced by survivors. */
export function deleteVendorLineageAndRestore(state: CatalogState, rootKey: string): void {
  const deleting = vendorLineageClosure(state, rootKey);
  const targets = externalRestorationTargets(state, deleting);
  removeVendorLineage(state, rootKey);
  restoreExternalPredecessors(state, targets);
}
