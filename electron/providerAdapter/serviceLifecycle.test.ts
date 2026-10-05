import { describe, expect, it } from "vitest";
import { AdapterWaitError, awaitAdapterStep } from "./serviceLifecycle";

describe("awaitAdapterStep", () => {
  it("settles at the timeout even when the operation ignores cancellation forever", async () => {
    const run = new AbortController();

    const pending = awaitAdapterStep({
      signal: run.signal,
      now: "2026-08-07T00:00:00.000Z",
      deadlineAt: "2026-08-07T00:01:00.000Z",
      timeoutMs: 5,
      step: "uncooperative provider request",
      operation: () => new Promise(() => {}),
    });

    await expect(pending).rejects.toMatchObject({ reason: "step_timeout" });
  });

  it("aborts the operation signal when a step timeout wins", async () => {
    const run = new AbortController();
    let operationSignal: AbortSignal | undefined;
    const pending = awaitAdapterStep({
      signal: run.signal,
      now: "2026-08-07T00:00:00.000Z",
      deadlineAt: "2026-08-07T00:01:00.000Z",
      timeoutMs: 5,
      step: "compile one model",
      operation: (signal) => {
        operationSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    });

    await expect(pending).rejects.toMatchObject({ reason: "step_timeout" });
    expect(operationSignal?.aborted).toBe(true);
    expect(run.signal.aborted).toBe(false);
  });

  it("aborts the operation signal when the run is cancelled", async () => {
    const run = new AbortController();
    let operationSignal: AbortSignal | undefined;
    const pending = awaitAdapterStep({
      signal: run.signal,
      now: "2026-08-07T00:00:00.000Z",
      deadlineAt: "2026-08-07T00:01:00.000Z",
      timeoutMs: 10_000,
      step: "verify",
      operation: (signal) => {
        operationSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    });

    run.abort();

    await expect(pending).rejects.toMatchObject({ reason: "cancelled" });
    expect(operationSignal?.aborted).toBe(true);
  });
});
