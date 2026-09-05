import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonFileAtomic } from "../jsonFile";
import {
  ProductionRunLockBusyError,
  createProductionRunLock,
  type ProductionRunLock,
} from "../productionRun/productionRunLock";
import { getSettingsRoot } from "../runtimePaths";
import type {
  AdapterModeResult,
  ProviderAdapterRevision,
  ProviderAdapterRun,
  ProviderAdapterStoreState,
} from "./types";
import type { PromotionTerminalStage } from "../integrationCertification/types";

const EMPTY_STATE: ProviderAdapterStoreState = { version: 1, revision: 0, runs: [], revisions: [] };
export const TERMINAL_ADAPTER_STAGES = new Set<ProviderAdapterRun["stage"]>([
  "completed",
  "partial",
  "failed",
  "needs_ai",
  "cancelled",
  "timed_out",
  "stale",
]);

export function isTerminalAdapterStage(stage: ProviderAdapterRun["stage"]): boolean {
  return TERMINAL_ADAPTER_STAGES.has(stage);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

const SAFE_REASON_CODES = new Set([
  "media_cancelled", "media_content_type_unsupported", "media_corrupt", "media_decode_failed",
  "media_fetch_failed", "media_invalid_source", "media_kind_mismatch", "media_markup_masquerade",
  "media_mime_mismatch", "media_redirect_forbidden", "media_storage_failed", "media_stream_limit_exceeded",
  "media_timeout", "media_too_large", "media_unsupported_format", "media_unsupported_3d",
]);
const SAFE_ERROR_PARAMS = new Set([
  "expectedKind", "detectedKind", "declaredKind", "declaredType", "detectedType", "limitBytes",
  "stage", "timeoutMs", "maxDurationSeconds", "maxPixels", "maxStreams",
]);
const SAFE_METADATA_NUMBERS = new Set([
  "width", "height", "durationSeconds", "fps", "sampleRate", "channels", "streamCount",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sanitizeMode(mode: AdapterModeResult): AdapterModeResult {
  const raw = asRecord(mode);
  const rawEvidence = Array.isArray(raw.mediaEvidence)
    ? raw.mediaEvidence.slice(0, 8)
    : raw.mediaEvidence ? [raw.mediaEvidence] : [];
  const safeEvidence = rawEvidence.flatMap((item) => {
    const evidence = asRecord(item);
    const metadata = asRecord(evidence.metadata);
    const safeMetadata: Record<string, number | string> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (SAFE_METADATA_NUMBERS.has(key) && typeof value === "number" && Number.isFinite(value) && value >= 0) safeMetadata[key] = value;
      if ((key === "videoCodec" || key === "audioCodec") && typeof value === "string" && /^[A-Za-z0-9_.+-]{1,64}$/.test(value)) safeMetadata[key] = value;
    }
    return typeof evidence.kind === "string" && ["image", "video", "audio", "model3d"].includes(evidence.kind)
      && typeof evidence.contentType === "string" && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(evidence.contentType)
      && typeof evidence.byteLength === "number" && Number.isSafeInteger(evidence.byteLength) && evidence.byteLength > 0
      && typeof evidence.sha256 === "string" && /^[a-f0-9]{64}$/.test(evidence.sha256)
      ? [{
          kind: evidence.kind as "image" | "video" | "audio" | "model3d",
          contentType: evidence.contentType,
          byteLength: evidence.byteLength,
          sha256: evidence.sha256,
          metadata: safeMetadata,
        }]
      : [];
  });
  const params = asRecord(raw.errorParams);
  const safeParams: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (SAFE_ERROR_PARAMS.has(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
      safeParams[key] = value;
    }
  }
  const base = { ...mode } as Record<string, unknown>;
  delete base.mediaEvidence;
  delete base.reasonCode;
  delete base.errorParams;
  return {
    ...base as AdapterModeResult,
    ...(safeEvidence.length ? { mediaEvidence: safeEvidence } : {}),
    ...(typeof raw.reasonCode === "string" && SAFE_REASON_CODES.has(raw.reasonCode) ? { reasonCode: raw.reasonCode as AdapterModeResult["reasonCode"] } : {}),
    ...(Object.keys(safeParams).length ? { errorParams: safeParams } : {}),
  };
}

function sanitizeRun(run: ProviderAdapterRun): ProviderAdapterRun {
  return {
    ...run,
    currentModelKey: run.currentModelKey,
    recovery: run.recovery,
    models: Array.isArray(run.models)
      ? run.models.map((model) => ({ ...model, modes: Array.isArray(model.modes) ? model.modes.map(sanitizeMode) : [] }))
      : [],
  };
}

function loadState(filePath: string): ProviderAdapterStoreState {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<ProviderAdapterStoreState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.runs) || !Array.isArray(parsed.revisions)) return clone(EMPTY_STATE);
    return {
      version: 1,
      revision: Number.isSafeInteger(parsed.revision) && Number(parsed.revision) >= 0 ? Number(parsed.revision) : 0,
      runs: (parsed.runs as ProviderAdapterRun[]).map(sanitizeRun),
      revisions: parsed.revisions as ProviderAdapterRevision[],
    };
  } catch {
    return clone(EMPTY_STATE);
  }
}

