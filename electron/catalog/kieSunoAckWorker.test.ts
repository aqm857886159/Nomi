import { describe, expect, it } from "vitest";
import worker, { ACK_PATH } from "../../worker";

describe("KIE Suno callback ACK worker", () => {
  it("acknowledges POST without consuming or forwarding the body", async () => {
    let consumed = false;
    const request = new Request(`https://nomiaqm.com${ACK_PATH}`, {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("secret-looking callback"));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    Object.defineProperty(request, "text", { value: () => { consumed = true; return Promise.resolve(""); } });
    const response = await worker.fetch(request, {});
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "received" });
    expect(consumed).toBe(false);
  });

  it("rejects non-POST methods", async () => {
    const response = await worker.fetch(new Request(`https://nomiaqm.com${ACK_PATH}`), {});
    expect(response.status).toBe(405);
  });
});
