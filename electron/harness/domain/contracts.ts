/**
 * B4-0 domain contract.
 *
 * This module deliberately has no Electron, UI, SDK, filesystem, or runtime
 * imports.  It is the Nomi-owned semantic boundary; wire adapters belong
 * outside this directory.
 */

export const LATEST_EVENT_VERSION = 2 as const;

type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type EventId = Brand<string, "EventId">;
export type RunId = Brand<string, "RunId">;
export type CauseId = Brand<string, "CauseId">;
export type TxnId = Brand<string, "TxnId">;
export type ProposalId = Brand<string, "ProposalId">;

/** Optional propagation bundle carried by observations; each key has one owner. */
export type CorrelationKeys = Readonly<{
  runId?: RunId;
  causeId?: CauseId;
  txnId?: TxnId;
  proposalId?: ProposalId;
}>;

export type ThreadId = string;
export type TurnId = string;
export type ItemId = string;

export type NomiEventSource = "user" | "agent" | "runtime" | "system";
export type StreamKind = "observation" | "correlation";
export type ThreadStatus = "active" | "closed";
export type TurnMode = "single-shot" | "multi-turn";
export type TurnStatus = "started" | "waiting" | "completed" | "failed" | "stopped";
export type ItemKind = "text" | "tool" | "progress" | "approval" | "artifact" | "failure" | "receipt";
export type ItemStatus = "started" | "delta" | "completed" | "waiting" | "failed" | "stopped";

export type Thread = {
  threadId: ThreadId;
  projectId: string;
  sessionKey: string;
  status: ThreadStatus;
  createdAt: string;
  updatedAt: string;
  lastEventSeq: number;
};

export type Turn = {
  turnId: TurnId;
  threadId: ThreadId;
  runId?: RunId;
  mode: TurnMode;
  status: TurnStatus;
  startedAt: string;
  endedAt?: string;
  modelRef?: string;
  causeId?: CauseId;
};

export type Item = {
  itemId: ItemId;
  turnId: TurnId;
  kind: ItemKind;
  status: ItemStatus;
  payloadRef?: string;
  toolCallId?: string;
  proposalId?: ProposalId;
  txnId?: TxnId;
  runId?: RunId;
  causeId?: CauseId;
};

export type ApprovalOutcome = "allow" | "deny" | "expired" | "cancelled";
export type ApprovalScope = "read" | "project_write" | "paid" | "anchor" | "export";
export type ApprovalActor = "user" | "system";
export type ApprovalSurface = "nomi-ipc" | "mcp-elicitation" | "notification";

export type ApprovalDecision = {
  decisionId: string;
  challengeId: string;
  proposalId?: ProposalId;
  runId?: RunId;
  txnId?: TxnId;
  outcome: ApprovalOutcome;
  scope: ApprovalScope;
  planHash?: string;
  frozenFields: Readonly<Record<string, unknown>>;
  maxSpend?: number;
  currency?: string;
  expiresAt?: string;
  decidedAt: string;
  actor: ApprovalActor;
  surface: ApprovalSurface;
  reasonCode?: string;
};

export type PolicyOutcome = "deny" | "ask" | "allow";
export type PolicyAction = "read" | "project_write" | "paid" | "anchor" | "export";
export type PolicyPhase = "creative" | "production" | "review" | "export";
export type PolicyScope = "session" | "project" | "run" | "item";

export type PolicyDecision = {
  decisionId: string;
  capability: string;
  action: PolicyAction;
  outcome: PolicyOutcome;
  reasonCode: string;
  capabilitySnapshotHash: string;
  phase: PolicyPhase;
  scope: PolicyScope;
  estimatedSpend?: number;
  evaluatedAt: string;
  runId?: RunId;
  proposalId?: ProposalId;
};

export type EventEnvelope = {
  v: typeof LATEST_EVENT_VERSION;
  /** Kept for JSONL compatibility; eventId is the canonical domain spelling. */
  id: string;
  eventId: EventId;
  seq: number;
  /** Kept for JSONL compatibility; occurredAt is the canonical domain spelling. */
  ts: string;
  occurredAt: string;
  source: NomiEventSource;
  causeId?: CauseId;
  txnId?: TxnId;
  proposalId?: ProposalId;
  type: string;
  payload: Readonly<Record<string, unknown>>;
  streamKind: StreamKind;
  projectId?: string;
  threadId?: ThreadId;
  turnId?: TurnId;
  itemId?: ItemId;
  runId?: RunId;
  /** Upcast diagnostics are metadata, never a second source of truth. */
  warnings: readonly { code: string; message: string }[];
  /** Unknown event types remain opaque instead of being silently discarded. */
  itemKind?: "opaque";
};

export class ContractValidationError extends Error {
  readonly issues: readonly string[];

