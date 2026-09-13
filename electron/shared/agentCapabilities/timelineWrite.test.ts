import { describe, expect, it } from "vitest";

import {
  TIMELINE_WRITE_CAPABILITY,
  projectTimelineWriteResult,
  timelineWriteResultSchema,
  timelineWriteInputForAlias,
  timelineWritePiInputSchemaForAlias,
} from "./timelineWrite";

describe("timeline.write capability contract", () => {
  it("owns apply and undo as proposal-approved reversible writes", () => {
    expect(TIMELINE_WRITE_CAPABILITY.id).toBe("timeline.write");
    expect(TIMELINE_WRITE_CAPABILITY.effect).toBe("reversible_write");
    expect(TIMELINE_WRITE_CAPABILITY.effectClass).toBe("reversible_local");
    expect(TIMELINE_WRITE_CAPABILITY.aliases.pi).toBe("edit_timeline");
    expect(TIMELINE_WRITE_CAPABILITY.additionalAliases.method).toEqual(["undo_timeline_edit"]);
  });

  it("derives the operation from the alias and keeps transport authority out of Pi input", () => {
    const apply = {
      planId: "plan-a",
      baseRevision: "deadbeef",
      summary: "Move a clip",
      operations: [{ kind: "move", clipId: "clip-a", startFrame: 24 }],
    };
    expect(timelineWriteInputForAlias("edit_timeline", apply)).toEqual({ operation: "edit_timeline", ...apply });
    expect(
      timelineWriteInputForAlias("undo_timeline_edit", {
        undoToken: "timeline-undo:v1:receipt-a",
        expectedRevision: "cafebabe",
      }),
    ).toEqual({
      operation: "undo_timeline_edit",
      undoToken: "timeline-undo:v1:receipt-a",
      expectedRevision: "cafebabe",
    });
    expect(
      timelineWritePiInputSchemaForAlias("undo_timeline_edit")?.safeParse({
        undoToken: "timeline-undo:v1:receipt-a",
        expectedRevision: "cafebabe",
        actionHash: "forged",
      }).success,
    ).toBe(false);
  });

  it("exposes only strict scalar write receipts for the matching operation", () => {
    const result = {
      operation: "edit_timeline" as const,
      ok: true,
      revision: "cafebabe",
      applied: true,
      replayed: false,
      undoToken: "timeline-undo:v1:receipt-a",
    };
    expect(projectTimelineWriteResult(result, "edit_timeline")).toEqual(result);
    expect(timelineWriteResultSchema.safeParse({ ...result, timeline: { url: "file:///private.mp4" } }).success)
      .toBe(false);
    expect(timelineWriteResultSchema.safeParse({ ...result, path: "/private/project" }).success).toBe(false);
    expect(() => projectTimelineWriteResult({
      operation: "undo_timeline_edit",
      ok: true,
      undone: true,
      revision: "deadbeef",
    }, "edit_timeline")).toThrow("timeline operation mismatch");
  });
});
