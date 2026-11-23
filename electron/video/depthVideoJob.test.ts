import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pendingBytes: 49_600_000,
  ensureCalls: 0,
  ensureImpl: null as null | ((options: { onProgress?: (p: { assetId: string; fileName: string; doneBytes: number; totalBytes: number }) => void; signal?: AbortSignal }) => Promise<void>),
  cleanupCalls: 0,
  frameCount: 2,
}));

vi.mock("../export/ffmpegRunner", () => ({
  resolveFfmpegPath: () => "/mock/ffmpeg",
}));

vi.mock("../export/mediaProbe", () => ({
  resolveFfprobePath: () => "/mock/ffprobe",
}));

vi.mock("../export/ensureExecutable", () => ({
  ensureExecutable: () => undefined,
}));

vi.mock("./extractVideoFrame", () => ({
  resolveVideoLocalPath: vi.fn(async () => ({
    filePath: "/mock/source.mp4",
    cleanup: () => {
      state.cleanupCalls += 1;
    },
  })),
}));

vi.mock("./depthVideoModelCache", () => ({
  pendingVideoDepthDownloadBytes: () => state.pendingBytes,
  ensureVideoDepthModels: vi.fn(async (_assets: unknown, options: { onProgress?: (p: { assetId: string; fileName: string; doneBytes: number; totalBytes: number }) => void; signal?: AbortSignal } = {}) => {
    state.ensureCalls += 1;
    if (state.ensureImpl) return state.ensureImpl(options);
  }),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn((binary: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: PassThrough;
        kill: () => boolean;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new PassThrough();
      child.kill = vi.fn(() => {
        queueMicrotask(() => child.emit("close", 1));
        return true;
      });

      queueMicrotask(() => {
        if (binary.includes("ffprobe")) {
          child.stdout.emit(
            "data",
            JSON.stringify({
              streams: [{ width: 1280, height: 720 }],
              format: { duration: "1.0" },
            }),
          );
          child.emit("close", 0);
          return;
        }
        const lastArg = args[args.length - 1] ?? "";
        if (lastArg.includes("f_%04d.jpg")) {
          const outDir = path.dirname(lastArg);
          for (let i = 1; i <= state.frameCount; i += 1) {
            fs.writeFileSync(path.join(outDir, `f_${String(i).padStart(4, "0")}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
          }
          child.emit("close", 0);
          return;
        }
        child.stdin.on("finish", () => {
          fs.writeFileSync(lastArg, Buffer.from([0, 0, 0, 24]));
          child.emit("close", 0);
        });
      });
      return child;
    }),
  };
});

import {
  VideoDepthJobError,
  cancelVideoDepthJob,
  disposeAllVideoDepthJobs,
  prepareVideoDepthJob,
} from "./depthVideoJob";

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("depthVideoJob per-project mutex before download and extraction", () => {
  beforeEach(() => {
    disposeAllVideoDepthJobs();
    state.pendingBytes = 49_600_000;
    state.ensureCalls = 0;
    state.ensureImpl = null;
    state.cleanupCalls = 0;
    state.frameCount = 2;
  });

  afterEach(() => {
    disposeAllVideoDepthJobs();
  });

  it("rejects a second prepare in the same project immediately while weight download is still running, without starting a second download", async () => {
    const downloadEntered = deferred<void>();
    const downloadGate = deferred<void>();
    state.ensureImpl = async () => {
      downloadEntered.resolve();
      await downloadGate.promise;
    };

    const first = prepareVideoDepthJob(
      { projectId: "proj-1", nodeId: "node-1", sourceUrl: "nomi-local://asset/proj-1/a.mp4" },
      () => undefined,
    );
    await downloadEntered.promise;

    const second = prepareVideoDepthJob(
      { projectId: "proj-1", nodeId: "node-2", sourceUrl: "nomi-local://asset/proj-1/a.mp4" },
      () => undefined,
    );
    second.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const callsDuringFirstDownload = state.ensureCalls;
    downloadGate.resolve();
    const prepared = await first;
    cancelVideoDepthJob({ jobId: prepared.jobId });
    await second
      .then((res) => cancelVideoDepthJob({ jobId: res.jobId }))
      .catch(() => undefined);

    expect(callsDuringFirstDownload).toBe(1);
    await expect(second).rejects.toMatchObject({
      name: "VideoDepthJobError",
      code: "already-running",
      retryable: false,
    });
    expect(prepared.totalFrames).toBe(2);
  });

  it("releases the project lock when weight download fails so retrying immediately succeeds", async () => {
    let attempt = 0;
    state.ensureImpl = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("network reset during weight stream");
    };

    await expect(
      prepareVideoDepthJob(
        { projectId: "proj-1", nodeId: "node-1", sourceUrl: "nomi-local://asset/proj-1/a.mp4" },
        () => undefined,
      ),
    ).rejects.toBeInstanceOf(VideoDepthJobError);
    expect(state.cleanupCalls).toBe(1);

    const retry = await prepareVideoDepthJob(
      { projectId: "proj-1", nodeId: "node-2", sourceUrl: "nomi-local://asset/proj-1/a.mp4" },
      () => undefined,
    );
    expect(retry.totalFrames).toBe(2);
    expect(state.ensureCalls).toBe(2);
    cancelVideoDepthJob({ jobId: retry.jobId });
  });

  it("aborts in-flight weight download and releases the project lock when cancelled mid-download", async () => {
    const downloadEntered = deferred<void>();
    const fallbackRelease = deferred<void>();
    let observedSignal: AbortSignal | undefined;
    state.ensureImpl = ({ signal }) =>
      new Promise<void>((resolve, reject) => {
        observedSignal = signal;
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        void fallbackRelease.promise.then(resolve);
        downloadEntered.resolve();
      });

    let emittedJobId = "";
    const first = prepareVideoDepthJob(
      { projectId: "proj-1", nodeId: "node-1", sourceUrl: "nomi-local://asset/proj-1/a.mp4" },
      (event) => {
        if (event.jobId) emittedJobId = event.jobId;
      },
    );
    first.catch(() => undefined);
    await downloadEntered.promise;
    expect(emittedJobId).not.toBe("");

    cancelVideoDepthJob({ jobId: "node-1" });
    try {
      expect(observedSignal?.aborted).toBe(true);
      await expect(first).rejects.toThrow();
    } finally {
      fallbackRelease.resolve();
      await first.catch(() => undefined);
    }

    state.ensureImpl = null;
    const second = await prepareVideoDepthJob(
      { projectId: "proj-1", nodeId: "node-2", sourceUrl: "nomi-local://asset/proj-1/a.mp4" },
      () => undefined,
    );
    expect(second.totalFrames).toBe(2);
    cancelVideoDepthJob({ jobId: second.jobId });
  });

  it("scopes the mutex per project so another project is not blocked while proj-1 downloads", async () => {
    const downloadEntered = deferred<void>();
    const downloadGate = deferred<void>();
    state.ensureImpl = async () => {
      if (state.ensureCalls === 1) {
        downloadEntered.resolve();
        await downloadGate.promise;
      }
    };

    const p1 = prepareVideoDepthJob(
      { projectId: "proj-1", nodeId: "node-1", sourceUrl: "nomi-local://asset/proj-1/a.mp4" },
      () => undefined,
    );
    await downloadEntered.promise;

    const p2 = await prepareVideoDepthJob(
      { projectId: "proj-2", nodeId: "node-9", sourceUrl: "nomi-local://asset/proj-2/b.mp4" },
      () => undefined,
    );
    expect(p2.totalFrames).toBe(2);
    cancelVideoDepthJob({ jobId: p2.jobId });

    downloadGate.resolve();
    const prepared1 = await p1;
    cancelVideoDepthJob({ jobId: prepared1.jobId });
  });
});
