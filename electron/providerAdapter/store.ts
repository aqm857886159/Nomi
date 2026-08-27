import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonFileAtomic } from "../jsonFile";
import { getSettingsRoot } from "../runtimePaths";
import type {
  AdapterModeResult,
  ProviderAdapterRevision,
  ProviderAdapterRun,
  ProviderAdapterStoreState,
} from "./types";

const EMPTY_STATE: ProviderAdapterStoreState = { version: 1, runs: [], revisions: [] };
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
  const evidence = asRecord(raw.mediaEvidence);
  const metadata = asRecord(evidence.metadata);
  const safeMetadata: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SAFE_METADATA_NUMBERS.has(key) && typeof value === "number" && Number.isFinite(value) && value >= 0) safeMetadata[key] = value;
    if ((key === "videoCodec" || key === "audioCodec") && typeof value === "string" && /^[A-Za-z0-9_.+-]{1,64}$/.test(value)) {
      safeMetadata[key] = value;
    }
  }
  const safeEvidence = typeof evidence.kind === "string"
    && ["image", "video", "audio", "model3d"].includes(evidence.kind)
    && typeof evidence.contentType === "string" && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(evidence.contentType)
    && typeof evidence.byteLength === "number" && Number.isSafeInteger(evidence.byteLength) && evidence.byteLength > 0
    && typeof evidence.sha256 === "string" && /^[a-f0-9]{64}$/.test(evidence.sha256)
    ? {
        kind: evidence.kind as "image" | "video" | "audio" | "model3d",
        contentType: evidence.contentType,
        byteLength: evidence.byteLength,
        sha256: evidence.sha256,
        metadata: safeMetadata,
      }
    : undefined;
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
    ...(safeEvidence ? { mediaEvidence: safeEvidence } : {}),
    ...(typeof raw.reasonCode === "string" && SAFE_REASON_CODES.has(raw.reasonCode) ? { reasonCode: raw.reasonCode as AdapterModeResult["reasonCode"] } : {}),
    ...(Object.keys(safeParams).length ? { errorParams: safeParams } : {}),
  };
}

function sanitizeRun(run: ProviderAdapterRun): ProviderAdapterRun {
  return {
    ...run,
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

  constructor(private readonly filePath = providerAdapterStorePath()) {
    this.state = loadState(filePath);
  }

  snapshot(): ProviderAdapterStoreState {
    return clone(this.state);
  }

  getRun(id: string): ProviderAdapterRun | undefined {
    const found = this.state.runs.find((run) => run.id === id);
    return found ? clone(found) : undefined;
  }

  latestRun(vendorKey: string): ProviderAdapterRun | undefined {
    const found = [...this.state.runs].reverse().find((run) => run.vendorKey === vendorKey);
    return found ? clone(found) : undefined;
  }

  listRuns(options: { vendorKey?: string; activeOnly?: boolean; limit?: number } = {}): ProviderAdapterRun[] {
    const limit = Math.max(1, Math.min(200, Math.trunc(options.limit || 50)));
    return this.state.runs
      .filter((run) => !options.vendorKey || run.vendorKey === options.vendorKey)
      .filter((run) => !options.activeOnly || !isTerminalAdapterStage(run.stage))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, limit)
      .map(clone);
  }

  upsertRun(run: ProviderAdapterRun): ProviderAdapterRun {
    const next = clone(sanitizeRun(run));
    const index = this.state.runs.findIndex((item) => item.id === run.id);
    if (index >= 0) this.state.runs[index] = next;
    else this.state.runs.push(next);
    this.persist();
    return clone(next);
  }

  updateRun(id: string, update: (current: ProviderAdapterRun) => ProviderAdapterRun): ProviderAdapterRun {
    const index = this.state.runs.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Provider adapter run not found: ${id}`);
    const next = sanitizeRun(update(clone(this.state.runs[index])));
    this.state.runs[index] = clone(next);
    this.persist();
    return clone(next);
  }

  upsertRevision(revision: ProviderAdapterRevision): ProviderAdapterRevision {
    const index = this.state.revisions.findIndex((item) => item.id === revision.id);
    if (index >= 0) this.state.revisions[index] = clone(revision);
    else this.state.revisions.push(clone(revision));
    this.persist();
    return clone(revision);
  }

  getRevision(id: string): ProviderAdapterRevision | undefined {
    const found = this.state.revisions.find((revision) => revision.id === id);
    return found ? clone(found) : undefined;
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

  private persist(): void {
    writeJsonFileAtomic(this.filePath, this.state);
  }
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
}): string {
  const normalized = {
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
    authType: input.authType,
    keyDigest: crypto.createHash("sha256").update(input.apiKey).digest("hex"),
    selectedModelKeys: [...input.selectedModelKeys].sort(),
    headers: Object.fromEntries(Object.entries(input.headers || {}).sort(([a], [b]) => a.localeCompare(b))),
  };
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
