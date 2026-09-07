import { describe, expect, it, vi } from "vitest";
import { runVideoDepthBatches, type VideoDepthBatchHooks } from "./videoDepthBatchRunner";
import { VIDEO_DEPTH_BATCH_FRAMES } from "./workerProtocol";

function hooks(over: Partial<VideoDepthBatchHooks>): VideoDepthBatchHooks {
  return {
    warm: vi.fn(async () => {}),
    processBatch: vi.fn(async () => {}),
    onProgress: vi.fn(),
    shouldCancel: () => false,
    ...over,
  };
}

describe("runVideoDepthBatches", () => {
  it("warms once, runs every frame in bounded batches, and reports progress", async () => {
    const h = hooks({});
    const result = await runVideoDepthBatches(100, h, VIDEO_DEPTH_BATCH_FRAMES);
    expect(result).toEqual({ ok: true, batchesCompleted: 4, doneFrames: 100 });
    expect(h.warm).toHaveBeenCalledTimes(1);
    const batches = (h.processBatch as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(batches.map((b: { firstFrameIndex: number; frameCount: number }) => b.firstFrameIndex)).toEqual([0, 32, 64, 96]);
    expect(batches.map((b: { frameCount: number }) => b.frameCount)).toEqual([32, 32, 32, 4]);
    expect((h.onProgress as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      [32, 100],
      [64, 100],
      [96, 100],
      [100, 100],
    ]);
  });

  it("runs zero frames without calling warm", async () => {
    const h = hooks({});
    const result = await runVideoDepthBatches(0, h);
    expect(result).toEqual({ ok: true, batchesCompleted: 0, doneFrames: 0 });
    expect(h.warm).not.toHaveBeenCalled();
  });

  it("returns an error result for invalid totals", async () => {
    const h = hooks({});
    const result = await runVideoDepthBatches(-3, h);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("error");
  });

  it("propagates warm failures as error results without running batches", async () => {
    const h = hooks({ warm: vi.fn(async () => { throw new Error("no gpu"); }) });
    const result = await runVideoDepthBatches(10, h);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "error") {
      expect((result.error as Error).message).toBe("no gpu");
    }
    expect(h.processBatch).not.toHaveBeenCalled();
  });

  it("propagates batch failures and stops early", async () => {
    const h = hooks({
      processBatch: vi.fn(async (ctx: { batchIndex: number }) => {
        if (ctx.batchIndex === 1) throw new Error("boom");
      }),
    });
    const result = await runVideoDepthBatches(100, h);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("error");
    // progress only reported for the completed first batch
    expect((h.onProgress as ReturnType<typeof vi.fn>).mock.calls).toEqual([[32, 100]]);
  });

  it("cancels cleanly between batches (and before warm when already requested)", async () => {
    let cancelled = false;
    const h = hooks({
      processBatch: vi.fn(async () => {
        cancelled = true; // cancel takes effect after the current batch finishes
      }),
      shouldCancel: () => cancelled,
    });
    const result = await runVideoDepthBatches(100, h);
    expect(result).toEqual({ ok: false, reason: "cancelled" });
    expect((h.onProgress as ReturnType<typeof vi.fn>).mock.calls).toEqual([[32, 100]]);

    const already = hooks({ shouldCancel: () => true });
    expect(await runVideoDepthBatches(10, already)).toEqual({ ok: false, reason: "cancelled" });
    expect(already.warm).not.toHaveBeenCalled();
  });

  it("does not call processBatch after cancellation was requested mid-batch sequence", async () => {
    let calls = 0;
    const h = hooks({
      processBatch: vi.fn(async () => {
        calls += 1;
      }),
      shouldCancel: () => calls >= 2,
    });
    const result = await runVideoDepthBatches(200, h);
    expect(result).toEqual({ ok: false, reason: "cancelled" });
    expect(calls).toBe(2);
  });
});
