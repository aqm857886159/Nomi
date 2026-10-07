import http from "node:http";
import net from "node:net";
import type { Session } from "electron";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createCatalogGenerationProvider } from "./capabilityCore/apimartGenerationProvider";
import type { CatalogState } from "./catalog/types";
import { providerExplicitlyRejected } from "./outboundDispatchEvidence";
import { applySystemProxy } from "./systemProxy";
import { requestJson } from "./vendor/vendorHttp";
import { setSubmitOutboundDepsForTests } from "./vendor/vendorOutboundGuard";
import type { Vendor } from "./catalog/types";

// 「供应商当场明确拒绝」= 确定没受理（2026-10-05 用户拍板 F3）。只认一种证据：收到了响应，4xx 或 2xx + 失败信封，
// 没有任务号。两台发动机的执行器都在收到响应之后才挂上这份证据；5xx、没收到响应的一律仍是「结果未知」。
// 设计卡：docs/plan/2026-10-05-engine-convergence-cut1-step12-design-card.md §4 F3。

describe("providerExplicitlyRejected：唯一判据", () => {
  const answered = (httpStatus: number, envelopeFailure = false, taskIdReturned = false) =>
    Object.assign(new Error("provider answered"), { providerAnswer: { httpStatus, envelopeFailure, taskIdReturned } });

  it("名单内的 4xx（400/401/402/403/404/422/429）、没有任务号 → 明确拒绝，可再点", () => {
    for (const status of [400, 401, 402, 403, 404, 422, 429]) expect(providerExplicitlyRejected(answered(status)), String(status)).toBe(true);
  });

  it("408 / 409 / 425 及其他 4xx → 结果未知（可能已受理 / 已有同键的一笔），不能当拒绝", () => {
    for (const status of [408, 409, 410, 413, 418, 425, 451]) expect(providerExplicitlyRejected(answered(status)), String(status)).toBe(false);
  });

  it("2xx + 失败信封、没有任务号 → 明确拒绝；2xx 没有失败信封 → 不是", () => {
    expect(providerExplicitlyRejected(answered(200, true))).toBe(true);
    expect(providerExplicitlyRejected(answered(200, false))).toBe(false);
  });

  it("5xx 一律不算（可能已经受理），带了任务号的 4xx 也不算", () => {
    for (const status of [500, 502, 503, 504]) expect(providerExplicitlyRejected(answered(status)), String(status)).toBe(false);
    expect(providerExplicitlyRejected(answered(400, false, true))).toBe(false);
    expect(providerExplicitlyRejected(answered(200, true, true))).toBe(false);
  });

  it("没收到响应（没有证据）不算；证据挂在 cause 链上也认得", () => {
    expect(providerExplicitlyRejected(new Error("socket hang up"))).toBe(false);
    expect(providerExplicitlyRejected(new Error("wrapped", { cause: answered(422) }))).toBe(true);
    expect(providerExplicitlyRejected(Object.assign(new Error("forged"), { providerAnswer: { httpStatus: "400" } }))).toBe(false);
  });
});

