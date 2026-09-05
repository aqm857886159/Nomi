import { describe, expect, it } from "vitest";

import {
  EXPORT_READ_CAPABILITY,
  EXPORT_WRITE_CAPABILITY,
  exportReadInputForAlias,
  exportReadResultSchema,
  exportWriteInputForAlias,
  exportWriteResultSchema,
} from "./exportCapabilities";

describe("export capability contracts", () => {
  it("separates read facts from approved task mutation", () => {
    expect(EXPORT_READ_CAPABILITY.effect).toBe("read");
    expect(EXPORT_READ_CAPABILITY.effectClass).toBe("reversible_local");
    expect(EXPORT_WRITE_CAPABILITY.effect).toBe("destructive");
    expect(EXPORT_WRITE_CAPABILITY.effectClass).toBe("irreversible");
    expect(exportReadInputForAlias("inspect_export_job", { jobId: "job-1" })).toEqual({
      operation: "inspect_export_job",
      jobId: "job-1",
    });
    expect(exportWriteInputForAlias("cancel_export_job", { jobId: "job-1" })).toEqual({
      operation: "cancel_export_job",
      jobId: "job-1",
    });
  });

  it("requires an exact Timeline revision for export start", () => {
    expect(() => exportWriteInputForAlias("export_timeline", { resolution: "1080p" })).toThrow();
    expect(
      exportWriteInputForAlias("export_timeline", {
        expectedRevision: "timeline-revision-1",
        resolution: "1080p",
      }),
    ).toEqual({
      operation: "export_timeline",
      expectedRevision: "timeline-revision-1",
      resolution: "1080p",
    });
  });

  it("rejects path-bearing and copied lifecycle projections", () => {
    const inspect = {
      operation: "inspect_export_job",
      jobId: "job-1",
      status: "rendering",
      progress: { ratio: 0.5, stage: "rendering" },
      cancellable: true,
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:01:00.000Z",
      output: { available: false },
      warningCount: 0,
      manifestIntegrity: "canonical",
    } as const;
    expect(exportReadResultSchema.safeParse(inspect).success).toBe(true);
    expect(exportReadResultSchema.safeParse({ ...inspect, outputPath: "/private/output.mp4" }).success).toBe(false);
    expect(exportReadResultSchema.safeParse({ ...inspect, providerReceipt: "secret" }).success).toBe(false);

    const accepted = {
      operation: "export_timeline",
      accepted: true,
      jobId: "job-1",
      backend: "filtergraph",
      timelineRevision: "timeline-revision-1",
      durationFrames: 90,
      profile: { aspectRatio: "16:9", resolution: "1080p", quality: "standard" },
    } as const;
    expect(exportWriteResultSchema.safeParse(accepted).success).toBe(true);
    expect(exportWriteResultSchema.safeParse({ ...accepted, status: "queued" }).success).toBe(false);
    expect(exportWriteResultSchema.safeParse({ ...accepted, etaSeconds: 30 }).success).toBe(false);
  });
});
