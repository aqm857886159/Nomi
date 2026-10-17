// 原生查询端点探测：先学这家网关「查无此路由」长什么样（同级哨兵），再要求目标对假任务号给出
// **原生合同自己的回答**（#1213）。只「和哨兵不一样」不算——503 无可用渠道、401、网关通用错误都不一样，
// 却恰恰说明真查任务也会失败；旧判据把它们当「端点存在」，开机静默切通道，用户扣了钱取不回片。
// 另一条回归是 SPA 陷阱：new-api/one-api 的后台对**顶层**未知路径回 200 + index.html。
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeNativeEndpoint } from "./nativeEndpointProbe";
import { ARK_TASK_NOT_FOUND_EVIDENCE } from "./nativeWireProfiles";

const ARK = "/api/v3/contents/generations/tasks";
let server: http.Server;
let base = "";
/** 目标路由（/api/v3/contents/generations/tasks/<id>）此刻怎么回答——每条用例自己设。 */
let answer: { status: number; body: unknown } = { status: 404, body: {} };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = (req.url || "").split("?")[0];
    res.setHeader("Content-Type", "application/json");
    if (url.startsWith(`${ARK}/`)) {
      res.writeHead(answer.status);
      res.end(JSON.stringify(answer.body));
      return;
    }
    // API 命名空间下的未知路由 → 404 + 回显路径（每次回显不同，签名归一化必须抹掉它）
    if (url.startsWith("/api/") || url.startsWith("/v1/")) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: { message: `Invalid URL (GET ${url})`, type: "invalid_request_error", param: "", code: "" } }));
      return;
    }
    // 顶层未知路径 → 后台 SPA 首页 200（就是那个陷阱）
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<!doctype html><html><head><title>Dashboard</title></head><body></body></html>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const probe = (baseUrl: string, path = ARK) => probeNativeEndpoint(baseUrl, path, ARK_TASK_NOT_FOUND_EVIDENCE, "relay-key");

describe("probeNativeEndpoint：只认原生合同证据", () => {
  it("假任务号得到方舟错误包络（404 + PascalCase code）→ contract", async () => {
    answer = { status: 404, body: { error: { code: "ResourceNotFound", message: "The specified task is not found", param: "", type: "NotFound" } } };
    const r = await probe(base);
    expect(r).toMatchObject({ exists: true, verdict: "contract" });
  });

  it("400 + 方舟点分错误码同样算（格式非法的任务号）", async () => {
    answer = { status: 400, body: { error: { code: "InvalidParameter.TaskId", message: "invalid task id" } } };
    expect((await probe(base)).verdict).toBe("contract");
  });

  it("#1213：503「无可用渠道」与哨兵不同，但不是证据 → no-contract（旧判据在这里判了存在）", async () => {
    answer = { status: 503, body: { error: { message: "当前分组 default 下对于模型  无可用渠道", type: "new_api_error" } } };
    const r = await probe(base);
    expect(r).toMatchObject({ exists: false, verdict: "no-contract" });
    expect(r.detail).toContain("503");
  });

  it("401 坏 key 不是证据（旧判据把它当存在）", async () => {
    answer = { status: 401, body: { error: { message: "Invalid token (request id: abc123)", type: "new_api_error" } } };
    expect((await probe(base)).verdict).toBe("no-contract");
  });

  it("网关自己的 snake_case 错误码不是方舟回答", async () => {
    answer = { status: 404, body: { error: { code: "model_not_found", message: "model not found", type: "new_api_error" } } };
    expect((await probe(base)).verdict).toBe("no-contract");
  });

  it("new-api 任务表的 task_not_exist 顶层信封不是方舟回答", async () => {
    answer = { status: 400, body: { code: "task_not_exist", message: "task_not_exist", data: null } };
    expect((await probe(base)).verdict).toBe("no-contract");
  });

  it("对不存在的端点如实说不存在（哨兵取同级兄弟，不被顶层 SPA 200 骗到）", async () => {
    const r = await probe(base, "/api/v9/totally/made/up");
    expect(r).toMatchObject({ exists: false, verdict: "no-contract" });
  });

  it("地址带 /v1 也能剥到主机根去探原生路径（用户就是这么填的）", async () => {
    answer = { status: 404, body: { error: { code: "ResourceNotFound", message: "not found" } } };
    expect((await probe(`${base}/v1`)).verdict).toBe("contract");
  });

  it("地址不是 http(s) → 不探，没有结论（unreachable，不是 no-contract）", async () => {
    expect((await probe("not-a-url")).verdict).toBe("unreachable");
  });

  it("连不上的地址 → unreachable：探不到不等于没有，调用方据此不改通道", async () => {
    const r = await probe("http://127.0.0.1:9");
    expect(r).toMatchObject({ exists: false, verdict: "unreachable" });
  });
});