export function providerAdapterStorePath(settingsRoot = getSettingsRoot()): string {
  return path.join(settingsRoot, "provider-adapters.json");
}

export class ProviderAdapterStore {
  private state: ProviderAdapterStoreState;
  private readonly lock: ProductionRunLock;

  constructor(private readonly filePath = providerAdapterStorePath()) {
    this.state = loadState(filePath);
    this.lock = createProductionRunLock({
      filePath: `${filePath}.lock`,
      epochPath: `${filePath}.lock.epoch`,
      ownerId: `provider-adapter-store-${process.pid}-${crypto.randomUUID()}`,
      pid: process.pid,
      leaseMs: 30_000,
    });
  }

  integrationCertificationPath(fileName: string): string {
    return path.join(path.dirname(this.filePath), "integration-certification", fileName);
  }

  snapshot(): ProviderAdapterStoreState {
    return clone(this.refresh());
  }

  getRun(id: string): ProviderAdapterRun | undefined {
    const found = this.refresh().runs.find((run) => run.id === id);
    return found ? clone(found) : undefined;
  }

  latestRun(vendorKey: string): ProviderAdapterRun | undefined {
    const found = [...this.refresh().runs].reverse().find((run) => run.vendorKey === vendorKey);
    return found ? clone(found) : undefined;
  }

