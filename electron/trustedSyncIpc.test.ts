import { describe, expect, it, vi } from "vitest";
import { registerTrustedSyncIpc } from "./trustedSyncIpc";

describe("registerTrustedSyncIpc", () => {
  it("fails closed before a sync mutation handler sees an untrusted request", () => {
    let listener: ((event: { returnValue?: unknown }, payload: unknown) => void) | undefined;
    const handler = vi.fn();
    registerTrustedSyncIpc(
      {
        on: (_channel: string, next: (...args: unknown[]) => unknown) => {
          listener = next as typeof listener;
        },
      } as never,
      "catalog:write",
      handler,
      () => {
        throw new Error("untrusted");
      },
    );
    const event: { returnValue?: unknown } = {};
    listener?.(event, { enabled: true });
    expect(handler).not.toHaveBeenCalled();
    expect(event.returnValue).toEqual({ ok: false, error: "untrusted" });
  });

  it("invokes a trusted sync handler and returns its value", () => {
    let listener: ((event: { returnValue?: unknown }, payload: number) => void) | undefined;
    registerTrustedSyncIpc(
      {
        on: (_channel: string, next: (...args: unknown[]) => unknown) => {
          listener = next as typeof listener;
        },
      } as never,
      "catalog:write",
      (value: number) => value + 1,
      () => undefined,
    );
    const event: { returnValue?: unknown } = {};
    listener?.(event, 4);
    expect(event.returnValue).toEqual({ ok: true, value: 5 });
  });
});
