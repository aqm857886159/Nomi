import { describe, expect, it } from "vitest";

import { applyProductionCommand } from "./productionRunReducer";
import type { ProductionRun, RunCommand } from "./productionRunTypes";
import {
  markSingleShotAttention,
  markSingleShotCompleted,
  markSingleShotRunning,
} from "./singleShotRunLifecycle";

function fixture(status: ProductionRun["status"] = "draft"): ProductionRun {
  const timestamp = "2026-08-31T00:00:00.000Z";
  return {
    schemaVersion: 1,
    runId: "run-single",
    projectId: "project-1",
    revision: 0,
    status,
    stageId: "generate",
    playbook: { name: "generation.single-shot", version: "1.0.0" },
    origin: { host: "nomi" },
    policy: {
      mode: "balanced",
      trustedHosts: [],
      allowedProviders: [],
      allowedModels: [],
      maxSpend: null,
      maxAttemptsPerJob: 1,
      minimizeUploads: true,
    },
    budget: { currency: "CNY", authorized: 0, reserved: 0, actual: 0, unsettled: 0 },
    planVersion: 1,
    snapshotCursor: 0,
    stages: [{ stageId: "generate", title: "Generate", status: "pending", order: 0 }],
    gates: [],
    jobs: [{
      jobId: "job-1",
      stageId: "generate",
      status: "provider_accepted",
      attempt: 1,
      provider: "apimart",
      model: "image-model",
      idempotencyKey: "idempotent-1",
      providerTaskId: "task-1",
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    artifacts: [],
    generationPlan: {
      operationId: "run-single",
      state: "submitted",
      candidate: {
        candidateId: "candidate-1",
        revision: 1,
        moduleId: "generation.single-shot",
        providerId: "apimart",
        modelId: "image-model",
        mode: "text-to-image",
        prompt: "a paper boat",
        parameters: {},
        references: [],
      },
      updatedAt: timestamp,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function harness(initial: ProductionRun) {
  let current = structuredClone(initial);
  const commands: RunCommand[] = [];
  const repository = {
    read: () => current,
    execute: (_projectId: string, _runId: string, command: RunCommand) => {
      commands.push(command);
      const effect = applyProductionCommand(current, command, command.issuedAt);
      current = { ...effect.run, revision: current.revision + 1, snapshotCursor: current.snapshotCursor + 1 };
      return { run: current, events: [] };
    },
  };
  return { repository, commands, read: () => current, replace: (next: ProductionRun) => { current = structuredClone(next) } };
}

describe("single-shot durable run lifecycle", () => {
  it("marks an accepted run running and settles its stage and run after materialization", () => {
    const test = harness(fixture("draft"));
    markSingleShotRunning(test.repository, "project-1", "run-single");

    let current = test.read();
    expect(current.status).toBe("running");
    current = {
      ...current,
      jobs: current.jobs.map((job) => ({ ...job, status: "ready" as const })),
      artifacts: [{ artifactId: "artifact-1", stageId: "generate", jobId: "job-1", kind: "image", status: "ready", contentHash: "a".repeat(64), projectRelativePath: "out.png", createdAt: "2026-08-31T00:00:00.000Z" }],
    };
    // The fake repository models the durable materialization writes made by
    // ProductionGenerationSubmission before lifecycle settlement.
    test.replace(current);
    markSingleShotCompleted(test.repository, "project-1", "run-single");

    expect(test.read().status).toBe("completed");
    expect(test.read().stages[0]).toMatchObject({ status: "completed", completedAt: expect.any(String) });
    expect(test.commands.map((command) => command.type)).toEqual(["run.status", "stage.upsert", "run.status"]);
  });

  it("does not claim completion until the target job and artifact are durable", () => {
    const test = harness(fixture("running"));
    markSingleShotCompleted(test.repository, "project-1", "run-single");
    expect(test.read().status).toBe("running");
    expect(test.commands).toHaveLength(0);
  });

  it("does not implicitly resume a paused or attention run", () => {
    for (const status of ["paused", "needs_attention"] as const) {
      const test = harness(fixture(status));
      markSingleShotRunning(test.repository, "project-1", "run-single");
      expect(test.read().status).toBe(status);
      expect(test.commands).toHaveLength(0);
    }
  });

  it("persists provider/materialization attention once without submitting again", () => {
    const test = harness(fixture("running"));
    markSingleShotAttention(test.repository, "project-1", "run-single", "job-1");
    markSingleShotAttention(test.repository, "project-1", "run-single", "job-1");

    expect(test.read().status).toBe("needs_attention");
    expect(test.read().stages[0]).toMatchObject({ status: "needs_attention" });
    expect(test.read().jobs[0]).toMatchObject({ status: "needs_attention", errorCode: "single_shot_observation_failed" });
    expect(test.commands.map((command) => command.type)).toEqual(["job.status", "stage.upsert", "run.status"]);
  });

  it("does not mutate legacy playbook runs", () => {
    const test = harness({ ...fixture("running"), playbook: { name: "brand.promo", version: "1.0.0" } });
    markSingleShotRunning(test.repository, "project-1", "run-single");
    markSingleShotCompleted(test.repository, "project-1", "run-single");
    markSingleShotAttention(test.repository, "project-1", "run-single", "job-1");
    expect(test.commands).toHaveLength(0);
    expect(test.read().status).toBe("running");
  });
});
