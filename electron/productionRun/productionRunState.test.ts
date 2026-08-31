import { describe, expect, it } from "vitest";

import { IllegalProductionTransitionError, transitionJob, transitionRun } from "./productionRunState";
import type { ProductionJob, ProductionJobStatus, ProductionRun } from "./productionRunTypes";

const NOW = "2026-08-08T08:00:00.000Z";

function job(status: ProductionJobStatus): ProductionJob {
  return {
    jobId: "job-1",
    stageId: "production",
    status,
    attempt: 1,
    provider: "provider-a",
    model: "model-a",
    idempotencyKey: "run-1:job-1:1",
    createdAt: "2026-08-08T07:00:00.000Z",
    updatedAt: "2026-08-08T07:00:00.000Z",
  };
}

function run(status: ProductionRun["status"]): ProductionRun {
  return {
    schemaVersion: 1,
    runId: "run-1",
    projectId: "project-1",
    revision: 0,
    status,
    stageId: "brief",
    playbook: { name: "brand.promo", version: "1.0.0" },
    origin: { host: "codex" },
    policy: {
      mode: "balanced",
      trustedHosts: ["codex"],
      allowedProviders: [],
      allowedModels: [],
      maxSpend: null,
      maxAttemptsPerJob: 1,
      minimizeUploads: true,
    },
    budget: { currency: "CNY", authorized: 0, reserved: 0, actual: 0, unsettled: 0 },
    planVersion: 1,
    snapshotCursor: 0,
    stages: [],
    gates: [],
    jobs: [],
    artifacts: [],
    createdAt: "2026-08-08T07:00:00.000Z",
    updatedAt: "2026-08-08T07:00:00.000Z",
  };
}

describe("production job state", () => {
  it("never resubmits an unknown submission", () => {
    expect(() => transitionJob(job("submission_unknown"), "submitting", NOW)).toThrow(
      IllegalProductionTransitionError,
    );
  });

  it.each([
    ["cancelled_remote"],
    ["detached"],
    ["too_late"],
  ] as const)("preserves honest cancellation result %s", (next) => {
    expect(transitionJob(job("cancel_requested"), next, NOW)).toMatchObject({
      status: next,
      updatedAt: NOW,
    });
  });

  it("allows reconciliation to recover the original provider task", () => {
    expect(transitionJob(job("submission_unknown"), "reconciling", NOW).status).toBe("reconciling");
    expect(transitionJob(job("reconciling"), "provider_accepted", NOW).status).toBe("provider_accepted");
  });

  it.each(["provider_accepted", "polling", "retry_wait", "downloading", "validating_technical", "validating_content"] as const)(
    "allows restart recovery to reconcile %s without resubmitting",
    (status) => {
      expect(transitionJob(job(status), "reconciling", NOW).status).toBe("reconciling");
    },
  );

  it("rejects skipping authorization and submit intent", () => {
    expect(() => transitionJob(job("planned"), "submitting", NOW)).toThrow(
      "Illegal job transition planned -> submitting",
    );
  });
});

describe("production run state", () => {
  it("follows the approved happy path", () => {
    let current = run("draft");
    for (const next of [
      "awaiting_contract",
      "ready",
      "running",
      "awaiting_rough_cut_review",
      "awaiting_export",
      "exporting",
      "completed",
    ] as const) {
      current = transitionRun(current, next, NOW);
    }
    expect(current.status).toBe("completed");
  });

  it("does not let a draft jump directly to running", () => {
    expect(() => transitionRun(run("draft"), "running", NOW)).toThrow(
      "Illegal run transition draft -> running",
    );
  });
});
