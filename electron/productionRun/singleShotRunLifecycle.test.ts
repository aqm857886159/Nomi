import { describe, expect, it } from "vitest";

import { applyProductionCommand } from "./productionRunReducer";
import type { ProductionRun, RunCommand } from "./productionRunTypes";
import {
  isObservationContention,
  markSingleShotAttention,
  markSingleShotCompleted,
  markSingleShotRunning,
  reopenSingleShotRetrieval,
} from "./singleShotRunLifecycle";
import { ProductionRunLockBusyError, ProductionRunLockLostError } from "./productionRunLock";
import { jobAwaitsRetrieval } from "../shared/productionShotPhase";
import { matchNomiErrorCode } from "../shared/nomiErrorCodes";

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
      trustedHosts: [],
      allowedProviders: [],
      allowedModels: [],
      maxSpend: null,
      maxAttemptsPerJob: 1,
      minimizeUploads: true,
    },
    budget: { currency: "CNY", authorized: 0, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 },
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
    expect(test.read().jobs[0]).toMatchObject({ status: "needs_attention", errorCode: "output_retrieval_failed" });
    expect(jobAwaitsRetrieval(test.read().jobs[0])).toBe(true);
    expect(test.commands.map((command) => command.type)).toEqual(["job.status", "stage.upsert", "run.status"]);
  });

  it("任务号还在就只差取回；不知道做没做完时不说「已经生成」（界面按机器码说话，中英都走词表）", () => {
    const unknown = harness(fixture("running"));
    markSingleShotAttention(unknown.repository, "project-1", "run-single", "job-1");
    expect(matchNomiErrorCode(unknown.read().jobs[0]!.errorMessage ?? "")).toBe("retrieval-query");

    const finishedRun = fixture("running");
    const finished = harness({ ...finishedRun, jobs: finishedRun.jobs.map((job) => ({ ...job, providerStatus: "completed" })) });
    markSingleShotAttention(finished.repository, "project-1", "run-single", "job-1");
    expect(matchNomiErrorCode(finished.read().jobs[0]!.errorMessage ?? "")).toBe("output-retrieval-failed");
  });

  it("没有任务号：没有东西可取，照旧记成观察失败，不算待取回", () => {
    const run = fixture("running");
    const test = harness({ ...run, jobs: run.jobs.map(({ providerTaskId: _taskId, ...job }) => ({ ...job, status: "authorized" as const })) });
    markSingleShotAttention(test.repository, "project-1", "run-single", "job-1");
    expect(test.read().jobs[0]).toMatchObject({ status: "needs_attention", errorCode: "single_shot_observation_failed" });
    expect(jobAwaitsRetrieval(test.read().jobs[0])).toBe(false);
  });

  it("重新取回：job、阶段、Run 一次放回进行中；不是在等取回就什么都不写", () => {
    const test = harness(fixture("running"));
    markSingleShotAttention(test.repository, "project-1", "run-single", "job-1");
    const batches: number[] = [];
    const repository = {
      ...test.repository,
      executeBatch: (projectId: string, runId: string, expectedRevision: number, commands: readonly Omit<RunCommand, "expectedRevision">[]) => {
        batches.push(commands.length);
        return commands.map((command) => test.repository.execute(projectId, runId, { ...command, expectedRevision }));
      },
    };

    expect(reopenSingleShotRetrieval(repository, "project-1", "run-single", "job-1")).not.toBeNull();

    expect(batches).toEqual([3]);
    expect(test.read().status).toBe("running");
    expect(test.read().stages[0]).toMatchObject({ status: "running" });
    expect(test.read().jobs[0]).toMatchObject({ status: "polling" });
    expect(test.read().jobs[0]!.errorCode ?? "").toBe("");
    expect(reopenSingleShotRetrieval(repository, "project-1", "run-single", "job-1")).toBeNull();
    expect(batches).toEqual([3]);
  });

  it("撞上别的观察者或写者不算这笔任务失败", () => {
    expect(isObservationContention(new ProductionRunLockBusyError())).toBe(true);
    expect(isObservationContention(new ProductionRunLockLostError())).toBe(true);
    expect(isObservationContention(new Error("Production run revision conflict"))).toBe(true);
    expect(isObservationContention(new Error("socket hang up"))).toBe(false);
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
