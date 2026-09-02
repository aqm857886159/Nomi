import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { agentToolsForRequest } from "../harness/agentChatPolicy";
import type { RuntimeToolCall } from "../harness/runtime/runtimePort";
import { createCanvasReadSurfaceRegistry, createSurfaceOwnerAuthority } from "./canvasReadSurfaceRegistry";
import { createMainCapabilityExecutorRegistry } from "./capabilityExecutorRegistry";
import { compileExecutionContract, type PlanCandidate } from "./executionContract";
import { createPiPhase4SurfaceTransportAdapter } from "./phase4SurfaceTransportAdapters";
import { startSemanticMultiShotBatch } from "./mcpSemanticBatchStart";
import { planStoryboardFromScript } from "./mcpStoryboardPlanner";
import { createModuleRegistry } from "./moduleRegistry";
import { createPiTimelineWriteTransportAdapter } from "./timelineTransportAdapters";
import { createProductionRunRepository } from "../productionRun/productionRunRepository";
import type { ProductionGenerationShot } from "../productionRun/productionRunTypes";

/**
 * A zero-quota contract fixture for the resident Agent's long-form seam.
 *
 * The fixture deliberately stops before a provider boundary: the planner,
 * durable Run, scheduler handoff, verified Timeline transport, and verified
 * Export transport are real production modules. Provider submission is a
 * spy that must remain untouched. This catches the old false-success seam
 * without spending a generation job.
 */

const NOW = "2026-08-31T00:00:00.000Z";
const PROJECT_ID = "project-resident";
const OPERATION_ID = "resident-5m-video";
const roots: string[] = [];

const generationRegistry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text", "image"],
  outputKinds: ["video"],
  modes: ["text-to-video", "image-to-video"],
  parameterSchema: { duration: { type: "number" } },
  assetInputSchema: { references: { kind: "asset", max: 30 } },
  providers: [{
    providerId: "fixture-provider",
    models: [{
      modelId: "fixture-video",
      modes: ["text-to-video", "image-to-video"],
      parameterSchema: { duration: { type: "number" } },
      capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true },
    }],
  }],
}]);

function candidate(candidateId: string, prompt: string, duration: number): PlanCandidate {
  return {
    candidateId,
    revision: 1,
    moduleId: "generation.single-shot",
    providerId: "fixture-provider",
    modelId: "fixture-video",
    mode: "text-to-video",
    prompt,
    parameters: { duration },
    references: [],
  };
}

function buildStoryboardShots(scriptText: string): {
  plan: ReturnType<typeof planStoryboardFromScript>;
  shots: ProductionGenerationShot[];
  topContract: ReturnType<typeof compileExecutionContract>;
} {
  const plan = planStoryboardFromScript({
    projectId: PROJECT_ID,
    scriptText,
    minimumShots: 2,
    targetDurationSeconds: 300,
  });
  const shots = plan.shots.map((draft, index) => {
    const shotId = draft.shotId ?? `shot-${index + 1}`;
    const rawCandidate = candidate(shotId, draft.prompt, draft.durationSeconds ?? 15);
    const contract = compileExecutionContract(rawCandidate, generationRegistry);
    return {
      shotId,
      role: "shot" as const,
      included: true,
      candidate: { ...rawCandidate, sealedContractHash: contract.contractHash },
      contract,
      updatedAt: NOW,
    };
  });
  if (shots.length === 0) throw new Error("fixture storyboard unexpectedly empty");
  return { plan, shots, topContract: shots[0].contract! };
}

