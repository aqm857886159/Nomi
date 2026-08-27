import {
  extractVendorExtraHeaders,
  mutateCatalog,
  normalizeProviderKind,
  readCatalog,
} from "../catalog/catalogStore";
import { apiKeyDecryptStatus, decryptApiKeyRecord } from "../catalog/secrets";
import type { Model, ProfileKind, Vendor } from "../catalog/types";
import { humanizeModelKey } from "../catalog/modelLabel";
import { modelHasPublishedExecution } from "../shared/modelPublication";
import {
  candidateLineageMeta,
  candidateModelPredecessors,
  candidatePromotionPredecessorMeta,
  candidateSourceVendorKey,
  newCandidateRevisionId,
  planStagedVendorIdentity,
  type CandidateModelPredecessors,
} from "../catalog/stagedVendorIdentity";
import { adapterModelMetadataForPromotion } from "./promotionMeta";
import type {
  ProviderAdapterDraft,
  ProviderAdapterRegisterInput,
  ProviderAdapterRevision,
  ProviderAdapterRun,
} from "./types";
import type { ProviderAdapterStartInput } from "./service";

export type LoadedConnection = {
  vendor: Vendor;
  models: Model[];
  apiKey: string;
  headers?: Record<string, string>;
};

export type ProviderAdapterPromotionResult =
  | { status: "committed"; committedModes: Array<{ modelKey: string; taskKind: ProfileKind }> }
  | { status: "no-lease" };

export type StagedProviderAdapterCatalog = {
  vendor: Vendor;
  models: Model[];
  lineageRootVendorKey: string;
  supersededVendorKeys: string[];
};

