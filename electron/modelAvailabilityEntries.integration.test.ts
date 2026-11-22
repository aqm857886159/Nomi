import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("availability loopback only");
    return originalFetch(input, init);
  };
  let blocked = false;
  try { globalThis.fetch("https://example.invalid/canary"); } catch { blocked = true; }
  if (!blocked) throw new Error("fetch canary did not stop external traffic");
  return { root: "", originalFetch };
});
vi.mock("electron", () => ({
  app: { getPath: () => fixture.root, getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  BrowserWindow: { getAllWindows: () => [] }, webContents: { getAllWebContents: () => [] },
}));

import * as store from "./catalog/catalogStore";
import { catalogPath } from "./catalog/catalogFileAccess";
import { runTask } from "./runtime";
import { runTextTaskStream } from "./textTaskRunner";
import { defaultCatalog } from "./providerAdapter/serviceCatalog";

const requests: string[] = [];
const server = http.createServer((req, res) => {
  requests.push(`${req.method} ${req.url}`);
  if (req.url === "/v1/images/generations") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "succeeded", data: [{ url: "http://127.0.0.1/image.png" }] }));
  } else if (req.url === "/v1/chat/completions") {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end('data: {"id":"local","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"local reply"},"finish_reason":null}]}\n\ndata: {"id":"local","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  } else {
    res.writeHead(503); res.end("preflight must never happen");
  }
});
let baseUrl = "";

beforeAll(async () => {
  fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-availability-entry-"));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
afterAll(async () => {
  globalThis.fetch = fixture.originalFetch;
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(fixture.root, { recursive: true, force: true });
});

it.each(["unverified", "failed", "verified"])("all entry points send without preflights for legacy %s records", async state => {
  // Application imports happen only after the process fetch guard and its canary.
  store.upsertModelCatalogVendor({ key: "relay", name: "Loopback", enabled: true, authType: "bearer", providerKind: "openai-compatible", baseUrlHint: baseUrl });
  store.upsertModelCatalogVendorApiKey("relay", { apiKey: "fixture-key", enabled: true });
  for (const kind of ["image", "text"] as const) store.upsertModelCatalogModel({ vendorKey: "relay", modelKey: kind, kind, enabled: true, meta: { adapter: { state } } });
  store.upsertModelCatalogMapping({ vendorKey: "relay", modelKey: "image", taskKind: "text_to_image", name: "local image", create: { method: "POST", path: "/images/generations", body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}" }, response_mapping: { status: "status" } } });
  const saved = store.readCatalog();
  (saved.apiKeysByVendor.relay as unknown as Record<string, unknown>).verificationPending = true;
  fs.writeFileSync(catalogPath(), JSON.stringify(saved));
  requests.length = 0;
  const loaded = await defaultCatalog.load("relay", ["image", "text"]);
  expect(loaded?.models).toHaveLength(2);
  expect(requests).toEqual([]);
  const image = await runTask({ vendor: "relay", request: { kind: "text_to_image", prompt: "local", extras: { modelKey: "image" } } }, { spendGate: async () => {} });
  expect(image.status).toBe("succeeded");
  expect(requests).toEqual(["POST /v1/images/generations"]);
  requests.length = 0;
  const text = await runTextTaskStream({ vendor: "relay", request: { kind: "chat", prompt: "local", extras: { modelKey: "text", maxRetries: 0 } } });
  expect(text.status).toBe("succeeded");
  expect(requests).toEqual(["POST /v1/chat/completions"]);
});
