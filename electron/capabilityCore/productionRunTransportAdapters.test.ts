import { describe, expect, it, vi } from "vitest";
import { createPiProductionRunTransportAdapter } from "./productionRunTransportAdapters";

const binding = {
  projectId: "project-1",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 1,
} as const;

function service() {
  const run = {
    runId: "run-1",
    projectId: "project-1",
    revision: 7,
    status: "awaiting_direction",
    stageId: "direction",
    gates: [{ gateId: "gate-direction-v1", scope: "stage", status: "waiting" }],
  };
  return {
    run,
    createDraft: vi.fn(() => ({ ...run, openInNomi: "nomi://run-1" })),
    readProjection: vi.fn(() => ({ ...run, openInNomi: "nomi://run-1" })),
    readFull: vi.fn(() => run),
    readEvents: vi.fn(async () => ({ events: [{ cursor: 8, type: "stage.started" }], nextCursor: 8 })),
    readArtifactProjection: vi.fn(() => ({ artifactId: "artifact-1", kind: "script", version: 1 })),
    readArtifactContent: vi.fn(() => ({ artifactId: "artifact-1", kind: "script", version: 1, content: "script" })),
    command: vi.fn(async () => ({ run, events: [] })),
    requestArtifactRevision: vi.fn(async () => ({ artifactId: "artifact-2", version: 2 })),
    reviewArtifact: vi.fn(async () => ({ artifactId: "artifact-1", version: 1, reviewStatus: "approved" })),
    materializeStoryboard: vi.fn(async () => ({ materialized: true, runId: "run-1" })),
  };
}

describe("Project Agent ProductionRun atomic tool adapter", () => {
  it("creates a zero-cost draft and reads resumable progress without exposing project plumbing", async () => {
    const fake = service();
    const adapter = createPiProductionRunTransportAdapter({ service: fake as never, binding });
    const signal = new AbortController().signal;

    await expect(adapter.tryExecute({ toolCallId: "call-1", toolName: "start_production_run", args: { goal: "做一个五分钟品牌片" } }, signal))
      .resolves.toMatchObject({ ok: true });
    expect(fake.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      origin: { host: "embedded-agent" },
      brief: { goal: "做一个五分钟品牌片" },
    }));
    await expect(adapter.tryExecute({ toolCallId: "call-2", toolName: "subscribe_production_run", args: { runId: "run-1", afterCursor: 7 } }, signal))
      .resolves.toMatchObject({ ok: true, result: { nextCursor: 8 } });
    expect(fake.readEvents).toHaveBeenCalledWith("project-1", "run-1", 7, 0);
  });

  it("prepares a reversible control with a run revision and executes only after Host approval", async () => {
    const fake = service();
    const adapter = createPiProductionRunTransportAdapter({ service: fake as never, binding });
    const prepared = await adapter.prepare({
      toolCallId: "call-control",
      toolName: "control_production_run",
      args: { runId: "run-1", action: "pause" },
    }, new AbortController().signal);
    expect(prepared?.invocation).toMatchObject({
      target: { kind: "production", runId: "run-1" },
      preconditions: { run: { runId: "run-1", revision: 7 } },
    });
    await expect(adapter.execute(prepared!, {
      receiptProposalId: "receipt-1", approvalId: "approval-1", actionHash: prepared!.invocation.actionHash,
    }, new AbortController().signal)).resolves.toMatchObject({ ok: true });
    expect(fake.command).toHaveBeenCalledWith("project-1", "run-1", expect.objectContaining({
      type: "run.control", expectedRevision: 7, payload: { action: "pause" },
    }));
  });

  it("rejects project spoofing and keeps paid gates inside Nomi", async () => {
    const fake = service();
    const paidRun = {
      ...fake.run,
      gates: [{ gateId: "gate-budget-v1", scope: "budget_envelope", status: "waiting" }],
    };
    fake.readFull.mockReturnValue(paidRun);
    const adapter = createPiProductionRunTransportAdapter({ service: fake as never, binding });
    await expect(adapter.tryExecute({ toolCallId: "spoof", toolName: "get_production_run", args: { runId: "run-1", projectId: "other" } }, new AbortController().signal))
      .resolves.toMatchObject({ ok: false, code: "capability_input_invalid" });
    const prepared = await adapter.prepare({ toolCallId: "gate", toolName: "decide_production_gate", args: { runId: "run-1", gateId: "gate-budget-v1", decision: "approved" } }, new AbortController().signal);
    await expect(adapter.execute(prepared!, { receiptProposalId: "receipt-2", approvalId: "approval-2", actionHash: prepared!.invocation.actionHash }, new AbortController().signal))
      .resolves.toMatchObject({ ok: false, code: "production_gate_requires_nomi" });
    expect(fake.command).not.toHaveBeenCalled();
  });
});
