import { describe, expect, it, vi } from "vitest";

import { startSemanticMultiShotBatch, type SemanticBatchStartDependencies, type SemanticBatchStartScheduler } from "./mcpSemanticBatchStart";
import type { GenerationOperation } from "./mcpGenerationTools";

function operation(): Pick<GenerationOperation, "operationId" | "projectId" | "shots"> {
  return {
    operationId: "op-production",
    projectId: "project-1",
    shots: [
      { shotId: "shot-1", role: "shot", candidate: {} as never },
      { shotId: "shot-2", role: "shot", candidate: {} as never },
    ],
  };
}

function durableRun(state: "sealed" | "submitted") {
  return {
    projectId: "project-1",
    runId: "op-production",
    revision: state === "sealed" ? 4 : 5,
    generationPlan: {
      state,
      shots: [{ shotId: "shot-1" }, { shotId: "shot-2" }],
    },
  } as never;
}

describe("semantic multi-shot start", () => {
  it("submits the durable plan, then drives the batch scheduler instead of the single-shot path", async () => {
    let current = durableRun("sealed");
    const submitPlan = vi.fn(() => { current = durableRun("submitted"); });
    const scheduler = { runToQuiescence: vi.fn(async () => ({ quiescent: true })) };
    const createScheduler = vi.fn(() => scheduler);
    const driveScheduler = vi.fn((value: SemanticBatchStartScheduler) => { void value.runToQuiescence(); });
    const deps: SemanticBatchStartDependencies = {
      readRun: () => current,
      submitPlan,
      createScheduler,
      driveScheduler,
    };

    await expect(startSemanticMultiShotBatch(operation(), deps)).resolves.toEqual({
      operationId: "op-production",
      state: "submitted",
      nextAction: "observe",
    });
    expect(submitPlan).toHaveBeenCalledTimes(1);
    expect(createScheduler).toHaveBeenCalledTimes(1);
    expect(driveScheduler).toHaveBeenCalledWith(scheduler);
    expect(scheduler.runToQuiescence).toHaveBeenCalledTimes(1);
  });

  it("does not re-submit an already submitted batch", async () => {
    const submitPlan = vi.fn();
    const scheduler = { runToQuiescence: vi.fn(async () => ({ quiescent: true })) };
    const deps: SemanticBatchStartDependencies = {
      readRun: () => durableRun("submitted"),
      submitPlan,
      createScheduler: () => scheduler,
      driveScheduler: vi.fn(),
    };

    await startSemanticMultiShotBatch(operation(), deps);
    expect(submitPlan).not.toHaveBeenCalled();
    expect(deps.driveScheduler).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the durable run has no multi-shot plan", async () => {
    const deps: SemanticBatchStartDependencies = {
      readRun: () => ({
        projectId: "project-1",
        runId: "op-production",
        revision: 1,
        generationPlan: { state: "sealed" },
      } as never),
      submitPlan: vi.fn(),
      createScheduler: vi.fn(),
      driveScheduler: vi.fn(),
    };

    await expect(startSemanticMultiShotBatch(operation(), deps)).rejects.toMatchObject({ code: "semantic_multi_shot_plan_missing" });
    expect(deps.createScheduler).not.toHaveBeenCalled();
  });

  it("fails closed when the submit transition does not become durable", async () => {
    const deps: SemanticBatchStartDependencies = {
      readRun: () => durableRun("sealed"),
      submitPlan: vi.fn(),
      createScheduler: vi.fn(),
      driveScheduler: vi.fn(),
    };

    await expect(startSemanticMultiShotBatch(operation(), deps)).rejects.toMatchObject({ code: "semantic_batch_not_submitted" });
    expect(deps.createScheduler).not.toHaveBeenCalled();
  });
});
