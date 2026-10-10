import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runCustomCallScript } from "./customCallRunner";
import type { Model, Vendor } from "./types";

const servers = new Set<http.Server>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  servers.clear();
});

describe("custom call cancellation reaches the real HTTP socket", () => {
  it("aborts an in-flight upstream request and does not wait for a late response", async () => {
    let requestArrived!: () => void;
    let connectionClosed!: () => void;
    const arrived = new Promise<void>((resolve) => { requestArrived = resolve; });
    const closed = new Promise<void>((resolve) => { connectionClosed = resolve; });
    const server = http.createServer((_request, response) => {
      requestArrived();
      response.on("close", connectionClosed);
    });
    servers.add(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not expose a TCP port");

    const vendor = {
      key: "cancel-fixture",
      name: "Cancel fixture",
      baseUrlHint: `http://127.0.0.1:${address.port}`,
      enabled: true,
      authType: "none",
    } as Vendor;
    const model = {
      vendorKey: vendor.key,
      modelKey: "slow-model",
      labelZh: "Slow model",
      kind: "image",
      enabled: true,
      createdAt: "",
      updatedAt: "",
    } as Model;
    const controller = new AbortController();
    const pending = runCustomCallScript({
      vendor,
      model,
      apiKey: "",
      prompt: "test",
      params: {},
      taskKind: "text_to_image",
      script: `await request({ method: 'GET', url: '/slow' })\nreturn 'https://assets.test/late.png'`,
      signal: controller.signal,
      timeoutMs: 10_000,
    });

    await arrived;
    controller.abort(new Error("user stopped custom call test"));

    await expect(pending).rejects.toThrow(/取消/);
    await closed;
  });
});
