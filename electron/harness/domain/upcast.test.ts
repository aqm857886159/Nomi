import { describe, expect, it } from "vitest";
import { extractLegacyRunId, upcastEventEnvelope, type UpcastWarningCode } from "./upcast";

const base = {
  v: 1,
  id: "evt_legacy_01",
  seq: 7,
  ts: "2026-08-26T00:00:00.000Z",
  source: "runtime",
  type: "vendor.call.completed",
};

describe("B4-0 event envelope upcast", () => {
  it("upcasts a real vendor event without rewriting its input", () => {
    const legacy = { ...base, payload: { runId: "run_legacy", status: "succeeded", assetCount: 1 } };
    const before = JSON.stringify(legacy);
    const result = upcastEventEnvelope(legacy, { projectId: "project_01" });
    expect(JSON.stringify(legacy)).toBe(before);
    expect(result).toMatchObject({
      v: 2,
      id: "evt_legacy_01",
      eventId: "evt_legacy_01",
      ts: base.ts,
      occurredAt: base.ts,
      streamKind: "observation",
      projectId: "project_01",
      runId: "run_legacy",
    });
    expect(result.payload).toEqual(legacy.payload);
  });

  it.each([
    ["agent.turn.started", { sessionId: "s1" }, "absent"],
    ["agent.tool.proposed", { toolCallId: "t1" }, "absent"],
    ["agent.tool.completed", { toolCallId: "t1", ok: true }, "absent"],
    ["agent.proposal.approved", { toolCallId: "t1" }, "absent"],
    ["agent.proposal.rejected", { toolCallId: "t1" }, "absent"],
    ["agent.turn.error", { sessionId: "s1" }, "absent"],
    ["agent.gate.denied", { toolCallId: "t1" }, "absent"],
    ["agent.txn.committed", { proposalId: "proposal_1" }, "absent"],
    ["agent.txn.aborted", { proposalId: "proposal_1" }, "absent"],
    ["agent.txn.reverted", { proposalId: "proposal_1" }, "absent"],
    ["context.capped", { sessionKey: "nomi:workbench:p1", droppedCount: 1, keptCount: 2 }, "absent"],
    ["memory.fact.added", { fact: { id: "f1" } }, "absent"],
    ["memory.fact.corrected", { factId: "f1", text: "x" }, "absent"],
    ["memory.fact.removed", { factId: "f1" }, "absent"],
    ["memory.fact.user-added", { text: "x" }, "absent"],
    ["review.technical.completed", { verdict: "ok" }, "absent"],
    ["vendor.call.requested", { runId: "run_1" }, "present"],
    ["vendor.call.cached", { runId: "run_1" }, "present"],
    ["vendor.call.completed", { runId: "run_1" }, "present"],
  ] as const)("records the runId conclusion for %s", (type, payload, expected) => {
    expect(extractLegacyRunId(type, payload).status).toBe(expected);
  });

  it("does not guess runId from an unregistered payload field", () => {
    const result = upcastEventEnvelope({ ...base, type: "unknown.future", payload: { runId: "maybe" } });
    expect(result.runId).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toContain("runId.unregistered");
  });

  it("emits an honest warning when a registered type cannot provide runId", () => {
    const result = upcastEventEnvelope({ ...base, payload: { status: "failed" } });
    expect(result.runId).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code as UpcastWarningCode)).toContain("runId.missing");
  });

  it("marks non-run event types as unavailable instead of silently treating them as linked", () => {
    const result = upcastEventEnvelope({ ...base, type: "agent.turn.started", payload: { sessionId: "s1" } });
    expect(result.runId).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toContain("runId.unavailable");
  });

  it("preserves unknown payloads, injects only known project context, and is idempotent", () => {
    const legacy = { ...base, type: "future.event", payload: { nested: { keep: true }, sidecarRef: "events/sidecar/7-payload.json" } };
    const once = upcastEventEnvelope(legacy);
    const twice = upcastEventEnvelope(once);
    expect(once).toEqual(twice);
    expect(once.projectId).toBeUndefined();
    expect(once.payload).toEqual(legacy.payload);
    expect(once.itemKind).toBe("opaque");
  });

  it("rejects malformed legacy input instead of inventing required fields", () => {
    expect(() => upcastEventEnvelope({ v: 1, id: "evt_bad", payload: {} })).toThrow(/seq|ts|source|type/);
    expect(() => upcastEventEnvelope("not-an-event")).toThrow(/event envelope/);
  });
});
