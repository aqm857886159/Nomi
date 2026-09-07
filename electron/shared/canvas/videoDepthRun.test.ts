import { describe, expect, it } from "vitest";
import {
  estimateVideoDepthEtaSeconds,
  initialVideoDepthRunState,
  isTerminalVideoDepthPhase,
  nextVideoDepthRunState,
  type VideoDepthPhase,
  type VideoDepthRunEvent,
  type VideoDepthRunState,
} from "./videoDepthRun";

function reduce(events: VideoDepthRunEvent[], from = initialVideoDepthRunState("job-1")): VideoDepthRunState {
  return events.reduce(nextVideoDepthRunState, from);
}

describe("video depth run reducer", () => {
  it("walks the happy path to a result", () => {
    const state = reduce([
      { kind: "enter", phase: "downloading" },
      { kind: "bytes", doneBytes: 10, totalBytes: 50 },
      { kind: "enter", phase: "extracting" },
      { kind: "enter", phase: "warming" },
      { kind: "enter", phase: "processing" },
      { kind: "frames", doneFrames: 32, totalFrames: 96, etaSeconds: 12 },
      { kind: "enter", phase: "encoding" },
      { kind: "done", url: "nomi-local://asset/p/depth.mp4", assetId: "a1" },
    ]);
    expect(state.phase).toBe("done");
    expect(state.result).toEqual({ url: "nomi-local://asset/p/depth.mp4", assetId: "a1" });
    expect(state.progress).toBeUndefined();
  });

  it("drops progress that belongs to a different phase", () => {
    // 下载阶段收到帧进度 = 编排 bug；显示出来会让用户以为已经在推理了。
    const downloading = reduce([{ kind: "enter", phase: "downloading" }, { kind: "frames", doneFrames: 1, totalFrames: 2, etaSeconds: null }]);
    expect(downloading.progress).toBeUndefined();
    const processing = reduce([{ kind: "enter", phase: "processing" }, { kind: "bytes", doneBytes: 1, totalBytes: 2 }]);
    expect(processing.progress).toBeUndefined();
  });

  it("clears progress on every phase change", () => {
    const state = reduce([
      { kind: "enter", phase: "processing" },
      { kind: "frames", doneFrames: 5, totalFrames: 10, etaSeconds: 3 },
      { kind: "enter", phase: "encoding" },
    ]);
    expect(state.progress).toBeUndefined();
  });

  it("absorbs late events after a terminal phase", () => {
    // 真实竞态：取消发出去时最后一批还在 worker 里跑，它的进度会晚一步到。
    const cancelled = reduce([
      { kind: "enter", phase: "processing" },
      { kind: "cancel" },
      { kind: "frames", doneFrames: 64, totalFrames: 96, etaSeconds: 8 },
      { kind: "done", url: "x" },
    ]);
    expect(cancelled.phase).toBe("cancelled");
    expect(cancelled.result).toBeUndefined();
    expect(cancelled.progress).toBeUndefined();
  });

  it("records an actionable failure and stays there", () => {
    const failed = reduce([
      { kind: "enter", phase: "warming" },
      { kind: "fail", code: "webgpu-unavailable", message: "no adapter", retryable: false },
      { kind: "enter", phase: "processing" },
    ]);
    expect(failed.phase).toBe("failed");
    expect(failed.error).toEqual({ code: "webgpu-unavailable", message: "no adapter", retryable: false });
  });

  it("knows which phases are terminal", () => {
    const terminal: VideoDepthPhase[] = ["done", "failed", "cancelled"];
    const running: VideoDepthPhase[] = ["idle", "downloading", "extracting", "warming", "processing", "encoding"];
    expect(terminal.every(isTerminalVideoDepthPhase)).toBe(true);
    expect(running.some(isTerminalVideoDepthPhase)).toBe(false);
  });
});

describe("estimateVideoDepthEtaSeconds", () => {
  it("stays silent until enough frames were actually measured", () => {
    // 头几帧含 shader 编译，快慢差一个数量级；早报会给一个会跳的假数字。
    for (const doneFrames of [0, 1, 2, 3]) {
      expect(estimateVideoDepthEtaSeconds({ doneFrames, totalFrames: 100, elapsedMsSinceFirstFrame: 1000 })).toBeNull();
    }
  });

  it("extrapolates from measured per-frame cost, not a constant", () => {
    expect(
      estimateVideoDepthEtaSeconds({ doneFrames: 10, totalFrames: 110, elapsedMsSinceFirstFrame: 2_000 }),
    ).toBe(20);
    // 同样的进度、机器慢一倍 → 预估也翻倍。硬编码的常量做不到这件事。
    expect(
      estimateVideoDepthEtaSeconds({ doneFrames: 10, totalFrames: 110, elapsedMsSinceFirstFrame: 4_000 }),
    ).toBe(40);
  });

  it("reports nothing once every frame is done", () => {
    expect(estimateVideoDepthEtaSeconds({ doneFrames: 100, totalFrames: 100, elapsedMsSinceFirstFrame: 5_000 })).toBeNull();
  });
});
