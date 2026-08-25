import {
  assertEventEnvelope,
  isRunId,
  type EventEnvelope,
  type EventId,
  type NomiEventSource,
  type RunId,
} from "./contracts";

/** v1 is the on-disk shape currently emitted by electron/events. */
export type LegacyEventEnvelope = {
  v: 1;
  id: string;
  seq: number;
  ts: string;
  source: NomiEventSource;
  causeId?: string;
  txnId?: string;
  proposalId?: string;
  type: string;
  payload: Record<string, unknown>;
  [key: string]: unknown;
};

export type UpcastWarningCode = "runId.missing" | "runId.unavailable" | "runId.invalid" | "runId.unregistered";
export type UpcastWarning = { code: UpcastWarningCode; message: string };
export type LegacyRunIdExtraction =
  | { status: "present"; runId: RunId }
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "unregistered" };

/**
 * These are the only current observation event types whose v1 payload
 * contract declares runId. Every other old event is explicitly “absent”, and
 * an unknown future type is “unregistered”; neither case is guessed.
 */
export const LEGACY_RUN_ID_EVENT_TYPES = [
  "vendor.call.requested",
  "vendor.call.cached",
  "vendor.call.completed",
] as const;

const KNOWN_OBSERVATION_TYPES = new Set<string>([
  "agent.turn.started",
  "agent.turn.finished",
  "agent.tool.proposed",
  "agent.tool.completed",
  "agent.proposal.approved",
  "agent.proposal.rejected",
  "agent.turn.error",
  "agent.gate.denied",
  "agent.txn.committed",
  "agent.txn.aborted",
  "agent.txn.reverted",
  "context.capped",
  "memory.fact.added",
  "memory.fact.corrected",
  "memory.fact.removed",
  "memory.fact.user-added",
  "review.technical.completed",
  ...LEGACY_RUN_ID_EVENT_TYPES,
]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isLegacy = (value: unknown): value is LegacyEventEnvelope => {
  if (!isRecord(value) || value.v !== 1) return false;
  return typeof value.id === "string" && Number.isInteger(value.seq) && typeof value.ts === "string" && typeof value.source === "string" && typeof value.type === "string" && isRecord(value.payload);
};

export function extractLegacyRunId(type: string, payload: Record<string, unknown>): LegacyRunIdExtraction {
  if (!LEGACY_RUN_ID_EVENT_TYPES.includes(type as (typeof LEGACY_RUN_ID_EVENT_TYPES)[number])) {
    return KNOWN_OBSERVATION_TYPES.has(type) ? { status: "absent" } : { status: "unregistered" };
  }
  if (!Object.prototype.hasOwnProperty.call(payload, "runId") || payload.runId === undefined || payload.runId === null || payload.runId === "") return { status: "absent" };
  return isRunId(payload.runId) ? { status: "present", runId: payload.runId } : { status: "invalid" };
}

function warningFor(type: string, extraction: LegacyRunIdExtraction): UpcastWarning | undefined {
  if (extraction.status === "present") return undefined;
  if (extraction.status === "absent") {
    return LEGACY_RUN_ID_EVENT_TYPES.includes(type as (typeof LEGACY_RUN_ID_EVENT_TYPES)[number])
      ? { code: "runId.missing", message: `${type} declares runId but the v1 payload does not contain one` }
      : { code: "runId.unavailable", message: `${type} has no registered structured runId field; the key remains empty` };
  }
  if (extraction.status === "invalid") return { code: "runId.invalid", message: `${type} contains a non-contract runId; it was not promoted to the envelope` };
  return { code: "runId.unregistered", message: `${type} is not registered for runId extraction; payload fields were not guessed` };
}

function requireLegacy(value: unknown): LegacyEventEnvelope {
  if (!isLegacy(value)) throw new TypeError("Invalid legacy event envelope: expected v1 id/seq/ts/source/type/payload");
  return value;
}

/** Pure in-memory v1 -> v2 adapter. It never writes or mutates the input. */
export function upcastEventEnvelope(value: unknown, context: { projectId?: string } = {}): EventEnvelope {
  if (isRecord(value) && value.v === 2) {
    assertEventEnvelope(value);
    return value;
  }
  const legacy = requireLegacy(value);
  const extraction = extractLegacyRunId(legacy.type, legacy.payload);
  const warning = warningFor(legacy.type, extraction);
  const warnings = warning ? [warning] : [];
  const result = {
    ...legacy,
    v: 2 as const,
    id: legacy.id,
    eventId: legacy.id as EventId,
    occurredAt: legacy.ts,
    streamKind: "observation" as const,
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(legacy.causeId ? { causeId: legacy.causeId } : {}),
    ...(legacy.txnId ? { txnId: legacy.txnId } : {}),
    ...(legacy.proposalId ? { proposalId: legacy.proposalId } : {}),
    ...(extraction.status === "present" ? { runId: extraction.runId } : {}),
    ...(warnings.length ? { warnings } : { warnings: [] }),
    ...(KNOWN_OBSERVATION_TYPES.has(legacy.type) ? {} : { itemKind: "opaque" as const }),
  } as EventEnvelope;
  assertEventEnvelope(result);
  return result;
}
