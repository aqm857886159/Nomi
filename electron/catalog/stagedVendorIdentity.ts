import crypto from "node:crypto";
import { derivePublishedExecution, modelHasPublishedExecution } from "../shared/modelPublication";
import {
  ADAPTER_CANDIDATE_MODEL_PREDECESSORS,
  ADAPTER_CANDIDATE_PROMOTION_PREDECESSORS,
  ADAPTER_CANDIDATE_REVISION_ID,
  ADAPTER_CANDIDATE_ROOT_VENDOR_KEY,
  ADAPTER_CANDIDATE_SOURCE_VENDOR_KEY,
  candidateModelPredecessors,
  candidateRevisionId,
  candidateSourceVendorKey,
  isCandidateVendor,
  resolvedVendorLineageRoot,
  type CandidateModelPredecessors,
} from "../shared/vendorLineage";
import type { CatalogState, Vendor } from "./types";

export {
  ADAPTER_CANDIDATE_MODEL_PREDECESSORS,
  ADAPTER_CANDIDATE_PROMOTION_PREDECESSORS,
  ADAPTER_CANDIDATE_REVISION_ID,
  ADAPTER_CANDIDATE_ROOT_VENDOR_KEY,
  ADAPTER_CANDIDATE_SOURCE_VENDOR_KEY,
  candidateModelPredecessors,
  candidatePromotionPredecessors,
  candidateRevisionId,
  candidateRootVendorKey,
  candidateSourceVendorKey,
  isCandidateVendor,
  type CandidateModelPredecessor,
  type CandidateModelPredecessors,
} from "../shared/vendorLineage";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

/** Opaque candidate identity. The revision id makes equal connection settings distinct saves/runs. */
export function stagedVendorKey(rootVendorKey: string, connection: unknown, revisionId = "legacy"): string {
  const digest = crypto.createHash("sha256")
    .update(JSON.stringify(canonical({ connection, revisionId })))
    .digest("hex")
    .slice(0, 16);
  return `${rootVendorKey}--candidate-${digest}`;
}

export function newCandidateRevisionId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function resolvedCandidateRootVendorKey(state: CatalogState, vendorKey: string): string {
  return resolvedVendorLineageRoot(state.vendors, vendorKey);
}

function modelPublished(state: CatalogState, vendorKey: string, selected: ReadonlySet<string>): boolean {
  // A disabled vendor is not an active execution predecessor. This matters for
  // known seeded models: saving a new credential deliberately de-publishes the
  // vendor, so certification must promote the stable vendor key instead of
  // isolating a candidate and leaving the source row disabled.
  const vendor = state.vendors.find((candidate) => candidate.key === vendorKey);
  if (!vendor?.enabled) return false;
  return state.models.some((model) =>
    model.vendorKey === vendorKey &&
    (selected.size === 0 || selected.has(model.modelKey)) &&
    modelHasPublishedExecution(model, { mappings: state.mappings }),
  );
}

function vendorPublished(state: CatalogState, vendorKey: string): boolean {
  return modelPublished(state, vendorKey, new Set());
}

function lineageVendors(state: CatalogState, rootVendorKey: string): Vendor[] {
  return state.vendors.filter((vendor) =>
    vendor.key === rootVendorKey || resolvedVendorLineageRoot(state.vendors, vendor.key) === rootVendorKey,
  );
}

function activeModelPredecessors(
  state: CatalogState,
  lineage: readonly Vendor[],
  selectedModelKeys: readonly string[],
): CandidateModelPredecessors {
  const predecessors: CandidateModelPredecessors = {};
  for (const modelKey of selectedModelKeys) {
    const candidates = lineage.flatMap((vendor) => state.models
      .filter((model) => model.vendorKey === vendor.key && model.modelKey === modelKey)
      .map((model) => ({
        vendor,
        model,
        publication: derivePublishedExecution(model, { mappings: state.mappings, legacyWithoutAdapter: "text-only" }),
      })))
      .filter((candidate) => candidate.publication.published)
      .sort((left, right) => Date.parse(right.model.updatedAt) - Date.parse(left.model.updatedAt));
    const active = candidates[0];
    if (active) {
      predecessors[modelKey] = {
        vendorKey: active.vendor.key,
        publishedModes: active.publication.publishedModes,
      };
    }
  }
  return predecessors;
}

export type StagedVendorIdentity = {
  vendorKey: string;
  isolated: boolean;
  sourceVendorKey: string;
  rootVendorKey: string;
  revisionId: string;
  supersededVendorKeys: string[];
  modelPredecessors: CandidateModelPredecessors;
};

/**
 * Allocate one candidate revision without deriving identity from secret material.
 * A stage may reuse the exact unpublished registration row it was handed; every
 * new save/run against published execution receives a distinct sibling revision.
 */
