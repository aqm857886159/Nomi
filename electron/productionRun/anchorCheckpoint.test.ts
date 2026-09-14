import { describe, expect, it } from "vitest";

import { anchorCheckpointGateId, buildAnchorCheckpointGate, isAnchorCheckpointGate } from "./anchorCheckpoint";
import { applyProductionCommand } from "./productionRunReducer";
import type { ProductionRun } from "./productionRunTypes";

const NOW = "2026-08-25T00:00:00.000Z";

describe("P4 S4 anchor checkpoint gate", () => {
  it("derives a stable per-run gate id and recognizes its own gates", () => {
    const gate = buildAnchorCheckpointGate({ runId: "op-1", planHash: "h", anchorJobIds: ["a1"], now: NOW });
    expect(gate.gateId).toBe(anchorCheckpointGateId("op-1"));
    expect(gate.scope).toBe("anchor_checkpoint");
    expect(gate.status).toBe("waiting");
    expect(isAnchorCheckpointGate(gate)).toBe(true);
    // A budget gate is NOT an anchor checkpoint.
    expect(isAnchorCheckpointGate({ gateId: "gate-contract-v1", scope: "budget_envelope" })).toBe(false);
  });

  it("carries anchor jobIds and human (sanitizer-safe) copy with no internal terms", () => {
    const gate = buildAnchorCheckpointGate({ runId: "op-1", planHash: "h", anchorJobIds: ["a1", "a2"], now: NOW });
    expect(gate.jobIds).toEqual(["a1", "a2"]);
    for (const banned of ["锚", "封存", "物化", "合同"]) {
      expect(gate.title.includes(banned)).toBe(false);
      expect(gate.summary.includes(banned)).toBe(false);
    }
  });

  it("does NOT authorize budget when approved (it is a free quality gate, not a spend gate)", () => {
    // Approving the checkpoint through the reducer must not touch the budget — the scope is
    // anchor_checkpoint, and only budget_envelope decisions authorize the ledger (repository guard).
    const gate = buildAnchorCheckpointGate({ runId: "op-1", planHash: "plan-hash", anchorJobIds: ["a1"], now: NOW });
    const run: ProductionRun = {
      schemaVersion: 1, runId: "op-1", projectId: "project-1", revision: 3,
      status: "running", stageId: "generate", playbook: { name: "generation.single-shot", version: "1.0.0" },
      origin: { host: "semantic-mcp" },
      policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: 10, maxAttemptsPerJob: 2, minimizeUploads: true },
      budget: { currency: "CNY", authorized: 0, reserved: 0, actual: 0, unsettled: 0 },
      planVersion: 1, snapshotCursor: 3, stages: [], gates: [gate], jobs: [], artifacts: [],
      createdAt: NOW, updatedAt: NOW,
    };
    const effect = applyProductionCommand(run, {
      commandId: "decide-checkpoint", expectedRevision: 3, type: "gate.decide",
      payload: { gateId: gate.gateId, status: "approved" }, issuedAt: NOW,
    }, NOW);
    // The reducer marks the gate approved but never mutates the budget (that is the repository's
    // budget_envelope-only branch, exercised in the scheduler integration test).
    expect(effect.run.gates.find((g) => g.gateId === gate.gateId)?.status).toBe("approved");
    expect(effect.run.budget).toEqual(run.budget);
  });
});
