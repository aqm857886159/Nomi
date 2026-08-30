import crypto from "node:crypto";

import { readCatalog } from "./catalogStore";
import { candidateRevisionId } from "./stagedVendorIdentity";
import type { Mapping, Model, ProfileKind, Vendor } from "./types";
import { decryptApiKeyRecord } from "./secrets";
import { defaultCatalog } from "../providerAdapter/serviceCatalog";
import type { CertificationMediaEvidence, CertificationMediaKind } from "../providerAdapter/certificationMedia";
import type { AdapterModeResult, ProviderAdapterDraft, ProviderAdapterRevision, ProviderAdapterRun } from "../providerAdapter/types";
import { certifyTaskOutputUrls } from "../tasks/taskResultCertification";
import type { TaskStatus } from "../tasks/responseParsing";

export type ComfyStagedCandidate = {
  revisionId: string;
  vendor: Vendor;
  model: Model;
  mapping: Mapping;
  apiKey: string;
  customConfig: Record<string, string>;
};

type CertificationRequest = {
  kind: ProfileKind;
  extras?: Record<string, unknown>;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Main-process-only resolver: disabled candidates are executable only by exact opaque revision. */
export function resolveComfyStagedCandidate(input: {
  revisionId: string;
  modelKey: string;
  taskKind: ProfileKind;
}): ComfyStagedCandidate {
  const state = readCatalog();
  const vendor = state.vendors.find((item) => candidateRevisionId(item.meta) === input.revisionId);
  if (!vendor || vendor.enabled) throw new Error("ComfyUI staged candidate was not found");
  const model = state.models.find((item) => item.vendorKey === vendor.key && item.modelKey === input.modelKey);
  const adapter = record(record(model?.meta).adapter);
  if (!model || model.enabled || adapter.runId !== input.revisionId || adapter.state !== "testing") {
    throw new Error("ComfyUI staged candidate lease is invalid");
  }
  const mapping = state.mappings.find((item) => item.vendorKey === vendor.key
    && item.modelKey === input.modelKey && item.taskKind === input.taskKind);
  if (!mapping || mapping.enabled) throw new Error("ComfyUI staged candidate mapping was not found");
  return {
    revisionId: input.revisionId,
    vendor,
    model,
    mapping,
    apiKey: decryptApiKeyRecord(state.apiKeysByVendor[vendor.key]),
    customConfig: {},
  };
}

export function resolveComfyCandidateExecution(request: CertificationRequest): ComfyStagedCandidate | undefined {
  const revisionId = text(request.extras?.comfyCertificationRevisionId);
  if (!revisionId) return undefined;
  const modelKey = text(request.extras?.modelKey) || text(request.extras?.modelAlias);
  if (request.extras?.certifyOutput !== true || !modelKey) {
    throw new Error("ComfyUI staged execution requires exact certification intent");
  }
  return resolveComfyStagedCandidate({ revisionId, modelKey, taskKind: request.kind });
}

function lifecycleArtifacts(candidate: ComfyStagedCandidate, mode: AdapterModeResult): {
  run: ProviderAdapterRun;
  draft: ProviderAdapterDraft;
  revision: ProviderAdapterRevision;
} {
  const now = new Date().toISOString();
  const draft: ProviderAdapterDraft = {
    provider: { baseUrl: String(candidate.vendor.baseUrlHint || ""), authType: "none" },
    sources: [],
    models: [{
      modelKey: candidate.model.modelKey,
      labelZh: candidate.model.labelZh,
      kind: candidate.model.kind,
      modes: [{ taskKind: candidate.mapping.taskKind, create: candidate.mapping.create, ...(candidate.mapping.query ? { query: candidate.mapping.query } : {}), sourceUrls: [] }],
    }],
  };
  const run: ProviderAdapterRun = {
    id: candidate.revisionId,
    vendorKey: candidate.vendor.key,
    vendorName: candidate.vendor.name,
    connectionFingerprint: "comfyui-local-candidate",
    selectedModelKeys: [candidate.model.modelKey],
    stage: mode.state === "verified" ? "completed" : "failed",
    repairAttempt: 0,
    models: [{ modelKey: candidate.model.modelKey, labelZh: candidate.model.labelZh, kind: candidate.model.kind, modes: [mode] }],
    sourceUrls: [],
    createdAt: now,
    updatedAt: now,
  };
  const revision: ProviderAdapterRevision = {
    id: candidate.revisionId,
    vendorKey: candidate.vendor.key,
    digest: crypto.createHash("sha256").update(JSON.stringify({ revisionId: candidate.revisionId, evidence: mode.mediaEvidence || null })).digest("hex"),
    draft,
    verifiedModes: mode.state === "verified" ? [{ modelKey: candidate.model.modelKey, taskKind: candidate.mapping.taskKind }] : [],
    createdAt: now,
  };
  return { run, draft, revision };
}

export function promoteCertifiedComfyCandidate(candidate: ComfyStagedCandidate, evidence: CertificationMediaEvidence[]): {
  vendorKey: string; modelKey: string;
} {
  const mode: AdapterModeResult = {
    taskKind: candidate.mapping.taskKind,
    state: "verified",
    attempts: 1,
    stage: "verify_asset",
    verifiedAt: new Date().toISOString(),
    mediaEvidence: evidence,
  };
  const artifacts = lifecycleArtifacts(candidate, mode);
  const result = defaultCatalog.promote({
    ...artifacts,
    verifiedModes: [{ modelKey: candidate.model.modelKey, taskKind: candidate.mapping.taskKind }],
  });
  if (result.status !== "committed") throw new Error("ComfyUI staged candidate promotion lease expired");
  return { vendorKey: candidate.vendor.key, modelKey: candidate.model.modelKey };
}

export function failComfyCandidate(candidate: ComfyStagedCandidate, reasonCode?: string): void {
  const mode: AdapterModeResult = {
    taskKind: candidate.mapping.taskKind,
    state: "failed",
    attempts: 1,
    stage: "verify_asset",
    error: "Media certification failed",
    ...(reasonCode ? { reasonCode: reasonCode as AdapterModeResult["reasonCode"] } : {}),
  };
  defaultCatalog.fail(lifecycleArtifacts(candidate, mode).run);
}

export async function certifyTaskOutputAndSettleComfyCandidate(input: {
  request: CertificationRequest;
  modelKey?: string;
  status: TaskStatus;
  urls: readonly string[];
  kind: Extract<CertificationMediaKind, "image" | "video" | "audio" | "model3d">;
  vendorBaseUrl: string;
}): Promise<{ candidate?: ComfyStagedCandidate; evidence: CertificationMediaEvidence[] }> {
  const revisionId = text(input.request.extras?.comfyCertificationRevisionId);
  if (revisionId && !input.modelKey) throw new Error("ComfyUI staged candidate model is missing");
  const candidate = revisionId
    ? resolveComfyStagedCandidate({ revisionId, modelKey: input.modelKey || "", taskKind: input.request.kind })
    : undefined;
  if (input.request.extras?.certifyOutput === true && input.status === "succeeded") {
    try {
      const evidence = await certifyTaskOutputUrls({ urls: input.urls, kind: input.kind, vendorBaseUrl: input.vendorBaseUrl });
      return { ...(candidate ? { candidate } : {}), evidence };
    } catch (error) {
      if (candidate) failComfyCandidate(candidate, (error as { reasonCode?: string })?.reasonCode);
      throw error;
    }
  } else if (candidate && input.status === "failed") {
    failComfyCandidate(candidate);
  }
  return { ...(candidate ? { candidate } : {}), evidence: [] };
}

export function activeComfyCandidateRevision(revisionId: string): { vendorKey: string; modelKey: string } | null {
  const state = readCatalog();
  for (const model of state.models) {
    const adapter = record(record(model.meta).adapter);
    if (adapter.activeRevision === revisionId && model.enabled) return { vendorKey: model.vendorKey, modelKey: model.modelKey };
  }
  return null;
}

/** Exact lease cleanup: stale revisions are harmless no-ops and cannot delete a newer candidate. */
export function failComfyCandidateRevision(input: { revisionId: string; modelKey: string; taskKind: ProfileKind; reasonCode?: string }): void {
  try {
    failComfyCandidate(resolveComfyStagedCandidate(input), input.reasonCode);
  } catch {
    // Already promoted, already cleaned, or superseded: never broaden cleanup by model identity.
  }
}

export async function materializeCertifiedComfyAssets<T>(input: {
  certification: { candidate?: ComfyStagedCandidate; evidence: CertificationMediaEvidence[] };
  status: TaskStatus;
  urls: readonly string[];
  materialize: (url: string, index: number) => Promise<T>;
}): Promise<T[]> {
  try {
    const assets = await Promise.all(input.urls.map(input.materialize));
    if (input.certification.candidate && input.status === "succeeded") {
      promoteCertifiedComfyCandidate(input.certification.candidate, input.certification.evidence);
    }
    return assets;
  } catch (error) {
    if (input.certification.candidate) failComfyCandidate(input.certification.candidate, (error as { reasonCode?: string })?.reasonCode);
    throw error;
  }
}
