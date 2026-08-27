import { describe, expect, it, vi } from "vitest";

import { BoundedResponseError, readBoundedResponseText } from "./boundedResponse";

describe("readBoundedResponseText", () => {
  it("cancels a streaming response immediately after the hard byte limit", async () => {
    const cancel = vi.fn(async () => {});
    let reads = 0;
    const response = {
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: async () => ({ done: false, value: new Uint8Array(++reads === 1 ? 8 : 9) }),
          cancel,
        }),
      },
    } as unknown as Response;

    const error = await readBoundedResponseText(response, { maxBytes: 16 }).catch((caught) => caught);
    expect(error).toBeInstanceOf(BoundedResponseError);
    expect(error).toMatchObject({ code: "response_too_large" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(String(error)).not.toContain("body");
  });

  it("rejects an oversized Content-Length before reading the body", async () => {
    const read = vi.fn();
    const response = {
      headers: new Headers({ "Content-Length": "999" }),
      body: { getReader: () => ({ read, cancel: vi.fn() }) },
    } as unknown as Response;
    await expect(readBoundedResponseText(response, { maxBytes: 10 })).rejects.toMatchObject({ code: "response_too_large" });
    expect(read).not.toHaveBeenCalled();
  });

  it("cancels a stalled reader when its shared timeout/cancellation signal aborts", async () => {
    const controller = new AbortController();
    const response = new Response(new ReadableStream({ pull: () => new Promise(() => {}) }));
    const pending = readBoundedResponseText(response, { maxBytes: 32, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "response_cancelled" });
  });
});