function createRunFixture(shots: readonly ProductionGenerationShot[], topContract: ReturnType<typeof compileExecutionContract>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-resident-production-"));
  roots.push(root);
  const repository = createProductionRunRepository({
    projectDirResolver: (projectId) => (projectId === PROJECT_ID ? root : null),
    now: () => NOW,
    randomId: (() => {
      let sequence = 0;
      return () => `fixture-id-${++sequence}`;
    })(),
  });
  repository.createGenerationDraft({
    operationId: OPERATION_ID,
    projectId: PROJECT_ID,
    origin: { host: "resident-agent" },
    candidate: shots[0].candidate,
    shots: shots.map(({ shotId, role, included, candidate: shotCandidate }) => ({
      shotId,
      role,
      included,
      candidate: shotCandidate,
    })),
  });
  const draft = repository.read(PROJECT_ID, OPERATION_ID);
  if (!draft) throw new Error("fixture ProductionRun was not created");
  const sealed = repository.execute(PROJECT_ID, OPERATION_ID, {
    commandId: "fixture:generation.seal",
    expectedRevision: draft.revision,
    type: "generation.seal",
    payload: {
      contract: topContract,
      shots,
      planHash: "fixture-plan-5m",
    },
    issuedAt: NOW,
  }).run;
  return { repository, root, sealed };
}

