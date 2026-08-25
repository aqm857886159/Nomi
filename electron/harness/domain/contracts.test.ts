import { describe, expect, expectTypeOf, it } from "vitest";
import {
  assertApprovalDecision,
  assertEventEnvelope,
  assertItem,
  assertPolicyDecision,
  assertThread,
  assertTurn,
  mintCauseId,
  mintProposalId,
  mintRunId,
  mintTxnId,
  type ApprovalDecision,
  type EventId,
  type EventEnvelope,
  type Item,
  type PolicyDecision,
  type Thread,
  type Turn,
} from "./contracts";

const ids = {
  threadId: "thread_01",
  turnId: "turn_01",
  itemId: "item_01",
  eventId: "evt_01",
  projectId: "project_01",
  timestamp: "2026-08-26T00:00:00.000Z",
};

const thread: Thread = {
  threadId: ids.threadId,
  projectId: ids.projectId,
  sessionKey: "nomi:workbench:project_01",
  status: "active",
  createdAt: ids.timestamp,
  updatedAt: ids.timestamp,
  lastEventSeq: 1,
};

const turn: Turn = {
  turnId: ids.turnId,
  threadId: ids.threadId,
  mode: "single-shot",
  status: "started",
  startedAt: ids.timestamp,
};

const item: Item = {
  itemId: ids.itemId,
  turnId: ids.turnId,
  kind: "tool",
  status: "started",
  toolCallId: "call_01",
};

const approval: ApprovalDecision = {
  decisionId: "decision_01",
  challengeId: "challenge_01",
  outcome: "allow",
  scope: "paid",
  frozenFields: { model: "model-a", amount: 1 },
  decidedAt: ids.timestamp,
  actor: "user",
  surface: "nomi-ipc",
};

const policy: PolicyDecision = {
  decisionId: "policy_01",
  capability: "generation",
  action: "project_write",
  outcome: "ask",
  reasonCode: "requires_confirmation",
  capabilitySnapshotHash: "sha256:abc",
  phase: "creative",
  scope: "project",
  evaluatedAt: ids.timestamp,
};

const envelope: EventEnvelope = {
  v: 2,
  id: ids.eventId,
  eventId: ids.eventId as EventId,
  seq: 1,
  ts: ids.timestamp,
  occurredAt: ids.timestamp,
  source: "agent",
  streamKind: "observation",
  projectId: ids.projectId,
  type: "agent.tool.proposed",
  payload: { toolCallId: "call_01" },
  warnings: [],
};

describe("B4-0 domain contracts", () => {
  it("keeps Thread/Turn/Item as Nomi-owned unions", () => {
    expectTypeOf(thread.status).toEqualTypeOf<"active" | "closed">();
    expectTypeOf(turn.status).toEqualTypeOf<"started" | "waiting" | "completed" | "failed" | "stopped">();
    expectTypeOf(item.kind).toEqualTypeOf<"text" | "tool" | "progress" | "approval" | "artifact" | "failure" | "receipt">();
    expect(assertThread(thread)).toBeUndefined();
    expect(assertTurn(turn)).toBeUndefined();
    expect(assertItem(item)).toBeUndefined();
  });

  it("rejects illegal discriminants and impossible approval outcomes at runtime", () => {
    expect(() => assertThread({ ...thread, status: "waiting" })).toThrow(/Thread/);
    expect(() => assertTurn({ ...turn, status: "completed", endedAt: undefined })).toThrow(/endedAt/);
    expect(() => assertItem({ ...item, status: "delta", kind: "approval" })).toThrow(/approval/);
    expect(() => assertApprovalDecision({ ...approval, outcome: "allow", actor: "system", surface: "mcp-elicitation", decidedAt: "" })).toThrow(
      /decidedAt/,
    );
    expect(() => assertPolicyDecision({ ...policy, outcome: "unknown" })).toThrow(/PolicyDecision/);
    expect(() => assertEventEnvelope({ ...envelope, streamKind: "other" })).toThrow(/streamKind/);
  });

  it("accepts the same approval semantics when projected to IPC or MCP", () => {
    expect(() => assertApprovalDecision({ ...approval, surface: "nomi-ipc" })).not.toThrow();
    expect(() => assertApprovalDecision({ ...approval, surface: "mcp-elicitation" })).not.toThrow();
    expect(() => assertApprovalDecision({ ...approval, surface: "notification" })).not.toThrow();
  });

  it("mints typed keys with stable prefixes and never lets UI choose causeId", () => {
    expect(mintRunId("run-seed")).toBe("run-run-seed");
    expect(mintTxnId("txn-seed")).toBe("txn_txn-seed");
    expect(mintProposalId("proposal-seed")).toBe("proposal_proposal-seed");
    expect(mintCauseId(ids.eventId)).toBe(ids.eventId);
    expect(() => mintCauseId("not-an-event")).toThrow(/causeId/);
  });
});
