import fs from "node:fs";

import { writeJsonFileAtomic } from "../jsonFile";

export const RUNTIME_ENVELOPE_SCHEMA_VERSION = 1 as const;
export type RuntimeEnvelopeState = "sealed" | "provider_accepted" | "submitted_unknown" | "materialized";

export type ProductionRunRuntimeEnvelope = {
  schemaVersion: typeof RUNTIME_ENVELOPE_SCHEMA_VERSION;
  runId: string;
  jobId: string;
  runtimeTaskId: string;
  contractHash: string;
  providerIdempotencyKey: string;
  requestFingerprint: string;
  request: unknown;
  state: RuntimeEnvelopeState;
  providerTaskId?: string;
  rawReceipt?: unknown;
  lastPoll?: {
    status: string;
    raw?: unknown;
    observedAt: string;
  };
  updatedAt: string;
};

export type RuntimeEnvelopeSealInput = Omit<ProductionRunRuntimeEnvelope, "schemaVersion" | "state" | "updatedAt" | "providerTaskId" | "rawReceipt">;

export class RuntimeEnvelopeConflictError extends Error {
  readonly code = "runtime_envelope_conflict" as const;

  constructor(message: string) {
    super(message);
    this.name = "RuntimeEnvelopeConflictError";
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RuntimeEnvelopeConflictError("Runtime request contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  throw new RuntimeEnvelopeConflictError("Runtime request is not JSON serializable");
}

function sameSemanticInput(left: RuntimeEnvelopeSealInput, right: ProductionRunRuntimeEnvelope): boolean {
  return left.runId === right.runId
    && left.jobId === right.jobId
    && left.runtimeTaskId === right.runtimeTaskId
    && left.contractHash === right.contractHash
    && left.providerIdempotencyKey === right.providerIdempotencyKey
    && left.requestFingerprint === right.requestFingerprint
    && canonicalJson(left.request) === canonicalJson(right.request);
}

export function createProductionRunRuntimeEnvelope(deps: { filePath: string; now?: () => string }) {
  const now = deps.now ?? (() => new Date().toISOString());

  function read(): ProductionRunRuntimeEnvelope | null {
    if (!fs.existsSync(deps.filePath)) return null;
    try {
      const value = JSON.parse(fs.readFileSync(deps.filePath, "utf8")) as ProductionRunRuntimeEnvelope;
      if (value.schemaVersion !== RUNTIME_ENVELOPE_SCHEMA_VERSION || !value.runId || !value.jobId || !value.contractHash || !value.state) throw new Error("invalid runtime envelope");
      return value;
    } catch (error) {
      throw new RuntimeEnvelopeConflictError(`Runtime envelope is corrupt: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function seal(input: RuntimeEnvelopeSealInput): ProductionRunRuntimeEnvelope {
    const current = read();
    if (current) {
      if (!sameSemanticInput(input, current)) throw new RuntimeEnvelopeConflictError("A different contract is already sealed for this Run/Job");
      return current;
    }
    const envelope: ProductionRunRuntimeEnvelope = {
      ...structuredClone(input),
      schemaVersion: RUNTIME_ENVELOPE_SCHEMA_VERSION,
      state: "sealed",
      updatedAt: now(),
    };
    writeJsonFileAtomic(deps.filePath, envelope);
    return envelope;
  }

  function markProviderAccepted(input: { providerTaskId: string; rawReceipt?: unknown }): ProductionRunRuntimeEnvelope {
    const current = read();
    if (!current) throw new RuntimeEnvelopeConflictError("Cannot accept a provider task before sealing the runtime envelope");
    const providerTaskId = input.providerTaskId.trim();
    if (!providerTaskId) throw new RuntimeEnvelopeConflictError("Provider task id is required before polling");
    const next: ProductionRunRuntimeEnvelope = {
      ...current,
      state: "provider_accepted",
      providerTaskId,
      ...(input.rawReceipt === undefined ? {} : { rawReceipt: structuredClone(input.rawReceipt) }),
      updatedAt: now(),
    };
    writeJsonFileAtomic(deps.filePath, next);
    return next;
  }

  function markSubmittedUnknown(): ProductionRunRuntimeEnvelope {
    const current = read();
    if (!current) throw new RuntimeEnvelopeConflictError("Cannot mark an unsealed runtime envelope unknown");
    const next = { ...current, state: "submitted_unknown" as const, updatedAt: now() };
    writeJsonFileAtomic(deps.filePath, next);
    return next;
  }

  function markPolled(input: { status: string; raw?: unknown }): ProductionRunRuntimeEnvelope {
    const current = read();
    if (!current || !current.providerTaskId || current.state !== "provider_accepted") {
      throw new RuntimeEnvelopeConflictError("Provider acceptance is required before recording a poll");
    }
    const status = input.status.trim();
    if (!status) throw new RuntimeEnvelopeConflictError("Provider poll status is required");
    const observedAt = now();
    const next: ProductionRunRuntimeEnvelope = {
      ...current,
      lastPoll: {
        status,
        ...(input.raw === undefined ? {} : { raw: structuredClone(input.raw) }),
        observedAt,
      },
      updatedAt: observedAt,
    };
    writeJsonFileAtomic(deps.filePath, next);
    return next;
  }

  function markMaterialized(): ProductionRunRuntimeEnvelope {
    const current = read();
    if (!current || current.state !== "provider_accepted" || !current.providerTaskId) throw new RuntimeEnvelopeConflictError("Provider acceptance is required before materialization");
    const next = { ...current, state: "materialized" as const, updatedAt: now() };
    writeJsonFileAtomic(deps.filePath, next);
    return next;
  }

  return { read, seal, markProviderAccepted, markPolled, markSubmittedUnknown, markMaterialized };
}

export type ProductionRunRuntimeEnvelopeStore = ReturnType<typeof createProductionRunRuntimeEnvelope>;
