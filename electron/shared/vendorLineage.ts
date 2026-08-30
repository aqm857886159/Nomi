import type { ProfileKind } from "../catalog/types";

export const ADAPTER_CANDIDATE_SOURCE_VENDOR_KEY = "adapterCandidateSourceVendorKey";
export const ADAPTER_CANDIDATE_ROOT_VENDOR_KEY = "adapterCandidateRootVendorKey";
export const ADAPTER_CANDIDATE_REVISION_ID = "adapterCandidateRevisionId";
export const ADAPTER_CANDIDATE_MODEL_PREDECESSORS = "adapterCandidateModelPredecessors";
export const ADAPTER_CANDIDATE_PROMOTION_PREDECESSORS = "adapterCandidatePromotionPredecessors";

const PROFILE_KINDS = new Set<ProfileKind>([
  "chat",
  "prompt_refine",
  "text_to_image",
  "image_to_prompt",
  "image_to_video",
  "text_to_video",
  "image_edit",
  "text_to_audio",
  "image_to_audio",
  "transcribe",
  "text_to_3d",
  "image_to_3d",
]);

export type CandidateModelPredecessor = {
  vendorKey: string;
  publishedModes: ProfileKind[];
};

export type CandidateModelPredecessors = Record<string, CandidateModelPredecessor>;

export type VendorLineageEntry = {
  key: string;
  meta?: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parsePredecessors(value: unknown): CandidateModelPredecessors {
  const raw = record(value);
  if (!raw) return {};
  const parsed: CandidateModelPredecessors = {};
  for (const [modelKey, item] of Object.entries(raw)) {
    const candidate = record(item);
    const vendorKey = text(candidate?.vendorKey);
    const publishedModes = Array.isArray(candidate?.publishedModes)
      ? candidate.publishedModes.filter((mode): mode is ProfileKind =>
          typeof mode === "string" && PROFILE_KINDS.has(mode as ProfileKind))
      : [];
    if (modelKey.trim() && vendorKey && publishedModes.length > 0) {
      parsed[modelKey] = { vendorKey, publishedModes: [...new Set(publishedModes)] };
    }
  }
  return parsed;
}

export function candidateSourceVendorKey(meta: unknown): string {
  return text(record(meta)?.[ADAPTER_CANDIDATE_SOURCE_VENDOR_KEY]);
}

export function candidateRootVendorKey(meta: unknown): string {
  return text(record(meta)?.[ADAPTER_CANDIDATE_ROOT_VENDOR_KEY]);
}

export function candidateRevisionId(meta: unknown): string {
  return text(record(meta)?.[ADAPTER_CANDIDATE_REVISION_ID]);
}

export function candidateModelPredecessors(meta: unknown): CandidateModelPredecessors {
  return parsePredecessors(record(meta)?.[ADAPTER_CANDIDATE_MODEL_PREDECESSORS]);
}

export function candidatePromotionPredecessors(meta: unknown): CandidateModelPredecessors {
  return parsePredecessors(record(meta)?.[ADAPTER_CANDIDATE_PROMOTION_PREDECESSORS]);
}

export function isCandidateVendor(vendor: Pick<VendorLineageEntry, "meta"> | null | undefined): boolean {
  return Boolean(candidateSourceVendorKey(vendor?.meta));
}

export function resolvedVendorLineageRoot(
  vendors: readonly VendorLineageEntry[],
  vendorKey: string,
): string {
  let current = vendorKey;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const vendor = vendors.find((item) => item.key === current);
    const explicitRoot = candidateRootVendorKey(vendor?.meta);
    if (explicitRoot) return explicitRoot;
    const source = candidateSourceVendorKey(vendor?.meta);
    if (!source) return current;
    current = source;
  }
  return vendorKey;
}

function predecessorForModel(meta: unknown, modelIdentifiers: readonly string[]): CandidateModelPredecessor | null {
  const promoted = candidatePromotionPredecessors(meta);
  const staged = candidateModelPredecessors(meta);
  for (const modelKey of modelIdentifiers) {
    if (promoted[modelKey]) return promoted[modelKey];
    if (staged[modelKey]) return staged[modelKey];
  }
  // Old candidate rows predate per-model predecessor metadata. Their explicit
  // source edge remains a lineage contract; a vendor with no lineage metadata
  // never reaches this compatibility branch.
  if (Object.keys(promoted).length === 0 && Object.keys(staged).length === 0) {
    const source = candidateSourceVendorKey(meta);
    if (source) return { vendorKey: source, publishedModes: [] };
  }
  return null;
}

/**
 * Returns the number of explicit predecessor hops from candidate to source.
 * `null` means the candidate is not a successor for this model. This is the
 * shared renderer/Electron lineage predicate; root equality alone is not proof
 * that a particular model revision replaced another one.
 */
export function modelSuccessorDepth(
  vendors: readonly VendorLineageEntry[],
  candidateVendorKey: string,
  sourceVendorKey: string,
  modelIdentifiers: readonly string[],
): number | null {
  if (!candidateVendorKey || !sourceVendorKey || candidateVendorKey === sourceVendorKey) return 0;
  if (resolvedVendorLineageRoot(vendors, candidateVendorKey) !== resolvedVendorLineageRoot(vendors, sourceVendorKey)) {
    return null;
  }
  let current = candidateVendorKey;
  const seen = new Set<string>();
  let depth = 0;
  while (current && !seen.has(current)) {
    if (current === sourceVendorKey) return depth;
    seen.add(current);
    const vendor = vendors.find((item) => item.key === current);
    if (!vendor) return null;
    const predecessor = predecessorForModel(vendor.meta, modelIdentifiers);
    if (!predecessor) return null;
    current = predecessor.vendorKey;
    depth += 1;
  }
  return null;
}
