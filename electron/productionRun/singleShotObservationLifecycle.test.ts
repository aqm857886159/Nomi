import { describe, expect, it, vi } from "vitest";

import { createSingleShotObservationLifecycle } from "./singleShotObservationLifecycle";

describe("single-shot observation lifecycle", () => {
  it("deduplicates a key and aborts stale work on stop", async () => {
    const lifecycle = createSingleShotObservationLifecycle();
    let release!: () => void;
    const worker = vi.fn(({ signal, isCurrent }: { signal: AbortSignal; isCurrent: () => boolean }) =>
      new Promise<void>((resolve) => {
        expect(signal.aborted).toBe(false);
        expect(isCurrent()).toBe(true);
        release = resolve;
      }));

    const first = lifecycle.run("project:run", worker);
    const duplicate = lifecycle.run("project:run", worker);
    await expect(duplicate).resolves.toBe(false);
    expect(worker).toHaveBeenCalledTimes(1);

    lifecycle.stop();
    expect(lifecycle.isCurrent(0)).toBe(false);
    release();
    await expect(first).resolves.toBe(true);
    expect(lifecycle.activeKeys()).toEqual([]);
  });

  it("allows a fresh epoch to observe the same run after stop", async () => {
    const lifecycle = createSingleShotObservationLifecycle();
    let staleRelease!: () => void;
    const stale = lifecycle.run("project:run", ({ signal, isCurrent }) => new Promise<void>((resolve) => {
      expect(signal.aborted).toBe(false);
      expect(isCurrent()).toBe(true);
      staleRelease = resolve;
    }));
    lifecycle.stop();
    staleRelease();
    await expect(stale).resolves.toBe(true);

    const fresh = lifecycle.run("project:run", ({ signal, isCurrent }) => {
      expect(signal.aborted).toBe(false);
      expect(isCurrent()).toBe(true);
    });
    await expect(fresh).resolves.toBe(true);
    expect(lifecycle.activeKeys()).toEqual([]);
  });
});
