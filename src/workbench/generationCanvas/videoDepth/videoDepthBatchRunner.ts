/**
 * Depth video node — batch run orchestration (pure, dependency-injected).
 *
 * The GPU-heavy bits (onnxruntime-web + MediaPipe inference) are injected as
 * warm/processBatch functions so the orchestration itself — warm-once, serial
 * batch iteration, bounded batches, honest progress, cancellation checkpoints
 * between batches — is fully unit-testable without a GPU or a real worker.
 */

export type VideoDepthBatchHooks = {
  /** Load + warm the models once per run. Throw to fail fast. */
  warm: () => Promise<void>;
  /** Process one batch (must resolve once all frames in the batch are done). */
  processBatch: (ctx: {
    batchId: string;
    batchIndex: number;
    firstFrameIndex: number;
    frameCount: number;
  }) => Promise<void>;
  /** Progress callback: doneFrames/totalFrames after each completed batch. */
  onProgress: (doneFrames: number, totalFrames: number) => void;
  /** Cancellation probe — checked between batches (and before warm). */
  shouldCancel: () => boolean;
};

export type VideoDepthBatchRunResult =
  | { ok: true; batchesCompleted: number; doneFrames: number }
  | { ok: false; reason: "cancelled" }
  | { ok: false; reason: "error"; error: unknown };

/**
 * Serial orchestration of a frame-to-depth run.
 *  - warms once (skipped when the hooks provider already warmed);
 *  - iterates [0, totalFrames) in fixed batches;
 *  - reports progress after every batch;
 *  - aborts cleanly between batches when shouldCancel() flips.
 */
export async function runVideoDepthBatches(
  totalFrames: number,
  hooks: VideoDepthBatchHooks,
  batchSize = 32,
): Promise<VideoDepthBatchRunResult> {
  if (!Number.isInteger(totalFrames) || totalFrames < 0) {
    return { ok: false, reason: "error", error: new RangeError(`totalFrames must be a non-negative integer, got ${totalFrames}`) };
  }
  if (totalFrames === 0) return { ok: true, batchesCompleted: 0, doneFrames: 0 };
  if (hooks.shouldCancel()) return { ok: false, reason: "cancelled" };

  try {
    await hooks.warm();
  } catch (err) {
    return { ok: false, reason: "error", error: err };
  }
  if (hooks.shouldCancel()) return { ok: false, reason: "cancelled" };

  let doneFrames = 0;
  let batchIndex = 0;
  while (doneFrames < totalFrames) {
    if (hooks.shouldCancel()) return { ok: false, reason: "cancelled" };
    const frameCount = Math.min(batchSize, totalFrames - doneFrames);
    const batchId = `batch-${batchIndex}`;
    try {
      await hooks.processBatch({ batchId, batchIndex, firstFrameIndex: doneFrames, frameCount });
    } catch (err) {
      return { ok: false, reason: "error", error: err };
    }
    doneFrames += frameCount;
    hooks.onProgress(doneFrames, totalFrames);
    batchIndex += 1;
  }
  return { ok: true, batchesCompleted: batchIndex, doneFrames };
}