describe("引擎 A：真实 socket 上的 requestJson", () => {
  const servers: http.Server[] = [];
  const sockets = new Set<net.Socket>();
  beforeAll(async () => {
    await applySystemProxy({ setProxy: async () => undefined } as unknown as Session, { mode: "off", customUrl: "" });
  });
  beforeEach(() => {
    setSubmitOutboundDepsForTests({
      resolve: async () => [{ address: "93.184.216.34", family: 4 as const }],
      readEnvironment: async () => ({ syntheticResolver: false, syntheticSample: "" }),
      isApplicationProxyActive: () => false,
    });
  });
  afterEach(async () => {
    setSubmitOutboundDepsForTests(null);
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function vendorAnswering(reply: (response: http.ServerResponse, request: http.IncomingMessage) => void): Promise<Vendor> {
    const server = http.createServer((request, response) => {
      request.resume();
      request.on("end", () => reply(response, request));
    });
    server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    return { key: "acme", name: "Acme", enabled: true, baseUrlHint: `http://127.0.0.1:${port}`, authType: "bearer", createdAt: "now", updatedAt: "now" } as Vendor;
  }

  const json = (status: number, body: unknown) => (response: http.ServerResponse) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };

  async function submitError(vendor: Vendor): Promise<unknown> {
    try {
      await requestJson(vendor, "test-key", "POST", `${vendor.baseUrlHint}/v1/images/generations`, { "Content-Type": "application/json" }, {}, { prompt: "x" });
    } catch (error) {
      return error;
    }
    throw new Error("expected the submission to fail");
  }

  it("HTTP 400 带原话 → 明确拒绝", async () => {
    const error = await submitError(await vendorAnswering(json(400, { error: { message: "prompt violates content policy" } })));
    expect(providerExplicitlyRejected(error)).toBe(true);
  });

  it("HTTP 200 + 失败信封 → 明确拒绝", async () => {
    const error = await submitError(await vendorAnswering(json(200, { code: 402, msg: "insufficient balance" })));
    expect(providerExplicitlyRejected(error)).toBe(true);
  });

  it("HTTP 409 / 408（真 socket）→ 结果未知，不是拒绝", async () => {
    expect(providerExplicitlyRejected(await submitError(await vendorAnswering(json(409, { error: { message: "duplicate request" } }))))).toBe(false);
    expect(providerExplicitlyRejected(await submitError(await vendorAnswering(json(408, { error: { message: "timeout" } }))))).toBe(false);
  });

  it("HTTP 500 → 仍是结果未知", async () => {
    const error = await submitError(await vendorAnswering(json(500, { error: { message: "internal" } })));
    expect(providerExplicitlyRejected(error)).toBe(false);
  });

  it("读完请求就断开连接（没收到响应）→ 仍是结果未知", async () => {
    const error = await submitError(await vendorAnswering((_response, request) => request.socket.destroy()));
    expect(providerExplicitlyRejected(error)).toBe(false);
  });
});

describe("引擎 B：目录执行器", () => {
  const catalog = (): CatalogState => ({
    version: 11,
    vendors: [{ key: "acme", name: "Acme", enabled: true, baseUrlHint: "https://acme.example", authType: "bearer", authHeader: "Authorization", createdAt: "now", updatedAt: "now" }],
    models: [{ vendorKey: "acme", modelKey: "acme-image", kind: "image", enabled: true, labelZh: "Acme 图", createdAt: "now", updatedAt: "now" }],
    mappings: [{
      id: "acme-text_to_image", vendorKey: "acme", modelKey: "acme-image", taskKind: "text_to_image", name: "Acme 文生图", enabled: true,
      create: { method: "POST", path: "/v2/jobs", body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}" }, response_mapping: { task_id: "id" } },
      query: { method: "GET", path: "/v2/jobs/{{providerMeta.task_id}}", response_mapping: { status: "status" } },
      createdAt: "now", updatedAt: "now",
    }],
    apiKeysByVendor: {},
  } as CatalogState);

  async function submitError(status: number, body: unknown): Promise<unknown> {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
    const provider = createCatalogGenerationProvider({
      vendorKey: "acme", catalogReader: catalog, resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const request = provider.buildRequest({
      moduleId: "generation.single-shot", providerId: "acme", modelId: "acme-image", mode: "text-to-image",
      prompt: "x", parameters: {}, references: [], contractHash: "a".repeat(64), idempotencyKey: "k",
    });
    try {
      await provider.submit(structuredClone(request), "k");
    } catch (error) {
      expect(fetchImpl).toHaveBeenCalledOnce();
      return error;
    }
    throw new Error("expected the submission to fail");
  }

  it("HTTP 400 → 明确拒绝；HTTP 200 + 失败信封 → 明确拒绝", async () => {
    expect(providerExplicitlyRejected(await submitError(400, { error: { message: "bad prompt" } }))).toBe(true);
    expect(providerExplicitlyRejected(await submitError(200, { code: 1001, msg: "bad prompt" }))).toBe(true);
  });

  it("HTTP 409 / 408 → 结果未知，不是拒绝", async () => {
    expect(providerExplicitlyRejected(await submitError(409, { error: { message: "already accepted" } }))).toBe(false);
    expect(providerExplicitlyRejected(await submitError(408, { error: { message: "timeout" } }))).toBe(false);
  });

  it("HTTP 503 → 仍是结果未知；带了任务号的拒绝也不算", async () => {
    expect(providerExplicitlyRejected(await submitError(503, { error: { message: "busy" } }))).toBe(false);
    expect(providerExplicitlyRejected(await submitError(400, { id: "task-9", error: { message: "odd" } }))).toBe(false);
  });
});