  listRuns(options: { vendorKey?: string; activeOnly?: boolean; limit?: number } = {}): ProviderAdapterRun[] {
    const limit = Math.max(1, Math.min(200, Math.trunc(options.limit || 50)));
    return this.refresh().runs
      .filter((run) => !options.vendorKey || run.vendorKey === options.vendorKey)
      .filter((run) => !options.activeOnly || !isTerminalAdapterStage(run.stage))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, limit)
      .map(clone);
  }

  upsertRun(run: ProviderAdapterRun): ProviderAdapterRun {
    const next = clone(sanitizeRun(run));
    return this.mutate((fresh) => {
      const runs = [...fresh.runs];
      const index = runs.findIndex((item) => item.id === run.id);
      if (index >= 0) runs[index] = next;
      else runs.push(next);
      return { state: { ...fresh, runs }, result: next };
    });
  }

  updateRun(id: string, update: (current: ProviderAdapterRun) => ProviderAdapterRun): ProviderAdapterRun {
    return this.mutate((fresh) => {
      const runs = [...fresh.runs];
      const index = runs.findIndex((item) => item.id === id);
      if (index < 0) throw new Error(`Provider adapter run not found: ${id}`);
      const next = sanitizeRun(update(clone(runs[index])));
      runs[index] = clone(next);
      return { state: { ...fresh, runs }, result: next };
    });
  }

  upsertRevision(revision: ProviderAdapterRevision): ProviderAdapterRevision {
    return this.mutate((fresh) => {
      const revisions = [...fresh.revisions];
      const index = revisions.findIndex((item) => item.id === revision.id);
      if (index >= 0) revisions[index] = clone(revision);
      else revisions.push(clone(revision));
      return { state: { ...fresh, revisions }, result: revision };
    });
  }

  getRevision(id: string): ProviderAdapterRevision | undefined {
    const found = this.refresh().revisions.find((revision) => revision.id === id);
    return found ? clone(found) : undefined;
  }

  deleteRevision(id: string): void {
    this.mutate((fresh) => ({
      state: { ...fresh, revisions: fresh.revisions.filter((revision) => revision.id !== id) },
      result: undefined,
    }));
  }

  /** Remove durable verification projections when their catalog connection is gone. */
  deleteRunsForVendors(vendorKeys: ReadonlySet<string>): void {
    if (vendorKeys.size === 0) return;
    this.mutate((fresh) => ({
      state: {
        ...fresh,
        runs: fresh.runs.filter((run) => !vendorKeys.has(run.vendorKey)),
        revisions: fresh.revisions.filter((revision) => !vendorKeys.has(revision.vendorKey)),
      },
      result: undefined,
    }));
  }

  finalizePromotion(input: {
    runId: string;
    expectedActiveRevision?: string;
    revision: ProviderAdapterRevision;
    verifiedModes: ProviderAdapterRevision["verifiedModes"];
    terminalStage: PromotionTerminalStage;
    finalizedAt: string;
  }): ProviderAdapterRun {
    return this.mutate((fresh) => {
      const runs = [...fresh.runs];
      const revisions = [...fresh.revisions];
      const runIndex = runs.findIndex((run) => run.id === input.runId);
      if (runIndex < 0) throw new Error(`Provider adapter run not found: ${input.runId}`);
      const current = runs[runIndex];
      if (current.activeRevision === input.revision.id && isTerminalAdapterStage(current.stage)) return { state: fresh, result: current };
      if (current.activeRevision !== input.expectedActiveRevision) throw new Error("Provider adapter promotion revision conflict");
      const finalized = sanitizeRun({ ...current, stage: input.terminalStage, currentModelKey: undefined,
        completedCount: current.totalCount ?? current.selectedModelKeys.length, activeRevision: input.revision.id,
        recovery: undefined, stageStartedAt: input.finalizedAt, lastProgressAt: input.finalizedAt, updatedAt: input.finalizedAt });
      runs[runIndex] = finalized;
      const revision = { ...input.revision, verifiedModes: input.verifiedModes };
      const revisionIndex = revisions.findIndex((item) => item.id === revision.id);
      if (revisionIndex >= 0) revisions[revisionIndex] = revision;
      else revisions.push(revision);
      return { state: { ...fresh, runs, revisions }, result: finalized };
    });
  }

  markStaleIfConnectionChanged(id: string, currentFingerprint: string): ProviderAdapterRun | undefined {
    const run = this.getRun(id);
    if (!run || isTerminalAdapterStage(run.stage) || run.connectionFingerprint === currentFingerprint) return run;
    return this.updateRun(id, (current) => ({
      ...current,
      stage: "stale",
      error: "Provider connection changed before verification completed",
      updatedAt: new Date().toISOString(),
    }));
  }

  private mutate<T>(update: (fresh: ProviderAdapterStoreState) => { state: ProviderAdapterStoreState; result: T }): T {
    const deadline = Date.now() + 3_000;
    const spin = new Int32Array(new SharedArrayBuffer(4));
    let lease: ReturnType<ProductionRunLock["acquire"]> | undefined;
    while (!lease) {
      try { lease = this.lock.acquire(); } catch (error) {
        if (!(error instanceof ProductionRunLockBusyError)) throw error;
        if (Date.now() >= deadline) throw Object.assign(new Error("Provider adapter store lock timed out"), { cause: error });
        Atomics.wait(spin, 0, 0, 10);
      }
    }
    try {
      const fresh = loadState(this.filePath);
      const mutation = update(clone(fresh));
      this.lock.assertOwned(lease);
      if (loadState(this.filePath).revision !== fresh.revision) throw new Error("Provider adapter store revision conflict");
      const next = { ...mutation.state, version: 1 as const, revision: fresh.revision + 1 };
      writeJsonFileAtomic(this.filePath, next);
      this.state = clone(next);
      return clone(mutation.result);
    } finally {
      try { this.lock.release(lease); } catch { /* preserve mutation result */ }
    }
  }

  private refresh(): ProviderAdapterStoreState {
    this.state = loadState(this.filePath);
    return this.state;
  }
}

/**
 * Catalog mutations own connection deletion, while adapter runs live in their
 * own durable file. Keep the cleanup at that shared boundary without creating
 * a catalog→service cycle; absent stores are left absent.
 */
export function invalidateProviderAdapterRunsForVendors(vendorKeys: ReadonlySet<string>): void {
  if (vendorKeys.size === 0) return;
  const filePath = providerAdapterStorePath();
  if (!fs.existsSync(filePath)) return;
  new ProviderAdapterStore(filePath).deleteRunsForVendors(vendorKeys);
}

export function recoverableAdapterRuns(runs: readonly ProviderAdapterRun[]): ProviderAdapterRun[] {
  return runs.filter((run) => !isTerminalAdapterStage(run.stage)).map(clone);
}

export function connectionFingerprint(input: {
  baseUrl: string;
  authType: string;
  apiKey: string;
  selectedModelKeys: readonly string[];
  headers?: Record<string, string>;
  proxyUrl?: string;
}): string {
  const normalized = {
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
    authType: input.authType,
    keyDigest: crypto.createHash("sha256").update(input.apiKey).digest("hex"),
    selectedModelKeys: [...input.selectedModelKeys].sort(),
    headers: Object.fromEntries(Object.entries(input.headers || {}).sort(([a], [b]) => a.localeCompare(b))),
    proxyUrl: input.proxyUrl || "",
  };
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
