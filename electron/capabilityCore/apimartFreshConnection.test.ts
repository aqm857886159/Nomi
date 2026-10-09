/**
 * 付费提交每次用**全新连接**（真实 appFetch + 真实 undici + loopback socket，出站层没有 mock）。
 *
 * 为什么：共享连接池里空闲的 keep-alive 连接可能已被对面关掉，写上去抛 UND_ERR_SOCKET，
 * 和「请求写出去后连接被重置」抛出来的码一模一样——分不清，就只能把后者也当「没写出去」重发，
 * 而不支持幂等的供应商（APIMart）会收到两笔（2026-10-02 真应用复现）。这里钉住：
 *   ① 连续两次付费提交，供应商看到的是两条不同的连接（没有复用）；
 *   ② 查询（GET）仍走共享池（对照组：证明夹具里「复用」本来会发生）；
 *   ③ 读完请求就销毁 socket 时，错误的 cause 链证明不了「没写出去」（结果未知）；
 *   ④ 拒连时 cause 链能证明「没写出去」。
 */
import http from "node:http";
import net from "node:net";
import type { Session } from "electron";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.unmock("../appFetch");

import { createCatalogGenerationProvider } from "./apimartGenerationProvider";
import type { CatalogState } from "../catalog/types";
import { outboundRequestWasNeverWritten } from "../outboundDispatchEvidence";
import { applySystemProxy } from "../systemProxy";

/** 用户自己接的供应商（非内置 direct-key）：端点 / 鉴权全来自用户保存的连接与 mapping，和 APIMart 走同一个 send。 */
function catalogFor(origin: string): CatalogState {
  const now = "now";
  return {
    version: 11,
    vendors: [{ key: "acme", name: "Acme", enabled: true, baseUrlHint: origin, authType: "bearer", authHeader: "Authorization", createdAt: now, updatedAt: now }],
    models: [{ vendorKey: "acme", modelKey: "acme-image", kind: "image", enabled: true, labelZh: "Acme 图", createdAt: now, updatedAt: now }],
    mappings: [{
      id: "acme-text_to_image", vendorKey: "acme", modelKey: "acme-image", taskKind: "text_to_image", name: "Acme 文生图", enabled: true,
      create: { method: "POST", path: "/v2/jobs", body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}" }, response_mapping: { task_id: "data.0.task_id" } },
      query: { method: "GET", path: "/v2/jobs/{{providerMeta.task_id}}", response_mapping: { status: "data.0.status" } },
      createdAt: now, updatedAt: now,
    }],
    apiKeysByVendor: {},
  } as CatalogState;
}

function semanticInput(key: string) {
  return {
    moduleId: "generation.single-shot", providerId: "acme", modelId: "acme-image", mode: "text-to-image",
    prompt: "a red paper crane", parameters: {}, references: [],
    contractHash: "a".repeat(64), idempotencyKey: key, requestFingerprint: "b".repeat(64),
    executionBinding: {
      immutableProjectUuid: "project-1", projectGeneration: 1, runId: "run-1", shotId: "shot-1", contractHash: "a".repeat(64),
      runtimeTaskId: "runtime-1", providerNamespace: "acme", providerIdempotencyKey: key,
      requestFingerprint: "b".repeat(64), runtimeEnvelopeRef: ".nomi/runs/run-1/runtime.json", fencingEpoch: 1,
    },
  };
}

type Submit = (request: unknown, key: string, input: ReturnType<typeof semanticInput>) => Promise<{ providerTaskId: string }>;

function causeNames(error: unknown): string[] {
  const names: string[] = [];
  for (let current = error; current && typeof current === "object" && names.length < 10; current = (current as { cause?: unknown }).cause) {
    names.push(String((current as { name?: unknown }).name));
  }
  return names;
}

const servers: http.Server[] = [];
const sockets = new Set<net.Socket>();

