import { describe, expect, it } from "vitest";
import {
  initialVideoDepthJobState,
  isVideoDepthJobTerminal,
  nextVideoDepthJobState,
  TERMINAL_VIDEO_DEPTH_PHASES,
} from "./depthVideoJobState";

const flow = (events: Array<Parameters<typeof nextVideoDepthJobState>[1]>) => {
  let s = initialVideoDepthJobState("j1");
  for (const e of events) s = nextVideoDepthJobState(s, e);
  return s;
};

describe("depth video job state machine", () => {
  it("runs the happy path: idle → download → warm → process → encode → done", () => {
    const s = flow([
      { kind: "start" },
      { kind: "download-progress", doneBytes: 5_000_000, totalBytes: 50_000_000 },
      { kind: "download-done" },
      { kind: "warm-done" },
      { kind: "batch-progress", doneFrames: 32, totalFrames: 96 },
      { kind: "batch-progress", doneFrames: 96, totalFrames: 96 },
      { kind: "batches-done" },
      { kind: "encode-done", assetId: "asset-depth-mp4" },
    ]);
    expect(s.phase).toBe("done");
    expect(s.attempts).toBe(1);
    expect(s.result?.videoAssetId).toBe("asset-depth-mp4");
    expect(s.progress).toBeUndefined();
    expect(isVideoDepthJobTerminal(s)).toBe(true);
  });

  it("attaches pose-json-written when exportPoseJson is on", () => {
    const s = flow([
      { kind: "start" },
      { kind: "download-done" },
      { kind: "warm-done" },
      { kind: "batch-progress", doneFrames: 96, totalFrames: 96 },
      { kind: "batches-done" },
      { kind: "encode-done", assetId: "v" },
      { kind: "pose-json-written", assetId: "p" },
    ]);
    expect(s.phase).toBe("done");
    expect(s.result).toEqual({ videoAssetId: "v", poseAssetId: "p" });
  });

  it("ignores spurious events in wrong phase (no-op reducer)", () => {
    const s = flow([
      { kind: "download-progress", doneBytes: 1, totalBytes: 2 }, // before start: ignored
      { kind: "start" },
      { kind: "warm-done" }, // before download-done: ignored
    ]);
    expect(s.phase).toBe("download-model");
    expect(s.progress).toBeUndefined();
  });

  it("records download progress only while downloading", () => {
    const s = flow([
      { kind: "start" },
      { kind: "download-progress", doneBytes: 1, totalBytes: 2 },
      { kind: "download-done" },
      { kind: "download-progress", doneBytes: 2, totalBytes: 2 },
    ]);
    expect(s.progress).toBeUndefined();
    expect(s.phase).toBe("warming");
  });

  it("records batch progress only while processing", () => {
    const s = flow([
      { kind: "start" },
      { kind: "download-done" },
      { kind: "warm-done" },
      { kind: "batch-progress", doneFrames: 32, totalFrames: 96 },
      { kind: "batches-done" },
      { kind: "encode-done", assetId: "v" },
      { kind: "batch-progress", doneFrames: 96, totalFrames: 96 },
    ]);
    expect(s.progress).toBeUndefined();
  });

  it("cancellation during processing flips to cancelled", () => {
    const s = flow([
      { kind: "start" },
      { kind: "download-done" },
      { kind: "warm-done" },
      { kind: "batch-progress", doneFrames: 32, totalFrames: 96 },
      { kind: "cancel" },
    ]);
    expect(s.phase).toBe("cancelled");
    expect(s.progress).toBeUndefined();
  });

  it("failure in any non-terminal phase flips to failed with error", () => {
    const s = flow([
      { kind: "start" },
      { kind: "download-progress", doneBytes: 100, totalBytes: 1_000 },
      { kind: "fail", code: "download-failed", message: "network", retryable: true },
    ]);
    expect(s.phase).toBe("failed");
    expect(s.error).toEqual({ code: "download-failed", message: "network", retryable: true });
  });

  it("terminal phases ignore further events", () => {
    for (const terminal of TERMINAL_VIDEO_DEPTH_PHASES) {
      const s = { phase: terminal, jobId: "j1", attempts: 1 } as Parameters<typeof nextVideoDepthJobState>[0];
      const next = nextVideoDepthJobState(s, { kind: "cancel" });
      expect(next.phase).toBe(terminal);
    }
  });

  it("does not advance attempts on spurious start without idle", () => {
    const s = flow([{ kind: "start" }, { kind: "start" }, { kind: "download-done" }, { kind: "warm-done" }]);
    expect(s.attempts).toBe(1);
    expect(s.phase).toBe("processing");
  });
});