export type ProviderAdapterCatalogPort = {
  register(input: ProviderAdapterRegisterInput & { vendorKey: string; savedAt: string }): { vendor: Vendor; models: Model[] };
  stage(input: ProviderAdapterStartInput & { vendorKey: string; runId: string }): StagedProviderAdapterCatalog;
  load(vendorKey: string, selectedModelKeys: readonly string[]): LoadedConnection | null;
  promote(input: {
    run: ProviderAdapterRun;
    draft: ProviderAdapterDraft;
    revision: ProviderAdapterRevision;
    verifiedModes: Array<{ modelKey: string; taskKind: ProfileKind }>;
  }): ProviderAdapterPromotionResult;
  fail(run: ProviderAdapterRun): void;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * A model's adapter metadata is the catalog-side lease for a verification run.
 * Terminal work can finish after a newer run has staged the same model, so every
 * catalog write must compare this lease before publishing its result.
 */
function modelOwnedByRun(model: Model, runId: string): boolean {
  const adapter = asRecord(asRecord(model.meta).adapter);
  return adapter.runId === runId;
}

/** Existing published execution survives registration/repair; staged adapter rows do not become active by enabled alone. */
function hasPublishedExecution(state: ReturnType<typeof readCatalog>, model: Model | undefined): boolean {
  return modelHasPublishedExecution(model, {
    mappings: state.mappings,
    legacyWithoutAdapter: "text-only",
  });
}

function vendorHasPublishedExecution(state: ReturnType<typeof readCatalog>, vendorKey: string): boolean {
  return state.models.some((model) => model.vendorKey === vendorKey && hasPublishedExecution(state, model));
}

function connectionIdentity(input: ProviderAdapterStartInput): Record<string, unknown> {
  return {
    baseUrl: input.baseUrl,
    authType: input.authType,
    authHeader: input.authHeader || null,
    authQueryParam: input.authQueryParam || null,
    providerKind: normalizeProviderKind(input.providerKind),
    headers: input.headers || {},
  };
}

export const defaultCatalog: ProviderAdapterCatalogPort = {
  register(input) {
    const before = readCatalog();
    const sourceVendorKey = input.vendorKey;
    const identity = planStagedVendorIdentity({
      state: before,
      sourceVendorKey,
      connection: connectionIdentity(input),
      revisionId: newCandidateRevisionId("registration"),
      selectedModelKeys: input.models.map((model) => model.modelKey),
      reuseUnpublishedCandidate: false,
    });
    const targetVendorKey = identity.vendorKey;
    const existingVendor = before.vendors.find((vendor) => vendor.key === targetVendorKey);
    const sourceVendor = before.vendors.find((vendor) => vendor.key === identity.sourceVendorKey)
      || before.vendors.find((vendor) => vendor.key === sourceVendorKey);
    const cleanHeaders = Object.fromEntries(
      Object.entries(input.headers || {}).filter(([key, value]) => key.trim() && value.trim()),
    );
    const savedCredential = before.apiKeysByVendor[identity.sourceVendorKey] || before.apiKeysByVendor[sourceVendorKey];
    if (input.authType !== "none" && input.preserveExistingCredential) {
      if (!savedCredential?.apiKey || savedCredential.enabled === false) {
        throw new Error("The saved connection credential is missing; enter the API key again");
      }
      if (savedCredential.enc !== "safeStorage") {
        throw new Error("The saved connection credential needs to be saved again before authentication can continue");
      }
    }
    const isolatedCandidate = identity.isolated;
    const vendorEnabled = isolatedCandidate ? false : vendorHasPublishedExecution(before, sourceVendorKey);
    return mutateCatalog((tx) => {
      for (const superseded of identity.supersededVendorKeys) tx.deleteVendor(superseded);
      const vendor = tx.upsertVendor({
        key: targetVendorKey,
        name: input.vendorName || existingVendor?.name || sourceVendor?.name || targetVendorKey,
        enabled: vendorEnabled,
        baseUrlHint: input.baseUrl,
        authType: input.authType,
        authHeader: input.authHeader || null,
        authQueryParam: input.authQueryParam || null,
        providerKind: normalizeProviderKind(input.providerKind),
        meta: {
          ...asRecord(existingVendor?.meta),
          ...(Object.keys(cleanHeaders).length ? { extraHeaders: cleanHeaders } : {}),
          ...candidateLineageMeta(identity),
        },
      });
      if (input.authType === "none") tx.deleteApiKey(targetVendorKey);
      else if (!input.preserveExistingCredential) tx.upsertApiKey(targetVendorKey, { apiKey: input.apiKey, enabled: true });
      else if (isolatedCandidate) {
        tx.upsertApiKey(targetVendorKey, { apiKey: decryptApiKeyRecord(savedCredential), enabled: true });
      }
      const models = input.models.map((selected) => {
        const existing = before.models.find(
          (model) => model.vendorKey === targetVendorKey && model.modelKey === selected.modelKey,
        );
        const canExecute = hasPublishedExecution(before, existing);
        if (existing && canExecute) {
          // Registration is staging, not promotion. Re-saving credentials or
          // selecting a replacement candidate must not mutate the active model
          // contract before a mode verifies.
          return existing;
        }
        return tx.upsertModel({
          ...(existing || {}),
          vendorKey: targetVendorKey,
          modelKey: selected.modelKey,
          modelAlias: existing?.modelAlias || selected.modelKey,
          labelZh: selected.labelZh || existing?.labelZh || humanizeModelKey(selected.modelKey),
          kind: selected.kind,
          enabled: Boolean(existing?.enabled && canExecute),
          onboarding: existing?.onboarding || { addedVia: "manual", addedAt: input.savedAt, fields: [] },
          meta: {
            ...asRecord(existing?.meta),
            adapter: { state: "unverified", modes: [], updatedAt: input.savedAt },
          },
        });
      });
      return { vendor, models };
    });
  },

  stage(input) {
    const before = readCatalog();
    const sourceVendorKey = input.vendorKey;
    const identity = planStagedVendorIdentity({
      state: before,
      sourceVendorKey,
      connection: connectionIdentity(input),
      revisionId: input.runId,
      selectedModelKeys: input.models.map((model) => model.modelKey),
      reuseUnpublishedCandidate: true,
    });
    const targetVendorKey = identity.vendorKey;
    const existingVendor = before.vendors.find((vendor) => vendor.key === targetVendorKey);
    const sourceVendor = before.vendors.find((vendor) => vendor.key === identity.sourceVendorKey)
      || before.vendors.find((vendor) => vendor.key === sourceVendorKey);
    const cleanHeaders = Object.fromEntries(
      Object.entries(input.headers || {}).filter(([key, value]) => key.trim() && value.trim()),
    );
    const savedCredential = before.apiKeysByVendor[sourceVendorKey];
    if (input.authType !== "none" && input.catalogVendorKey && savedCredential?.apiKey && savedCredential.enc !== "safeStorage") {
      throw new Error("The saved connection credential needs to be saved again before authentication can continue");
    }
    const isolatedCandidate = identity.isolated;
    const vendorEnabled = isolatedCandidate ? false : vendorHasPublishedExecution(before, sourceVendorKey);
    return mutateCatalog((tx) => {
      for (const superseded of identity.supersededVendorKeys) tx.deleteVendor(superseded);
      const vendor = tx.upsertVendor({
        key: targetVendorKey,
        name: input.vendorName || existingVendor?.name || sourceVendor?.name || targetVendorKey,
        enabled: vendorEnabled,
        baseUrlHint: input.baseUrl,
        authType: input.authType,
        authHeader: input.authHeader || null,
        authQueryParam: input.authQueryParam || null,
        providerKind: normalizeProviderKind(input.providerKind),
        meta: {
          ...asRecord(existingVendor?.meta),
          ...(Object.keys(cleanHeaders).length ? { extraHeaders: cleanHeaders } : {}),
          ...candidateLineageMeta(identity),
        },
      });
      if (input.authType === "none") tx.deleteApiKey(targetVendorKey);
      else tx.upsertApiKey(targetVendorKey, { apiKey: input.apiKey, enabled: true });
      const models = input.models.map((selected) => {
        const existing = before.models.find(
          (model) => model.vendorKey === targetVendorKey && model.modelKey === selected.modelKey,
        );
        const published = hasPublishedExecution(before, existing);
        const activeContract = published && existing ? existing : undefined;
        return tx.upsertModel({
          vendorKey: targetVendorKey,
          modelKey: selected.modelKey,
          modelAlias: activeContract?.modelAlias || existing?.modelAlias || selected.modelKey,
          labelZh: activeContract?.labelZh || selected.labelZh || existing?.labelZh || humanizeModelKey(selected.modelKey),
          kind: activeContract?.kind || selected.kind,
          enabled: published,
          onboarding: activeContract?.onboarding,
          customCall: activeContract?.customCall,
          meta: {
            ...asRecord(existing?.meta),
            adapter: {
              state: "testing",
              runId: input.runId,
              activeRevision: asRecord(asRecord(existing?.meta).adapter).activeRevision,
              modes: [],
              updatedAt: new Date().toISOString(),
            },
          },
        });
      });
      return {
        vendor,
        models,
        lineageRootVendorKey: identity.rootVendorKey,
        supersededVendorKeys: identity.supersededVendorKeys,
      };
    });
  },

  load(vendorKey, selectedModelKeys) {
    const state = readCatalog();
    const vendor = state.vendors.find((item) => item.key === vendorKey);
    if (!vendor) return null;
    const credential = state.apiKeysByVendor[vendorKey];
    if (vendor.authType !== "none" && apiKeyDecryptStatus(credential) !== "ok") return null;
    const apiKey = decryptApiKeyRecord(credential);
    const selected = new Set(selectedModelKeys);
    const models = state.models.filter((model) => model.vendorKey === vendorKey && selected.has(model.modelKey));
    if (models.length !== selected.size) return null;
    return { vendor, models, apiKey, headers: extractVendorExtraHeaders(vendor) };
  },

  promote(input) {
    const before = readCatalog();
    const ownedModelKeys = new Set(
      before.models
        .filter((model) => model.vendorKey === input.run.vendorKey && modelOwnedByRun(model, input.run.id))
        .map((model) => model.modelKey),
    );
    // A newer run owns every selected model. The old run is stale even if its
    // caller reached promote after the service-level stale check; do not enable
    // the vendor or publish mappings from that obsolete result.
    const committedModes = input.verifiedModes.filter((mode) => ownedModelKeys.has(mode.modelKey));
    if (committedModes.length === 0 || committedModes.length !== input.verifiedModes.length) {
      return { status: "no-lease" };
    }
    const verified = new Set(committedModes.map((item) => `${item.modelKey}\0${item.taskKind}`));
    const vendorEnabled = before.models.some((model) => {
      if (model.vendorKey !== input.run.vendorKey) return false;
      if (hasPublishedExecution(before, model)) return true;
      return ownedModelKeys.has(model.modelKey) && committedModes.some((mode) => mode.modelKey === model.modelKey);
    });
    const candidateVendor = before.vendors.find((vendor) => vendor.key === input.run.vendorKey);
    if (!candidateVendor) return { status: "no-lease" };
    const predecessors = candidateModelPredecessors(candidateVendor.meta);
    const switchedModelKeys = new Set(
      committedModes
        .filter((mode) => ownedModelKeys.has(mode.modelKey))
        .map((mode) => mode.modelKey),
    );
    const promotionPredecessors: CandidateModelPredecessors = Object.fromEntries(
      [...switchedModelKeys]
        .filter((modelKey) => Boolean(predecessors[modelKey]))
        .map((modelKey) => [modelKey, predecessors[modelKey]]),
    );
    const switchedBySource = new Map<string, Set<string>>();
    for (const [modelKey, predecessor] of Object.entries(promotionPredecessors)) {
      const models = switchedBySource.get(predecessor.vendorKey) || new Set<string>();
      models.add(modelKey);
      switchedBySource.set(predecessor.vendorKey, models);
    }
    mutateCatalog((tx) => {
      const existingVendor = before.vendors.find((vendor) => vendor.key === input.run.vendorKey);
      if (!existingVendor) throw new Error(`Provider disappeared before adapter promotion: ${input.run.vendorKey}`);
      tx.upsertVendor({
        ...existingVendor,
        enabled: vendorEnabled,
        meta: {
          ...asRecord(existingVendor.meta),
          ...candidatePromotionPredecessorMeta(promotionPredecessors),
        },
      });
      for (const [sourceVendorKey, sourceModelKeys] of switchedBySource) {
        for (const sourceModel of before.models) {
          if (sourceModel.vendorKey !== sourceVendorKey || !sourceModelKeys.has(sourceModel.modelKey)) continue;
          tx.upsertModel({ ...sourceModel, enabled: false });
        }
        for (const sourceMapping of before.mappings) {
          if (!sourceMapping.modelKey) continue;
          const predecessor = promotionPredecessors[sourceMapping.modelKey];
          if (
            sourceMapping.vendorKey !== sourceVendorKey ||
            !sourceModelKeys.has(sourceMapping.modelKey) ||
            !predecessor?.publishedModes.includes(sourceMapping.taskKind)
          ) continue;
          tx.upsertMapping({ ...sourceMapping, enabled: false });
        }
        const sourceVendor = before.vendors.find((vendor) => vendor.key === sourceVendorKey);
        if (sourceVendor) {
          const sourceStillPublished = before.models.some(
            (model) => model.vendorKey === sourceVendorKey && !sourceModelKeys.has(model.modelKey) && hasPublishedExecution(before, model),
          );
          tx.upsertVendor({ ...sourceVendor, enabled: sourceStillPublished });
        }
      }
      for (const candidate of input.draft.models) {
        if (!ownedModelKeys.has(candidate.modelKey)) continue;
        const existing = before.models.find(
          (model) => model.vendorKey === input.run.vendorKey && model.modelKey === candidate.modelKey,
        );
        if (!existing) continue;
        const modeResults = input.run.models.find((model) => model.modelKey === candidate.modelKey)?.modes || [];
        const oldMeta = asRecord(existing.meta);
        const hasVerifiedMode = committedModes.some((mode) => mode.modelKey === candidate.modelKey);
        tx.upsertModel({
          ...existing,
          ...(hasVerifiedMode ? { labelZh: candidate.labelZh, kind: candidate.kind } : {}),
          enabled: hasVerifiedMode || hasPublishedExecution(before, existing),
          meta: adapterModelMetadataForPromotion({
            oldMeta,
            candidate,
            modeResults,
            runId: input.run.id,
            revisionId: input.revision.id,
            updatedAt: input.run.updatedAt,
          }),
        });
        for (const mode of candidate.modes) {
          if (candidate.kind === "text") continue;
          const passed = verified.has(`${candidate.modelKey}\0${mode.taskKind}`);
          const existingExact = before.mappings.find(
            (mapping) =>
              mapping.vendorKey === input.run.vendorKey &&
              mapping.modelKey === candidate.modelKey &&
              mapping.taskKind === mode.taskKind,
          );
          if (!passed && existingExact && hasPublishedExecution(before, existing)) continue;
          tx.upsertMapping({
            ...(existingExact || {}),
            vendorKey: input.run.vendorKey,
            modelKey: candidate.modelKey,
            taskKind: mode.taskKind,
            name: `${candidate.labelZh} · ${mode.taskKind}`,
            enabled: passed,
            create: mode.create,
            ...(mode.query ? { query: mode.query } : {}),
            ...(mode.statusMapping ? { statusMapping: mode.statusMapping } : {}),
          });
        }
      }
      const compiledModels = new Set(input.draft.models.map((model) => model.modelKey));
      for (const resultModel of input.run.models) {
        if (compiledModels.has(resultModel.modelKey)) continue;
        if (!ownedModelKeys.has(resultModel.modelKey)) continue;
        const existing = before.models.find(
          (model) => model.vendorKey === input.run.vendorKey && model.modelKey === resultModel.modelKey,
        );
        if (!existing) continue;
        const oldMeta = asRecord(existing.meta);
        tx.upsertModel({
          ...existing,
          meta: {
            ...oldMeta,
            adapter: {
              state: "failed",
              runId: input.run.id,
              activeRevision: asRecord(oldMeta.adapter).activeRevision,
              modes: resultModel.modes,
              updatedAt: input.run.updatedAt,
            },
          },
        });
      }
    });
    return { status: "committed", committedModes };
  },

  fail(run) {
    const before = readCatalog();
    const ownedResults = run.models.filter((resultModel) => {
      const existing = before.models.find(
        (model) => model.vendorKey === run.vendorKey && model.modelKey === resultModel.modelKey,
      );
      return existing ? modelOwnedByRun(existing, run.id) : false;
    });
    if (ownedResults.length === 0) return;
    const failedVendor = before.vendors.find((vendor) => vendor.key === run.vendorKey);
    if (candidateSourceVendorKey(failedVendor?.meta) && !vendorHasPublishedExecution(before, run.vendorKey)) {
      mutateCatalog((tx) => tx.deleteVendor(run.vendorKey));
      return;
    }
    mutateCatalog((tx) => {
      for (const resultModel of ownedResults) {
        const existing = before.models.find(
          (model) => model.vendorKey === run.vendorKey && model.modelKey === resultModel.modelKey,
        );
        if (!existing) continue;
        const oldMeta = asRecord(existing.meta);
        const oldAdapter = asRecord(oldMeta.adapter);
        tx.upsertModel({
          ...existing,
          meta: {
            ...oldMeta,
            adapter: {
              state: "failed",
              runId: run.id,
              ...(typeof oldAdapter.activeRevision === "string"
                ? { activeRevision: oldAdapter.activeRevision }
                : {}),
              modes: resultModel.modes,
              updatedAt: run.updatedAt,
            },
          },
        });
      }
    });
  },
};
