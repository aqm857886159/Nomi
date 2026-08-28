import { describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({
  active: vi.fn(), resolve: vi.fn(), fail: vi.fn(),
}));
vi.mock("../catalog/comfyuiCandidateLifecycle", () => ({
  activeComfyCandidateRevision: lifecycle.active,
  resolveComfyStagedCandidate: lifecycle.resolve,
  failComfyCandidateRevision: lifecycle.fail,
}));

import { cancelComfyCandidateTest, runComfyCandidateTest } from "./comfyCandidateTest";
import type { TaskResult } from "../runtime";

const payload = {
  vendor: "candidate-vendor",
  request: { kind: "text_to_video" as const, prompt: "test", extras: {
    modelKey: "workflow-1", comfyCertificationRevisionId: "revision-1", certifyOutput: true,
  } },
};

describe("Comfy candidate test lifecycle", () => {
  it("deduplicates repeated clicks and returns only after atomic promotion", async () => {
    lifecycle.active.mockReset().mockReturnValueOnce(null).mockReturnValue({ vendorKey: "candidate-vendor", modelKey: "workflow-1" });
    lifecycle.resolve.mockReset(); lifecycle.fail.mockReset();
    let finish!: (value: TaskResult) => void;
    const runTask = vi.fn(() => new Promise<TaskResult>((resolve) => { finish = resolve; }));
    const deps = { runTask, fetchTaskResult: vi.fn() };
    const first = runComfyCandidateTest(payload, deps);
    const second = runComfyCandidateTest(payload, deps);
    expect(second).toBe(first);
    finish({ id: "task-1", kind: "text_to_video", status: "succeeded", assets: [{ type: "video", url: "local" }], raw: {} });
    await expect(first).resolves.toMatchObject({ ok: true, revisionId: "revision-1" });
    expect(runTask).toHaveBeenCalledOnce();
    expect(lifecycle.fail).not.toHaveBeenCalled();
  });

  it("returns an idempotent success after the same revision already promoted", async () => {
    lifecycle.active.mockReset().mockReturnValue({ vendorKey: "candidate-vendor", modelKey: "workflow-1" });
    const runTask = vi.fn();
    await expect(runComfyCandidateTest(payload, { runTask, fetchTaskResult: vi.fn() })).resolves.toMatchObject({ ok: true });
    expect(runTask).not.toHaveBeenCalled();
  });

  it("reports a stale revision without cleaning a newer candidate", async () => {
    lifecycle.active.mockReset().mockReturnValue(null);
    lifecycle.resolve.mockReset().mockImplementation(() => { throw new Error("stale"); });
    lifecycle.fail.mockReset();
    await expect(runComfyCandidateTest(payload, { runTask: vi.fn(), fetchTaskResult: vi.fn() }))
      .resolves.toMatchObject({ ok: false, reasonCode: "candidate_stale" });
    expect(lifecycle.fail).not.toHaveBeenCalled();
  });

  it.each(["failed", "throw", "poll", "cancel"])("cleans the exact staged revision on %s", async (failure) => {
    lifecycle.active.mockReset().mockReturnValue(null); lifecycle.resolve.mockReset(); lifecycle.fail.mockReset();
    const runTask = failure === "throw" ? vi.fn().mockRejectedValue(new Error("network"))
      : vi.fn().mockResolvedValue({ id: "task-1", kind: "text_to_video", status: failure === "poll" || failure === "cancel" ? "queued" : "failed", assets: [], raw: {} });
    const fetchTaskResult = failure === "poll" ? vi.fn().mockRejectedValue(new Error("poll network")) : vi.fn();
    const sleep = failure === "cancel" ? vi.fn((_ms: number, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })) : vi.fn().mockResolvedValue(undefined);
    const pending = runComfyCandidateTest(payload, { runTask, fetchTaskResult, sleep, timeoutMs: 2_000 });
    if (failure === "cancel") {
      await vi.waitFor(() => expect(sleep).toHaveBeenCalled());
      expect(cancelComfyCandidateTest({ revisionId: "revision-1" })).toEqual({ ok: true });
    }
    await expect(pending).resolves.toMatchObject({ ok: false, revisionId: "revision-1" });
    expect(lifecycle.fail).toHaveBeenCalledWith(expect.objectContaining({ revisionId: "revision-1" }));
  });

  it("times out a provider submission that never settles and cleans the exact staged revision", async () => {
    lifecycle.active.mockReset().mockReturnValue(null); lifecycle.resolve.mockReset(); lifecycle.fail.mockReset();
    const runTask = vi.fn(() => new Promise<TaskResult>(() => undefined));

    await expect(runComfyCandidateTest(payload, {
      runTask,
      fetchTaskResult: vi.fn(),
      timeoutMs: 10,
    })).resolves.toMatchObject({ ok: false, revisionId: "revision-1", reasonCode: "candidate_timeout" });
    expect(lifecycle.fail).toHaveBeenCalledWith(expect.objectContaining({ revisionId: "revision-1" }));
  });

  it("cancels a provider submission that has not returned without leaking its in-flight revision", async () => {
    lifecycle.active.mockReset().mockReturnValue(null); lifecycle.resolve.mockReset(); lifecycle.fail.mockReset();
    const runTask = vi.fn(() => new Promise<TaskResult>(() => undefined));
    const first = runComfyCandidateTest(payload, { runTask, fetchTaskResult: vi.fn(), timeoutMs: 2_000 });
    await vi.waitFor(() => expect(runTask).toHaveBeenCalledOnce());
    expect(cancelComfyCandidateTest({ revisionId: "revision-1" })).toEqual({ ok: true });
    await expect(first).resolves.toMatchObject({ ok: false, revisionId: "revision-1", reasonCode: "candidate_cancelled" });
    expect(lifecycle.fail).toHaveBeenCalledWith(expect.objectContaining({ revisionId: "revision-1" }));

    const secondRun = vi.fn().mockResolvedValue({
      id: "task-2", kind: "text_to_video", status: "failed", assets: [], raw: {},
    } satisfies TaskResult);
    await expect(runComfyCandidateTest(payload, { runTask: secondRun, fetchTaskResult: vi.fn() }))
      .resolves.toMatchObject({ ok: false });
    expect(secondRun).toHaveBeenCalledOnce();
  });
});
