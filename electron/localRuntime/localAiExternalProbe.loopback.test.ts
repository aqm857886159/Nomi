import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { probeLocalAiExternalRuntime } from "./localAiExternalProbe";

const servers = new Set<http.Server>();

async function listen(
  handler: http.RequestListener,
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  servers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Loopback server did not expose a TCP address");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => {
      servers.delete(server);
      if (error) reject(error);
      else resolve();
    })),
  };
}

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  servers.clear();
});

function discovery(): string {
  return JSON.stringify({
    version: "v4.9.0",
    endpoints: { models_capabilities: "/v1/models/capabilities" },
  });
}

function capabilities(): string {
  return JSON.stringify({
    object: "list",
    data: [{
      id: "local-chat",
      capabilities: ["chat", "tools"],
      input_modalities: ["text"],
      output_modalities: ["text"],
    }],
  });
}

describe("LocalAI external probe over a real loopback HTTP server", () => {
  it("accepts a 204 readiness response and authenticates only protected discovery", async () => {
    const observed: Array<{ path: string; authorization?: string }> = [];
    const fixture = await listen((request, response) => {
      observed.push({
        path: request.url || "",
        ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
      });
      if (request.url === "/.well-known/localai.json") response.end(discovery());
      else if (request.url === "/readyz") response.writeHead(204).end();
      else if (request.url === "/v1/models/capabilities") response.end(capabilities());
      else response.writeHead(404).end();
    });

    const descriptor = await probeLocalAiExternalRuntime({ baseUrl: fixture.origin, apiKey: "local-key" });
    expect(descriptor).toMatchObject({ identity: "confirmed", health: "ready", version: "v4.9.0" });
    expect(observed).toEqual([
      { path: "/.well-known/localai.json" },
      { path: "/readyz" },
      { path: "/v1/models/capabilities", authorization: "Bearer local-key" },
    ]);
    await fixture.close();
  });

  it.each([
    [503, "degraded", "starting"],
    [401, "unauthorized", "unauthorized"],
  ] as const)("projects readiness/auth failures without leaking the key: %s", async (status, health, code) => {
    const fixture = await listen((request, response) => {
      if (request.url === "/.well-known/localai.json") response.end(discovery());
      else if (request.url === "/readyz" && status === 503) {
        response.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ status: "starting" }));
      } else if (request.url === "/readyz") response.writeHead(204).end();
      else if (request.url === "/v1/models/capabilities" && status === 401) response.writeHead(401).end();
      else if (request.url === "/v1/models/capabilities") response.end(capabilities());
      else response.writeHead(404).end();
    });

    const descriptor = await probeLocalAiExternalRuntime({ baseUrl: fixture.origin, apiKey: "do-not-return" });
    expect(descriptor.health).toBe(health);
    expect(descriptor.diagnostics.some((item) => item.code === code)).toBe(true);
    expect(JSON.stringify(descriptor)).not.toContain("do-not-return");
    await fixture.close();
  });

  it("bounds oversized discovery bodies and safely falls back to the model list", async () => {
    const fixture = await listen((request, response) => {
      if (request.url === "/.well-known/localai.json") response.end(discovery());
      else if (request.url === "/readyz") response.writeHead(204).end();
      else if (request.url === "/v1/models/capabilities") {
        response.writeHead(200, { "content-type": "application/json" }).end("x".repeat(2 * 1024 * 1024 + 1));
      } else if (request.url === "/v1/models") {
        response.end(JSON.stringify({ object: "list", data: [{ id: "fallback-chat" }] }));
      } else response.writeHead(404).end();
    });

    const descriptor = await probeLocalAiExternalRuntime({ baseUrl: fixture.origin });
    expect(descriptor.capabilities.map((item) => item.modelId)).toEqual(["fallback-chat"]);
    expect(descriptor.diagnostics).toContainEqual(expect.objectContaining({ stage: "capabilities", code: "network" }));
    await fixture.close();
  });

  it("reports a disconnected runtime as offline", async () => {
    const fixture = await listen((request) => request.socket.destroy());
    const descriptor = await probeLocalAiExternalRuntime({ baseUrl: fixture.origin });
    expect(descriptor.health).toBe("offline");
    expect(descriptor.capabilities).toEqual([]);
    await fixture.close();
  });

  it("refuses redirects before credentials can reach another origin", async () => {
    let redirectedRequests = 0;
    let leakedAuthorization = "";
    const target = await listen((request, response) => {
      redirectedRequests += 1;
      leakedAuthorization = request.headers.authorization || "";
      response.end(capabilities());
    });
    const fixture = await listen((request, response) => {
      if (request.url === "/.well-known/localai.json") response.end(discovery());
      else if (request.url === "/readyz") response.writeHead(204).end();
      else if (request.url === "/v1/models/capabilities") response.writeHead(302, { location: `${target.origin}/steal` }).end();
      else if (request.url === "/v1/models") response.end(JSON.stringify({ object: "list", data: [] }));
      else response.writeHead(404).end();
    });

    await probeLocalAiExternalRuntime({ baseUrl: fixture.origin, apiKey: "redirect-secret" });
    expect(redirectedRequests).toBe(0);
    expect(leakedAuthorization).toBe("");
    await fixture.close();
    await target.close();
  });
});
