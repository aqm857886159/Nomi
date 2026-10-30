import fs from "node:fs";

import { writeJsonFileAtomic } from "../jsonFile";
import { classifyUpstreamTaskStatus } from "../shared/taskStatus";
import { createProductionRunLock, ProductionRunLockBusyError, type ProductionRunLockLease } from "./productionRunLock";

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
    /** Durable observation order; legacy observations are revision zero. */
    revision?: number;
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

  const lifecycle = createProductionRunLock({ filePath: `${deps.filePath}.lifecycle-lock`, durability: "ephemeral" });
  const observationRevision = (value: ProductionRunRuntimeEnvelope) => value.lastPoll?.revision ?? 0;
  function superseded(current: ProductionRunRuntimeEnvelope, observed: ProductionRunRuntimeEnvelope): boolean {
    return current.state === "materialized" || observationRevision(current) !== observationRevision(observed);
  }
  function accepted(current: ProductionRunRuntimeEnvelope | null): ProductionRunRuntimeEnvelope {
    if (!current?.providerTaskId || !["provider_accepted", "materialized"].includes(current.state)) {
      throw new RuntimeEnvelopeConflictError("Provider acceptance is required before recording a poll");
    }
    return current;
  }
  // The existing filesystem lease is shared by independently-created Electron/stdio stores.
  // Same-pending observations return before entering here: no lock writes or heartbeat at idle.
  async function withLifecycle<T>(work: (assertOwned: () => void) => T | Promise<T>): Promise<T> {
    let lease: ProductionRunLockLease;
    for (;;) {
      try { lease = lifecycle.acquire(); break; }
      catch (error) {
        if (!(error instanceof ProductionRunLockBusyError)) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
    }
    let lost: unknown;
    const assertOwned = () => { if (lost) throw lost; lifecycle.assertOwned(lease); };
    const heartbeat = setInterval(() => { try { lease = lifecycle.renew(lease); } catch (error) { lost = error; } }, 10_000);
    heartbeat.unref();
    try { return await work(assertOwned); }
    finally { clearInterval(heartbeat); lifecycle.release(lease); }
  }

  async function markPolled(input: { observed: ProductionRunRuntimeEnvelope } & ({ status: string; raw?: unknown } | { error: unknown }), onChanged?: (next: ProductionRunRuntimeEnvelope) => void): Promise<ProductionRunRuntimeEnvelope> {
    function unchanged(current: ProductionRunRuntimeEnvelope): boolean {
      if (superseded(current, input.observed)) return true;
      if ("error" in input) throw input.error;
      const status = input.status.trim();
      if (!status) throw new RuntimeEnvelopeConflictError("Provider poll status is required");
      const cls = classifyUpstreamTaskStatus(status);
      return (cls === "queued" || cls === "running") && current.lastPoll?.status === status;
    }
    const current = accepted(read());
    if (unchanged(current)) return current;
    return withLifecycle((assertOwned) => {
      const latest = accepted(read());
      if (unchanged(latest)) return latest;
      if ("error" in input) throw input.error;
      const observedAt = now();
      const next: ProductionRunRuntimeEnvelope = { ...latest, lastPoll: { status: input.status.trim(),
        revision: observationRevision(latest) + 1,
        ...(input.raw === undefined ? {} : { raw: structuredClone(input.raw) }), observedAt }, updatedAt: observedAt };
      assertOwned();
      onChanged?.(next);
      writeJsonFileAtomic(deps.filePath, next);
      return next;
    });
  }

  async function withMaterialization<T>(observed: ProductionRunRuntimeEnvelope, work: (current: ProductionRunRuntimeEnvelope, complete: () => void, assertOwned: () => void) => Promise<T>): Promise<{ kind: "refresh" } | { kind: "result"; value: T }> {
    const latest = accepted(read());
    // Finished work is immutable: even the ephemeral ownership file is unnecessary.
    if (latest.state === "materialized") return { kind: "result", value: await work(latest, () => undefined, () => { throw new RuntimeEnvelopeConflictError("Materialized execution is immutable"); }) };
    if (superseded(latest, observed)) return { kind: "refresh" };
    return withLifecycle(async (assertOwned) => {
      const current = accepted(read());
      // Shared revalidation after the external extraction, before asset I/O or error handling.
      if (current.state !== "materialized" && superseded(current, observed)) return { kind: "refresh" };
      const complete = () => {
        assertOwned();
        const latest = accepted(read());
        if (latest.state === "materialized") return;
        if (classifyUpstreamTaskStatus(latest.lastPoll?.status ?? "") !== "succeeded") throw new RuntimeEnvelopeConflictError("Successful provider observation is required before materialization");
        writeJsonFileAtomic(deps.filePath, { ...latest, state: "materialized", updatedAt: now() });
      };
      return { kind: "result", value: await work(current, complete, assertOwned) };
    });
  }

  return { read, seal, markProviderAccepted, markPolled, markSubmittedUnknown, withMaterialization };
}

export type ProductionRunRuntimeEnvelopeStore = ReturnType<typeof createProductionRunRuntimeEnvelope>;
