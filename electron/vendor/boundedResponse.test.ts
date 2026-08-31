import { describe, expect, it, vi } from "vitest";

import { BoundedResponseError, readBoundedResponseBytes, readBoundedResponseText } from "./boundedResponse";

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

  it("preserves timeout classification even when reader.cancel rejects", async () => {
    const controller = new AbortController();
    let rejectRead!: (error: Error) => void;
    const response = {
      headers: new Headers(),
      body: { getReader: () => ({
        read: () => new Promise((_resolve, reject) => { rejectRead = reject; }),
        cancel: vi.fn(async () => { rejectRead(new Error("reader aborted")); throw new Error("cancel transport failed"); }),
      }) },
    } as unknown as Response;
    const pending = readBoundedResponseText(response, { maxBytes: 32, signal: controller.signal });
    controller.abort(new DOMException("deadline", "TimeoutError"));
    await expect(pending).rejects.toMatchObject({ code: "response_timeout" });
  });
});

describe("readBoundedResponseBytes", () => {
  it("preserves binary bytes without UTF-8 coercion", async () => {
    const expected = Buffer.from([0, 255, 1, 254, 2]);
    const response = new Response(expected, { headers: { "content-type": "audio/mpeg" } });

    await expect(readBoundedResponseBytes(response, { maxBytes: expected.length })).resolves.toEqual(expected);
  });

  it("rejects a chunked binary body as soon as its streamed size exceeds the limit", async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    }));

    await expect(readBoundedResponseBytes(response, { maxBytes: 5 })).rejects.toMatchObject({
      code: "response_too_large",
    });
  });
});