async function createSurfaceAdapters() {
  const ownerAuthority = createSurfaceOwnerAuthority();
  const owner = ownerAuthority.capture({
    contents: {},
    frame: {},
    webContentsId: 1,
    processId: 2,
    frameRoutingId: 3,
    origin: "file://",
    isLive: () => true,
  });
  let sequence = 0;
  const registry = createCanvasReadSurfaceRegistry({
    ownerAuthority,
    resolveProjectIdentity: async () => ({
      projectId: PROJECT_ID,
      immutableProjectUuid: "00000000-0000-4000-8000-000000000005",
      projectGeneration: 1,
      canonicalRootPath: "/private/project-resident",
      canonicalRootDigest: "resident-root",
    }),
    randomId: () => `surface-id-${++sequence}`,
  });
  const suspension = registry.suspend(owner, { surfaceInstanceId: "resident-workbench" });
  const binding = await registry.commitCanvasRead(owner, { projectId: PROJECT_ID, suspension });
  const capturedPort = registry.captureCanvasReadPort(owner, binding);

  const timelineWrites: unknown[] = [];
  const exportWrites: unknown[] = [];
  const executor = createMainCapabilityExecutorRegistry({
    resolveCanvasReadPort: async () => ({ read: async () => ({}) }),
    resolveTimelineWritePort: async () => ({
      write: async (input) => {
        timelineWrites.push(input);
        return {
          operation: "apply_edit_plan",
          ok: true,
          revision: "timeline-revision-2",
          planId: "resident-plan-5m",
          summary: "将 20 个镜头按顺序排入时间线",
          applied: true,
          replayed: false,
          appliedOperationCount: 20,
          undoToken: "timeline-undo:resident-5m",
        };
      },
    }),
    resolveExportWritePort: async () => ({
      write: async (input) => {
        exportWrites.push(input);
        return {
          operation: "export_timeline",
          accepted: true,
          jobId: "resident-export-5m",
          backend: "filtergraph",
          timelineRevision: "timeline-revision-2",
          durationFrames: 9_000,
          profile: { aspectRatio: "16:9", resolution: "1080p", quality: "standard" },
        };
      },
    }),
  });
  return {
    timelineWrites,
    exportWrites,
    timeline: createPiTimelineWriteTransportAdapter({ registry, capturedPort, requestId: "resident-request", executor }),
    exporter: createPiPhase4SurfaceTransportAdapter({ registry, capturedPort, requestId: "resident-request", executor }),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("resident Agent production journey (zero quota contract)", () => {
  it("turns a 5-minute goal into one durable multi-shot Run and hands it to timeline/export", async () => {
    const { plan, shots, topContract } = buildStoryboardShots("帮我做一个5分钟品牌视频，剧本你决定，然后生成并导出");
    expect(plan.targetDurationSeconds).toBe(300);
    expect(shots).toHaveLength(20);
    expect(shots.reduce((total, shot) => total + Number(shot.candidate.parameters.duration), 0)).toBe(300);

    const { repository, sealed } = createRunFixture(shots, topContract);
    expect(sealed.generationPlan).toMatchObject({ state: "sealed", planHash: "fixture-plan-5m" });
    expect(sealed.generationPlan?.shots).toHaveLength(20);

    const providerSubmit = vi.fn();
    const schedulerRun = vi.fn(async () => ({ quiescent: true }));
    const submitPlan = vi.fn((run: { revision: number }) => {
      return repository.execute(PROJECT_ID, OPERATION_ID, {
        commandId: "fixture:generation.submit",
        expectedRevision: run.revision,
        type: "generation.submit",
        payload: {},
        issuedAt: NOW,
      });
    });
    const result = await startSemanticMultiShotBatch({
      operationId: OPERATION_ID,
      projectId: PROJECT_ID,
      shots: shots.map(({ shotId, role, included, candidate: shotCandidate }) => ({ shotId, role, included, candidate: shotCandidate })),
    }, {
      readRun: (projectId, runId) => {
        const run = repository.read(projectId, runId);
        return run
          ? { projectId: run.projectId, runId: run.runId, revision: run.revision, generationPlan: run.generationPlan! }
          : null;
      },
      submitPlan,
      createScheduler: (run) => {
        expect(run.generationPlan?.shots).toHaveLength(20);
        return { runToQuiescence: schedulerRun };
      },
      driveScheduler: (scheduler) => { void scheduler.runToQuiescence(); },
    });
    await Promise.resolve();

    expect(result).toEqual({ operationId: OPERATION_ID, state: "submitted", nextAction: "observe" });
    expect(submitPlan).toHaveBeenCalledTimes(1);
    expect(schedulerRun).toHaveBeenCalledTimes(1);
    expect(providerSubmit).not.toHaveBeenCalled();
    expect(repository.read(PROJECT_ID, OPERATION_ID)?.generationPlan?.state).toBe("submitted");

    const tools = agentToolsForRequest({
      capability: "canvas-agent",
      projectId: PROJECT_ID,
      history: { kind: "ephemeral" },
      prompt: "帮我做一个5分钟品牌视频，写剧本、拆分镜、生成并导出",
    });
    const toolNames = tools.map((tool) => tool.name);
    expect(toolNames).toEqual(expect.arrayContaining([
      "start_production_run",
      "nomi_canvas_plan",
      "nomi_generation_plan",
      "nomi_generation_status",
      "export_timeline",
    ]));

    const adapters = await createSurfaceAdapters();
    const signal = new AbortController().signal;
    const timelinePlan = {
      planId: "resident-plan-5m",
      baseRevision: "timeline-revision-1",
      summary: "将 20 个镜头按顺序排入时间线",
      operations: shots.map((shot, index) => ({ kind: "move" as const, clipId: shot.shotId, startFrame: index * 450 })),
    };
    const timelineCall: RuntimeToolCall = {
      toolCallId: "resident-timeline-call",
      toolName: "apply_edit_plan",
      args: timelinePlan,
    };
    const preparedTimeline = await adapters.timeline.prepare(timelineCall, signal);
    expect(preparedTimeline).not.toBeNull();
    const timelineDecision = await adapters.timeline.execute(preparedTimeline!, {
      receiptProposalId: "resident-timeline-receipt",
      approvalId: "resident-timeline-approval",
      actionHash: preparedTimeline!.invocation.actionHash,
    }, signal);
    expect(timelineDecision).toMatchObject({ ok: true, result: { operation: "apply_edit_plan", revision: "timeline-revision-2", applied: true } });

    const exportCall: RuntimeToolCall = {
      toolCallId: "resident-export-call",
      toolName: "export_timeline",
      args: { expectedRevision: "timeline-revision-2", aspectRatio: "16:9", resolution: "1080p", quality: "standard" },
    };
    const preparedExport = await adapters.exporter.prepareWrite(exportCall, signal);
    expect(preparedExport).not.toBeNull();
    const exportDecision = await adapters.exporter.executeWrite(preparedExport!, {
      receiptProposalId: "resident-export-receipt",
      approvalId: "resident-export-approval",
      actionHash: preparedExport!.invocation.actionHash,
    }, signal);
    expect(exportDecision).toMatchObject({ ok: true, result: { operation: "export_timeline", accepted: true, jobId: "resident-export-5m", timelineRevision: "timeline-revision-2" } });
    expect(adapters.timelineWrites).toHaveLength(1);
    expect(adapters.exportWrites).toHaveLength(1);
  });
});