export function planStagedVendorIdentity(input: {
  state: CatalogState;
  sourceVendorKey: string;
  connection: unknown;
  revisionId: string;
  selectedModelKeys: readonly string[];
  reuseUnpublishedCandidate: boolean;
}): StagedVendorIdentity {
  const sourceVendorKey = input.sourceVendorKey;
  const sourceVendor = input.state.vendors.find((vendor) => vendor.key === sourceVendorKey);
  const rootVendorKey = resolvedVendorLineageRoot(input.state.vendors, sourceVendorKey);
  const selected = new Set(input.selectedModelKeys);
  const lineage = lineageVendors(input.state, rootVendorKey);
  const modelPredecessors = activeModelPredecessors(input.state, lineage, input.selectedModelKeys);

  const sameRevision = input.reuseUnpublishedCandidate
    ? lineage.find((vendor) =>
        isCandidateVendor(vendor) &&
        candidateRevisionId(vendor.meta) === input.revisionId &&
        !vendorPublished(input.state, vendor.key),
      )
    : undefined;
  if (sameRevision) {
    return {
      vendorKey: sameRevision.key,
      isolated: true,
      sourceVendorKey: candidateSourceVendorKey(sameRevision.meta),
      rootVendorKey,
      revisionId: input.revisionId,
      supersededVendorKeys: [],
      modelPredecessors: candidateModelPredecessors(sameRevision.meta),
    };
  }

  if (
    input.reuseUnpublishedCandidate &&
    isCandidateVendor(sourceVendor) &&
    !vendorPublished(input.state, sourceVendorKey)
  ) {
    return {
      vendorKey: sourceVendorKey,
      isolated: true,
      sourceVendorKey: candidateSourceVendorKey(sourceVendor?.meta),
      rootVendorKey,
      revisionId: candidateRevisionId(sourceVendor?.meta) || input.revisionId,
      supersededVendorKeys: [],
      modelPredecessors: candidateModelPredecessors(sourceVendor?.meta),
    };
  }

  const publishedSelected = lineage
    .filter((vendor) => modelPublished(input.state, vendor.key, selected))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
  const publishedSource = vendorPublished(input.state, sourceVendorKey) ? sourceVendor : undefined;
  const activeSource = publishedSelected || publishedSource;

  // First-time onboarding for a model without an active predecessor keeps the
  // stable source key even when a sibling model in the same vendor is already
  // published. Isolation is only needed when this selection replaces active
  // execution (or the caller explicitly supersedes a candidate); checking the
  // whole vendor here strands newly certified models in a candidate vendor.
  const hasPublishedSelectedModel = Boolean(publishedSelected);
  if (!hasPublishedSelectedModel && !isCandidateVendor(sourceVendor)) {
    return {
      vendorKey: sourceVendorKey,
      isolated: false,
      sourceVendorKey,
      rootVendorKey,
      revisionId: input.revisionId,
      supersededVendorKeys: [],
      modelPredecessors,
    };
  }

  const predecessorVendors = [...new Set(Object.values(modelPredecessors).map((predecessor) => predecessor.vendorKey))];
  const immediateSourceVendorKey = predecessorVendors.length === 1
    ? predecessorVendors[0]
    : activeSource?.key || rootVendorKey;
  let vendorKey = stagedVendorKey(rootVendorKey, input.connection, input.revisionId);
  let suffix = 2;
  while (input.state.vendors.some((vendor) => vendor.key === vendorKey)) {
    vendorKey = `${stagedVendorKey(rootVendorKey, input.connection, input.revisionId)}-${suffix}`;
    suffix += 1;
  }
  const supersededVendorKeys = lineage
    .filter((vendor) => isCandidateVendor(vendor) && vendor.key !== vendorKey && !vendorPublished(input.state, vendor.key))
    .map((vendor) => vendor.key);
  return {
    vendorKey,
    isolated: true,
    sourceVendorKey: immediateSourceVendorKey,
    rootVendorKey,
    revisionId: input.revisionId,
    supersededVendorKeys,
    modelPredecessors,
  };
}

export function candidateLineageMeta(identity: StagedVendorIdentity): Record<string, unknown> {
  return identity.isolated
    ? {
        [ADAPTER_CANDIDATE_SOURCE_VENDOR_KEY]: identity.sourceVendorKey,
        [ADAPTER_CANDIDATE_ROOT_VENDOR_KEY]: identity.rootVendorKey,
        [ADAPTER_CANDIDATE_REVISION_ID]: identity.revisionId,
        [ADAPTER_CANDIDATE_MODEL_PREDECESSORS]: identity.modelPredecessors,
      }
    : {};
}

export function candidatePromotionPredecessorMeta(
  predecessors: CandidateModelPredecessors,
): Record<string, CandidateModelPredecessors> {
  return { [ADAPTER_CANDIDATE_PROMOTION_PREDECESSORS]: predecessors };
}
