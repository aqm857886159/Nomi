import { describe, expect, it, vi } from "vitest";

import { observeSingleShotGeneration } from "./singleShotGenerationObserver";

describe("single-shot generation observation", () => {
  it("stops between polls when its lifecycle signal is aborted", async () => {
    const controller = new AbortController();
    let releaseSleep!: () => void;
    const sleep = vi.fn(() => new Promise<void>((resolve) => { releaseSleep = resolve; }));
    const submission = {
      poll: vi.fn(async () => ({
        operationId: "op-1", runId: "op-1", jobId: "job-1", providerTaskId: "task-1",
        providerStatus: "processing", nextAction: "poll" as const,
      })),
      materialize: vi.fn(),
    };
    const pending = observeSingleShotGeneration({
      submission,
      input: { projectId: "project-1", operationId: "op-1" },
      signal: controller.signal,
      sleep,
      pollHorizonMs: 10_000,
      initialDelayMs: 100,
      maxDelayMs: 100,
    });
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(1));
    controller.abort();
    releaseSleep();

    await expect(pending).resolves.toMatchObject({ nextAction: "observe", aborted: true, polls: 1 });
    expect(submission.materialize).not.toHaveBeenCalled();
  });

  it("does not materialize a completed poll after the lifecycle epoch is stale", async () => {
    let current = true;
    const submission = {
      poll: vi.fn(async () => {
        current = false;
        return {
          operationId: "op-1", runId: "op-1", jobId: "job-1", providerTaskId: "task-1",
          providerStatus: "completed", nextAction: "materialize" as const,
        };
      }),
      materialize: vi.fn(),
    };

    await expect(observeSingleShotGeneration({
      submission,
      input: { projectId: "project-1", operationId: "op-1" },
      isCurrent: () => current,
      pollHorizonMs: 1_000,
    })).resolves.toMatchObject({ nextAction: "observe", aborted: true, polls: 1 });
    expect(submission.materialize).not.toHaveBeenCalled();
  });

  it("uses only the durable poll/materialize seam during recovery", async () => {
    const start = vi.fn(() => { throw new Error("recovery must never submit"); });
    const submission = {
      start,
      poll: vi.fn(async () => ({
        operationId: "op-1", runId: "op-1", jobId: "job-1", providerTaskId: "task-1",
        providerStatus: "completed", nextAction: "materialize" as const,
      })),
      materialize: vi.fn(async () => ({
        operationId: "op-1", runId: "op-1", jobId: "job-1", providerTaskId: "task-1",
        artifactId: "artifact-1", contentHash: "hash-1", nextAction: "completed" as const,
      })),
    };

    await expect(observeSingleShotGeneration({
      submission,
      input: { projectId: "project-1", operationId: "op-1" },
      pollHorizonMs: 1_000,
    })).resolves.toMatchObject({ nextAction: "completed" });
    expect(submission.poll).toHaveBeenCalledTimes(1);
    expect(submission.materialize).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it("polls a submitted job, materializes its output, then notifies the canvas owner", async () => {
    const calls: string[] = [];
    const submission = {
      poll: vi.fn(async () => {
        calls.push("poll");
        return {
          operationId: "op-1",
          runId: "op-1",
          jobId: "job-1",
          providerTaskId: "task-1",
          providerStatus: "completed",
          nextAction: "materialize" as const,
        };
      }),
      materialize: vi.fn(async () => {
        calls.push("materialize");
        return {
          operationId: "op-1",
          runId: "op-1",
          jobId: "job-1",
          providerTaskId: "task-1",
          artifactId: "artifact-1",
          contentHash: "hash-1",
          nextAction: "completed" as const,
        };
      }),
    };

    const result = await observeSingleShotGeneration({
      submission,
      input: { projectId: "project-1", operationId: "op-1" },
      onMaterialized: async () => { calls.push("canvas"); },
      sleep: async () => { calls.push("sleep"); },
      pollHorizonMs: 1_000,
    });

    expect(result.nextAction).toBe("completed");
    expect(calls).toEqual(["poll", "materialize", "canvas"]);
    expect(submission.poll).toHaveBeenCalledTimes(1);
    expect(submission.materialize).toHaveBeenCalledTimes(1);
  });

  it("continues observing a pending provider without submitting again", async () => {
    const statuses = ["processing", "completed"];
    const sleep = vi.fn(async () => undefined);
    const submission = {
      poll: vi.fn(async () => ({
        operationId: "op-1",
        runId: "op-1",
        jobId: "job-1",
        providerTaskId: "task-1",
        providerStatus: statuses.shift()!,
        nextAction: statuses.length === 0 ? "materialize" as const : "poll" as const,
      })),
      materialize: vi.fn(async () => ({
        operationId: "op-1", runId: "op-1", jobId: "job-1", providerTaskId: "task-1",
        artifactId: "artifact-1", contentHash: "hash-1", nextAction: "completed" as const,
      })),
    };

    await expect(observeSingleShotGeneration({
      submission,
      input: { projectId: "project-1", operationId: "op-1" },
      sleep,
      pollHorizonMs: 1_000,
      initialDelayMs: 1,
      maxDelayMs: 1,
    })).resolves.toMatchObject({ nextAction: "completed", polls: 2 });
    expect(submission.poll).toHaveBeenCalledTimes(2);
    expect(submission.materialize).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("leaves failed observation for attention and never invents an artifact", async () => {
    const submission = {
      poll: vi.fn(async () => ({
        operationId: "op-1", runId: "op-1", jobId: "job-1", providerTaskId: "task-1",
        providerStatus: "failed", nextAction: "attention" as const,
      })),
      materialize: vi.fn(),
    };

    await expect(observeSingleShotGeneration({
      submission,
      input: { projectId: "project-1", operationId: "op-1" },
      pollHorizonMs: 1_000,
    })).resolves.toMatchObject({ nextAction: "attention", polls: 1 });
    expect(submission.materialize).not.toHaveBeenCalled();
  });
});