async function loopback(behaviour: "accept" | "destroy-after-read" | "hang") {
  const connections: net.Socket[] = [];
  const requests: Array<{ method: string; socketId: number }> = [];
  const server = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      requests.push({ method: request.method ?? "", socketId: connections.indexOf(request.socket) });
      if (behaviour === "hang" && request.method === "POST") return;
      if (behaviour === "destroy-after-read" && request.method === "POST") { request.socket.destroy(); return; }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: 200, data: [{ task_id: "task-1", status: "submitted" }] }));
    });
  });
  server.on("connection", (socket) => { connections.push(socket); sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return { origin: `http://127.0.0.1:${port}`, port, requests, connections, server };
}

beforeAll(async () => {
  await applySystemProxy({ setProxy: async () => undefined } as unknown as Session, { mode: "off", customUrl: "" });
});
afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
});

function providerFor(origin: string) {
  const state = catalogFor(origin);
  const provider = createCatalogGenerationProvider({ vendorKey: "acme", resolveConnection: () => ({ apiKey: "test-key" }), catalogReader: () => state });
  const submit = (provider as unknown as { submitWithContext: Submit }).submitWithContext;
  const send = (key: string) => submit(provider.buildRequest(semanticInput(key)), key, semanticInput(key));
  return { provider, send };
}

describe("APIMart 付费提交：每次新连接", () => {
  it("① 连续两次提交，供应商看到两条不同的连接；② 查询（GET）仍走共享池（对照）", async () => {
    const fx = await loopback("accept");
    const { provider, send } = providerFor(fx.origin);
    // 间隔一小会儿：连接已退回空闲池，共享池此刻就会复用它——只有「每次新连接」才会让两次 POST 落在不同连接上。
    const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
    await send("key-1");
    await settle();
    await send("key-2");
    await settle();
    const posts = fx.requests.filter((request) => request.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[0].socketId).not.toBe(posts[1].socketId);

    await provider.query!("task-1");
    await settle();
    await provider.query!("task-1");
    const gets = fx.requests.filter((request) => request.method === "GET");
    expect(gets).toHaveLength(2);
    expect(gets[0].socketId).toBe(gets[1].socketId); // 对照：查询照旧走共享池，会复用连接——说明上面 POST 的「不同连接」不是夹具的假象
  });

  it("③ 读完请求就销毁 socket：错误证明不了「没写出去」（结果未知），且只收到 1 次 POST", async () => {
    const fx = await loopback("destroy-after-read");
    const { send } = providerFor(fx.origin);
    const error = await send("key-1").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(outboundRequestWasNeverWritten(error)).toBe(false);
    expect(fx.requests.filter((request) => request.method === "POST")).toHaveLength(1);
  });

  it("⑤ 供应商接了请求却一直不回话：到点超时，结果未知（不自动重发），只收到 1 次 POST", async () => {
    vi.stubEnv("NOMI_VENDOR_HTTP_TIMEOUT_MS", "400");
    try {
      const fx = await loopback("hang");
      const { send } = providerFor(fx.origin);
      const error = await send("key-1").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      // 直接观测机制：是那道响应超时到点 abort 的（cause 链里有 TimeoutError），不是连接被重置；
      // 超时没生效时 send 永远不回，测试会在 vitest 的用例超时上红。
      expect(causeNames(error)).toContain("TimeoutError");
      expect(outboundRequestWasNeverWritten(error)).toBe(false);
      expect(fx.requests.filter((request) => request.method === "POST")).toHaveLength(1);
    } finally {
      vi.stubEnv("NOMI_VENDOR_HTTP_TIMEOUT_MS", undefined);
    }
  });

  it("④ 拒连：错误能证明「没写出去」，供应商一个请求都没收到", async () => {
    const fx = await loopback("accept");
    await new Promise<void>((resolve) => { for (const socket of sockets) socket.destroy(); fx.server.close(() => resolve()); });
    const { send } = providerFor(fx.origin);
    const error = await send("key-1").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(outboundRequestWasNeverWritten(error)).toBe(true);
    expect(fx.requests).toHaveLength(0);
  });
});
