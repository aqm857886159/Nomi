import { describe, expect, it } from "vitest";

import {
  TIMELINE_READ_CAPABILITY,
  projectTimelineReadResult,
  timelineReadResultSchema,
  timelineReadInputForAlias,
  timelineReadPiInputSchemaForAlias,
} from "./timelineRead";

describe("timeline.read capability contract", () => {
  it("owns the three strict Pi projections", () => {
    expect(TIMELINE_READ_CAPABILITY.id).toBe("timeline.read");
    expect(TIMELINE_READ_CAPABILITY.effect).toBe("read");
    expect(TIMELINE_READ_CAPABILITY.approval).toBe("none");
    expect(TIMELINE_READ_CAPABILITY.aliases.pi).toBe("read_timeline");
    expect(TIMELINE_READ_CAPABILITY.additionalAliases.pi).toEqual([
      "inspect_timeline_range",
      "propose_edit_plan",
    ]);
    expect(timelineReadInputForAlias("read_timeline", {})).toEqual({ operation: "read_timeline" });
    expect(
      timelineReadInputForAlias("inspect_timeline_range", { startFrame: 12, endFrame: 24 }),
    ).toEqual({ operation: "inspect_timeline_range", startFrame: 12, endFrame: 24 });
    expect(timelineReadPiInputSchemaForAlias("read_timeline")?.safeParse({ extra: true }).success).toBe(false);
  });

  it("validates a bounded plan preview without accepting unknown operation fields", () => {
    const schema = timelineReadPiInputSchemaForAlias("propose_edit_plan");
    const plan = {
      planId: "plan-a",
      baseRevision: "deadbeef",
      summary: "Move the second clip",
      operations: [{ kind: "move", clipId: "clip-b", startFrame: 72 }],
    };
    expect(schema?.safeParse(plan).success).toBe(true);
    expect(schema?.safeParse({ ...plan, operations: [{ ...plan.operations[0], hidden: true }] }).success).toBe(false);
    expect(schema?.safeParse({ ...plan, operations: [] }).success).toBe(false);
  });

  it("keeps public Timeline results strict and bound to the requested operation", () => {
    const result = {
      operation: "read_timeline" as const,
      revision: "deadbeef",
      fps: 30,
      scale: 1,
      playheadFrame: 0,
      durationFrames: 24,
      valid: true,
      tracks: [{
        id: "video-track",
        type: "video" as const,
        label: "Video",
        clips: [{
          id: "clip-a",
          type: "video" as const,
          trackId: "video-track",
          sourceNodeId: "node-a",
          label: "A",
          startFrame: 0,
          endFrame: 24,
          durationFrames: 24,
          sourceWindow: { startFrame: 0, endFrame: 24 },
          sourceAvailable: true,
        }],
      }],
      textClips: [],
      transitions: [],
    };
    expect(projectTimelineReadResult(result, "read_timeline")).toEqual(result);
    expect(timelineReadResultSchema.safeParse({ ...result, path: "/private/project" }).success).toBe(false);
    expect(timelineReadResultSchema.safeParse({
      ...result,
      tracks: [{ ...result.tracks[0], clips: [{ ...result.tracks[0].clips[0], url: "file:///private.mp4" }] }],
    }).success).toBe(false);
    expect(() => projectTimelineReadResult({
      operation: "inspect_timeline_range",
      revision: "deadbeef",
      startFrame: 0,
      endFrame: 24,
      tracks: [],
      textClips: [],
    }, "read_timeline")).toThrow("timeline operation mismatch");
  });
});
