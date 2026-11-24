import { describe, expect, it, vi } from "vitest";
import { exponentialBackoffMs, pollWithBackoff, retryWithBackoff } from "./retryPolicy";

describe("shared retry policy", () => {
  it("uses the requested attempts and forwards the last error by identity", async () => {
    const first = Object.freeze(new TypeError("first"));
    const last = Object.freeze(new Error("last"));
    const action = vi.fn().mockRejectedValueOnce(first).mockRejectedValueOnce(first).mockRejectedValueOnce(last);
    const sleep = vi.fn(async () => undefined);

    await expect(retryWithBackoff(action, {
      retries: 2, initialDelayMs: 4, maxDelayMs: 6, sleep,
    })).rejects.toBe(last);
    expect(action.mock.calls.flat()).toEqual([1, 2, 3]);
    expect(sleep.mock.calls.flat()).toEqual([4, 6]);
    expect(exponentialBackoffMs(4, 2, 6)).toBe(6);
  });

  it("stops on AbortError without delaying or repeating", async () => {
    const cause = new DOMException("cancelled", "AbortError");
    const action = vi.fn().mockRejectedValue(cause);
    const sleep = vi.fn(async () => undefined);

    await expect(retryWithBackoff(action, { retries: 3, initialDelayMs: 1, sleep })).rejects.toBe(cause);
    expect(action).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("preserves the abort reason before an attempt and during an injected wait", async () => {
    const controller = new AbortController();
    const reason = new Error("owner stopped");
    const action = vi.fn().mockRejectedValue(new Error("retryable"));
    const sleep = vi.fn(() => new Promise<void>(() => controller.abort(reason)));
    const options = { retries: 3, initialDelayMs: 1, signal: controller.signal, sleep };

    await expect(retryWithBackoff(action, options)).rejects.toBe(reason);
    await expect(retryWithBackoff(action, options)).rejects.toBe(reason);
    expect(action).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("cancels the pending timer and leaves it unrefed while waiting", async () => {
    const controller = new AbortController();
    const reason = new Error("stop waiting");
    const action = vi.fn().mockRejectedValue(new Error("retryable"));
    const schedule = vi.spyOn(globalThis, "setTimeout");
    const clear = vi.spyOn(globalThis, "clearTimeout");
    try {
      const result = retryWithBackoff(action, {
        retries: 3, initialDelayMs: 60_000, signal: controller.signal, unref: true,
      });
      const rejected = expect(result).rejects.toBe(reason);
      await Promise.resolve();
      await Promise.resolve();
      const timer = schedule.mock.results[0].value;
      expect(timer.hasRef()).toBe(false);

      controller.abort(reason);
      await rejected;
      expect(clear).toHaveBeenCalledWith(timer);
      expect(action).toHaveBeenCalledTimes(1);
    } finally {
      schedule.mockRestore();
      clear.mockRestore();
    }
  });

  it("clips a retry wait and does not start another action once its horizon is spent", async () => {
    let clock = 0;
    const failure = new Error("offline");
    const action = vi.fn(async () => { clock += 5; throw failure; });
    const sleep = vi.fn(async (ms: number) => { clock += ms; });

    await expect(retryWithBackoff(action, {
      retries: 3, initialDelayMs: 10, horizonMs: 7, sleep, now: () => clock,
    })).rejects.toBe(failure);
    expect(sleep.mock.calls.flat()).toEqual([2]);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("uses action time in the horizon, clips the wait, and returns the final pending result", async () => {
    let clock = 0;
    const read = vi.fn(() => { clock += 5; return clock; });
    const sleep = vi.fn(async (ms: number) => { clock += ms; });

    await expect(pollWithBackoff(read, () => true, {
      initialDelayMs: 10, horizonMs: 7, sleep, now: () => clock,
    })).resolves.toBe(12);
    expect(sleep.mock.calls.flat()).toEqual([2]);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