  constructor(contract: string, issues: readonly string[]) {
    super(`${contract} contract violation: ${issues.join(", ")}`);
    this.name = "ContractValidationError";
    this.issues = issues;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isTimestamp = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const oneOf = <T extends string>(value: unknown, values: readonly T[]): value is T => typeof value === "string" && values.includes(value as T);

function fail(contract: string, issues: string[]): never {
  throw new ContractValidationError(contract, issues);
}

export function assertThread(value: unknown): asserts value is Thread {
  if (!isRecord(value)) fail("Thread", ["value must be an object"]);
  const issues: string[] = [];
  if (!isNonEmptyString(value.threadId)) issues.push("threadId");
  if (!isNonEmptyString(value.projectId)) issues.push("projectId");
  if (!isNonEmptyString(value.sessionKey)) issues.push("sessionKey");
  if (!oneOf(value.status, ["active", "closed"] as const)) issues.push("status");
  if (!isTimestamp(value.createdAt)) issues.push("createdAt");
  if (!isTimestamp(value.updatedAt)) issues.push("updatedAt");
  if (!Number.isInteger(value.lastEventSeq) || (value.lastEventSeq as number) < 0) issues.push("lastEventSeq");
  if (issues.length) fail("Thread", issues);
}

export function assertTurn(value: unknown): asserts value is Turn {
  if (!isRecord(value)) fail("Turn", ["value must be an object"]);
  const issues: string[] = [];
  if (!isNonEmptyString(value.turnId)) issues.push("turnId");
  if (!isNonEmptyString(value.threadId)) issues.push("threadId");
  if (value.runId !== undefined && !isRunId(value.runId)) issues.push("runId");
  if (!oneOf(value.mode, ["single-shot", "multi-turn"] as const)) issues.push("mode");
  if (!oneOf(value.status, ["started", "waiting", "completed", "failed", "stopped"] as const)) issues.push("status");
  if (!isTimestamp(value.startedAt)) issues.push("startedAt");
  if (value.endedAt !== undefined && !isTimestamp(value.endedAt)) issues.push("endedAt");
  if (["completed", "failed", "stopped"].includes(value.status as string) && !isTimestamp(value.endedAt)) issues.push("endedAt");
  if (value.causeId !== undefined && !isCauseId(value.causeId)) issues.push("causeId");
  if (issues.length) fail("Turn", issues);
}

export function assertItem(value: unknown): asserts value is Item {
  if (!isRecord(value)) fail("Item", ["value must be an object"]);
  const issues: string[] = [];
  if (!isNonEmptyString(value.itemId)) issues.push("itemId");
  if (!isNonEmptyString(value.turnId)) issues.push("turnId");
  if (!oneOf(value.kind, ["text", "tool", "progress", "approval", "artifact", "failure", "receipt"] as const)) issues.push("kind");
  if (!oneOf(value.status, ["started", "delta", "completed", "waiting", "failed", "stopped"] as const)) issues.push("status");
  if (value.kind === "approval" && value.status === "delta") issues.push("approval items cannot be delta");
  for (const [key, predicate] of [
    ["proposalId", isProposalId],
    ["txnId", isTxnId],
    ["runId", isRunId],
    ["causeId", isCauseId],
  ] as const) {
    if (value[key] !== undefined && !predicate(value[key])) issues.push(key);
  }
  if (issues.length) fail("Item", issues);
}

export function assertApprovalDecision(value: unknown): asserts value is ApprovalDecision {
  if (!isRecord(value)) fail("ApprovalDecision", ["value must be an object"]);
  const issues: string[] = [];
  for (const key of ["decisionId", "challengeId", "decidedAt"] as const) if (!isNonEmptyString(value[key])) issues.push(key);
  if (!oneOf(value.outcome, ["allow", "deny", "expired", "cancelled"] as const)) issues.push("outcome");
  if (!oneOf(value.scope, ["read", "project_write", "paid", "anchor", "export"] as const)) issues.push("scope");
  if (!isRecord(value.frozenFields)) issues.push("frozenFields");
  if (value.maxSpend !== undefined && (typeof value.maxSpend !== "number" || value.maxSpend < 0 || !Number.isFinite(value.maxSpend))) issues.push("maxSpend");
  if (value.currency !== undefined && !isNonEmptyString(value.currency)) issues.push("currency");
  if (value.expiresAt !== undefined && !isTimestamp(value.expiresAt)) issues.push("expiresAt");
  if (!oneOf(value.actor, ["user", "system"] as const)) issues.push("actor");
  if (!oneOf(value.surface, ["nomi-ipc", "mcp-elicitation", "notification"] as const)) issues.push("surface");
  for (const [key, predicate] of [["proposalId", isProposalId], ["runId", isRunId], ["txnId", isTxnId]] as const) {
    if (value[key] !== undefined && !predicate(value[key])) issues.push(key);
  }
  if (!isTimestamp(value.decidedAt)) issues.push("decidedAt");
  if (issues.length) fail("ApprovalDecision", issues);
}

export function assertPolicyDecision(value: unknown): asserts value is PolicyDecision {
  if (!isRecord(value)) fail("PolicyDecision", ["value must be an object"]);
  const issues: string[] = [];
  for (const key of ["decisionId", "capability", "reasonCode", "capabilitySnapshotHash"] as const) if (!isNonEmptyString(value[key])) issues.push(key);
  if (!oneOf(value.action, ["read", "project_write", "paid", "anchor", "export"] as const)) issues.push("action");
  if (!oneOf(value.outcome, ["deny", "ask", "allow"] as const)) issues.push("outcome");
  if (!oneOf(value.phase, ["creative", "production", "review", "export"] as const)) issues.push("phase");
  if (!oneOf(value.scope, ["session", "project", "run", "item"] as const)) issues.push("scope");
  if (!isTimestamp(value.evaluatedAt)) issues.push("evaluatedAt");
  if (value.estimatedSpend !== undefined && (typeof value.estimatedSpend !== "number" || value.estimatedSpend < 0 || !Number.isFinite(value.estimatedSpend))) issues.push("estimatedSpend");
  for (const [key, predicate] of [["proposalId", isProposalId], ["runId", isRunId]] as const) {
    if (value[key] !== undefined && !predicate(value[key])) issues.push(key);
  }
  if (issues.length) fail("PolicyDecision", issues);
}

export function assertEventEnvelope(value: unknown): asserts value is EventEnvelope {
  if (!isRecord(value)) fail("EventEnvelope", ["value must be an object"]);
  const issues: string[] = [];
  if (value.v !== LATEST_EVENT_VERSION) issues.push("v");
  if (!isNonEmptyString(value.id) || !isEventId(value.id)) issues.push("id");
  if (!isEventId(value.eventId)) issues.push("eventId");
  if (!Number.isInteger(value.seq) || (value.seq as number) < 1) issues.push("seq");
  if (!isTimestamp(value.ts) || !isTimestamp(value.occurredAt)) issues.push("timestamp");
  if (!oneOf(value.source, ["user", "agent", "runtime", "system"] as const)) issues.push("source");
  if (!oneOf(value.streamKind, ["observation", "correlation"] as const)) issues.push("streamKind");
  if (!isNonEmptyString(value.type)) issues.push("type");
  if (!isRecord(value.payload)) issues.push("payload");
  if (value.projectId !== undefined && !isNonEmptyString(value.projectId)) issues.push("projectId");
  for (const [key, predicate] of [["causeId", isCauseId], ["txnId", isTxnId], ["proposalId", isProposalId], ["runId", isRunId]] as const) {
    if (value[key] !== undefined && !predicate(value[key])) issues.push(key);
  }
  if (issues.length) fail("EventEnvelope", issues);
}

export const isThread = (value: unknown): value is Thread => {
  try { assertThread(value); return true; } catch { return false; }
};
export const isTurn = (value: unknown): value is Turn => {
  try { assertTurn(value); return true; } catch { return false; }
};
export const isItem = (value: unknown): value is Item => {
  try { assertItem(value); return true; } catch { return false; }
};
export const isApprovalDecision = (value: unknown): value is ApprovalDecision => {
  try { assertApprovalDecision(value); return true; } catch { return false; }
};
export const isPolicyDecision = (value: unknown): value is PolicyDecision => {
  try { assertPolicyDecision(value); return true; } catch { return false; }
};
export const isEventEnvelope = (value: unknown): value is EventEnvelope => {
  try { assertEventEnvelope(value); return true; } catch { return false; }
};

const ID_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const EVENT_ID = /^evt_[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const safeId = (value: unknown): value is string => typeof value === "string" && ID_TOKEN.test(value);
export const isEventId = (value: unknown): value is EventId => typeof value === "string" && EVENT_ID.test(value);
// Existing ProductionRun IDs include run-* and op-* operation IDs; the
// contract intentionally brands them without rewriting historical values.
export const isRunId = (value: unknown): value is RunId => safeId(value) && /^(?:run[-_]|op[-_])/i.test(value);
export const isTxnId = (value: unknown): value is TxnId => safeId(value) && /^(?:txn[-_])/i.test(value);
// Proposal IDs predate B4 and include both prop_* and opaque short IDs.
export const isProposalId = (value: unknown): value is ProposalId => safeId(value);
export const isCauseId = (value: unknown): value is CauseId => isEventId(value);

function mint(prefix: string, seed: string): string {
  const value = seed.trim();
  if (!ID_TOKEN.test(value)) throw new ContractValidationError(`${prefix}Id`, ["seed must be a bounded identifier token"]);
  return `${prefix}_${value}`;
}

/** The caller supplies entropy; domain code only applies the canonical prefix and validation. */
export const mintRunId = (seed: string): RunId => `run-${mint("run", seed).slice("run_".length)}` as RunId;
export const mintTxnId = (seed: string): TxnId => mint("txn", seed) as TxnId;
export const mintProposalId = (seed: string): ProposalId => mint("proposal", seed) as ProposalId;
/** causeId is always the immediate parent's event id; it is never UI-generated. */
export function mintCauseId(parentEventId: string): CauseId {
  if (!isEventId(parentEventId)) throw new ContractValidationError("causeId", ["must reference an event id"]);
  return parentEventId as unknown as CauseId;
}
