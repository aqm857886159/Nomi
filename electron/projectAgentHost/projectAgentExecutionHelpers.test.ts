import { describe, expect, it } from "vitest";

import type { RuntimeToolCallRecord } from "../harness/runtime/runtimePort";
import type { ProjectAgentTaskItem, ProjectAgentTurn } from "../shared/projectAgentContracts";
import { exportJobTaskItems, toolItem } from "./projectAgentExecutionHelpers";

const binding = Object.freeze({
  projectId: "project-a",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 1,
});

const turn = Object.freeze({
  turnId: "turn-export",
  threadId: "thread-export",
  executionToken: "token-export",
} as ProjectAgentTurn);

function successfulExport(jobId = "job-a"): RuntimeToolCallRecord {
  return {
    toolCallId: `tool-${jobId}`,
    toolName: "export_timeline",
    args: { expectedRevision: "revision-a" },
    status: "ok",
    result: {
      operation: "export_timeline",
      accepted: true,
      jobId,
      backend: "filtergraph",
      timelineRevision: "revision-a",
      durationFrames: 60,
      profile: { aspectRatio: "16:9", resolution: "1080p", quality: "standard" },
    },
  };
}

describe("ExportJob TaskRef projection", () => {
  it("stores only one reference for repeated schema-valid successful export results", () => {
    const items = exportJobTaskItems(binding, turn, [successfulExport(), successfulExport()], [], "2026-08-29T00:00:00.000Z");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "task",
      correlationId: "tool-job-a",
      task: { kind: "export-job", jobId: "job-a" },
      status: "done",
      retryable: false,
      deviated: false,
    });
    expect(Object.keys(items[0]!.task).sort()).toEqual(["jobId", "kind"]);
    expect(JSON.stringify(items[0])).not.toContain("filtergraph");
    expect(JSON.stringify(items[0])).not.toContain("durationFrames");
  });

  it("deduplicates against an ExportJob TaskRef already present in Host state", () => {
    const existing = [{
      itemId: "task-existing",
      threadId: turn.threadId,
      turnId: turn.turnId,
      correlationId: "tool-existing",
      kind: "task",
      task: { kind: "export-job", jobId: "job-a" },
      status: "done",
      retryable: false,
      deviated: false,
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
    } satisfies ProjectAgentTaskItem];

    expect(exportJobTaskItems(binding, turn, [successfulExport()], existing, "2026-08-29T00:00:01.000Z")).toEqual([]);
  });

  it.each([
    { ...successfulExport(), status: "error" as const },
    { ...successfulExport(), toolName: "cancel_export_job" },
    { ...successfulExport(), result: { ...(successfulExport().result as object), accepted: false } },
    { ...successfulExport(), result: { ...(successfulExport().result as object), jobId: " job-a" } },
    { ...successfulExport(), result: { ...(successfulExport().result as object), foreignStatus: "succeeded" } },
  ])("rejects unsuccessful, mismatched, or non-strict tool results", (record) => {
    expect(exportJobTaskItems(binding, turn, [record], [], "2026-08-29T00:00:00.000Z")).toEqual([]);
  });
});

describe("Provenance ledger projection", () => {
  it("persists the source and taint summary without duplicating AssetSourceEvidence", () => {
    const item = toolItem(binding, turn, {
      toolCallId: "tool-provenance",
      toolName: "nomi_document_edit",
      args: { content: "generated text" },
      status: "ok",
      result: { accepted: true },
    }, "2026-09-03T00:00:00.000Z", [{
      source: "web_fetched",
      sourceRef: "https://example.test/page",
      trust: "untrusted",
      tainted: true,
    }]);

    expect(item).toMatchObject({
      kind: "tool",
      provenance: [{ source: "web_fetched", sourceRef: "https://example.test/page", tainted: true }],
    });
    expect(JSON.stringify(item)).not.toContain("licenseSnapshot");
  });
});
