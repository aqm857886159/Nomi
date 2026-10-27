// 失败留证不漏密钥（协调 10-21 硬要求）：key 放在查询串、放在请求头、被服务商原样回显进响应体——
// 三种情况下 logVendorCall、开发终端日志、交给错误分类的那份事实里都不许出现它。
// 独立验收 V-textmigrate（10-21）补两类：
//   F1 每次尝试一份事实——上一次的 429 不许留到这一次；
//   F2 秘密从实际发出去的请求里收——网关自定义鉴权头（任意头名、任意大小写、Request 或 init 写法）与主 key 同等对待，
//      服务商用 JSON 转义 / URL 编码回显也认得出。
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => ({ calls: [] as unknown[], dev: [] as string[] }));
vi.mock("../logging/logger", () => ({
  logVendorCall: (summary: unknown) => logged.calls.push(summary),
  logDevDetail: (_scope: string, detail: string) => logged.dev.push(detail),
}));

import { observeModelFetch, urlWithoutQuery } from "./modelCallFetch";

const KEY = "sk-live-0123456789abcdefSECRET";
/** 次级凭据：带 / " + 和非 ASCII，才能证 JSON 转义（\" \/ \uXXXX）与 URL 编码的回显都被认出。 */
const RELAY = 'gw/"pass+é-42-relay';
let server: http.Server | undefined;
afterEach(async () => {
  logged.calls.length = 0;
  logged.dev.length = 0;
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function echoingUpstream(status: number): Promise<string> {
  server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      // 最坏的服务商：把收到的鉴权头和地址原样写进错误体。
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `bad key ${req.headers.authorization ?? ""} at ${req.url}` } }));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** 把收到的每一个请求头都按几种写法回显：JSON（Python ensure_ascii 风格：\uXXXX、\/）、URL 编码、原样。 */
async function echoAllHeadersUpstream(status: number): Promise<string> {
  server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const values = Object.values(req.headers).map(String);
      const ensureAscii = JSON.stringify({ echo: values }).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).split("/").join("\\/");
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `rejected ${values.map(encodeURIComponent).join(" ")} raw=${values.join(" ")}`, detail: ensureAscii } }));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function everythingRecorded(failure: unknown): string {
  return JSON.stringify({ calls: logged.calls, dev: logged.dev, failure });
}

/** 一个秘密被回显时可能出现的全部写法（原样、JSON 转义、\/、\uXXXX、URL 编码）。 */
function echoForms(secret: string): string[] {
  const escaped = JSON.stringify(secret).slice(1, -1);
  const ascii = escaped.replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return [secret, escaped, escaped.split("/").join("\\/"), ascii, ascii.split("/").join("\\/"), encodeURIComponent(secret)];
}

function expectNoEcho(text: string, secret: string): void {
  for (const form of echoForms(secret)) expect(text, `漏了「${form}」`).not.toContain(form);
}

describe("模型调用的失败留证", () => {
  it("key 在查询串里：事实里的地址去掉了查询串，日志与原话里都没有 key", async () => {
    const origin = await echoingUpstream(401);
    const observed = observeModelFetch(globalThis.fetch, { modelId: "m" });
    const response = await observed.fetch(`${origin}/v1/chat/completions?key=${KEY}`, { method: "POST", body: "{}" });
    expect(response.status).toBe(401);
    const failure = observed.lastAttempt();
    expect(failure).toMatchObject({ kind: "http", status: 401, url: `${origin}/v1/chat/completions` });
    expect(everythingRecorded(failure)).not.toContain(KEY);
    expect(logged.calls).toEqual([expect.objectContaining({ status: 401, model: "m" })]);
  });

  it("key 在请求头里（Bearer）：服务商把它回显进错误体，也被抹掉", async () => {
    const origin = await echoingUpstream(403);
    const observed = observeModelFetch(globalThis.fetch, { modelId: "m" });
    await observed.fetch(`${origin}/v1/chat/completions`, { method: "POST", body: "{}", headers: { Authorization: `Bearer ${KEY}` } });
    const failure = observed.lastAttempt();
    expect(failure).toMatchObject({ kind: "http", body: expect.stringContaining("bad key") });
    expect(everythingRecorded(failure)).not.toContain(KEY);
  });

  it("调用方手里那把 key（knownSecrets）出现在任何位置都抹掉", async () => {
    const origin = await echoingUpstream(500);
    const observed = observeModelFetch(globalThis.fetch, { modelId: "m", knownSecrets: [KEY] });
    await observed.fetch(`${origin}/v1/x/${KEY}`, { method: "POST", body: "{}" });
    expect(everythingRecorded(observed.lastAttempt())).not.toContain(KEY);
  });

  it("成功的调用不留证：最后一次尝试只记「拿到了响应」", async () => {
    server = http.createServer((_req, res) => res.end("{}"));
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const observed = observeModelFetch(globalThis.fetch, { modelId: "m" });
    await observed.fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/ok`);
    expect(observed.lastAttempt()).toEqual({ kind: "response", status: 200, bodyBroken: false });
    expect(logged.calls).toEqual([]);
  });

  it("地址去查询串、去账号密码段", () => {
    expect(urlWithoutQuery("https://u:p@host.example/v1/x?key=1#h")).toBe("https://host.example/v1/x");
  });

  it("包过就复用：对已包过的传输再包一次，交回同一份留证（同一个 lastAttempt、秘密合并），日志只记一遍", async () => {
    // provider 装配点每次调用都要一份留证，而文本任务 / 编译器在调用前已经自己包过一层：叠两层就是同一次请求两份事实、日志两遍。
    const origin = await echoingUpstream(401);
    const outer = observeModelFetch(globalThis.fetch, { modelId: "m" });
    const inner = observeModelFetch(outer.fetch, { modelId: "m", knownSecrets: [KEY] });
    expect(inner).toBe(outer);
    await inner.fetch(`${origin}/v1/x/${KEY}`, { method: "POST", body: "{}" });
    expect(outer.lastAttempt()).toMatchObject({ kind: "http", status: 401 });
    // 后来补进来的秘密对先包的那一份同样生效。
    expect(everythingRecorded(outer.lastAttempt())).not.toContain(KEY);
    expect(logged.calls).toHaveLength(1);
    // 没包过的传输照旧各包各的。
    expect(observeModelFetch(globalThis.fetch, { modelId: "m" })).not.toBe(outer);
  });
});

describe("每次尝试一份事实（F1）", () => {
  const scripted = (...replies: Array<() => Response>) => {
    let index = 0;
    return (async () => {
      const next = replies[Math.min(index, replies.length - 1)]!;
      index += 1;
      return next();
    }) as unknown as typeof globalThis.fetch;
  };
  const rateLimited = () => new Response('{"error":{"message":"slow down"}}', { status: 429 });
  const streaming = () => new Response("data: {}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });

  it("429 → 重试拿到 200：最后一次尝试是「拿到了响应」，不再带着那次 429", async () => {
    const observed = observeModelFetch(scripted(rateLimited, streaming), { modelId: "m" });
    await observed.fetch("https://relay.example/v1/chat/completions");
    expect(observed.lastAttempt()).toMatchObject({ kind: "http", status: 429 });
    await observed.fetch("https://relay.example/v1/chat/completions");
    expect(observed.lastAttempt()).toEqual({ kind: "response", status: 200, bodyBroken: false });
  });

  it("429 → 重试连不上：最后一次尝试是「没拿到响应」", async () => {
    const reset = () => { throw new TypeError("fetch failed: socket hang up"); };
    const observed = observeModelFetch(scripted(rateLimited, reset), { modelId: "m" });
    await observed.fetch("https://relay.example/v1/chat/completions");
    await expect(observed.fetch("https://relay.example/v1/chat/completions")).rejects.toThrow("socket hang up");
    expect(observed.lastAttempt()).toEqual({ kind: "thrown", reason: "fetch failed: socket hang up" });
  });
});

describe("秘密从实际发出去的请求里收（F2）", () => {
  const forms: Array<[string, (origin: string) => [RequestInfo, RequestInit | undefined]]> = [
    ["init 写法、头名混大小写", (origin) => [`${origin}/v1/messages`, { method: "POST", body: "{}", headers: { "x-API-key": KEY, "X-Relay-TOKEN": RELAY } }]],
    ["init 里放 Headers 对象", (origin) => [`${origin}/v1/messages`, { method: "POST", body: "{}", headers: new Headers({ Authorization: `Bearer ${KEY}`, "x-relay-token": RELAY }) }]],
    ["Request 写法（头在 Request 上）", (origin) => [new Request(`${origin}/v1/messages`, { method: "POST", body: "{}", headers: { Authorization: `Bearer ${KEY}`, "X-Gateway-Pass": RELAY } }), undefined]],
  ];

  it.each(forms)("%s：主 key 与网关自定义头的值，原样 / JSON 转义 / URL 编码的回显都抹掉；日志、事实、给用户看的文字都没有", async (_name, build) => {
    const origin = await echoAllHeadersUpstream(401);
    const observed = observeModelFetch(globalThis.fetch, { modelId: "m" });
    const [input, init] = build(origin);
    await observed.fetch(input, init);
    const failure = observed.lastAttempt();
    expect(failure).toMatchObject({ kind: "http", status: 401, body: expect.stringContaining("rejected") });
    const recorded = everythingRecorded(failure);
    expectNoEcho(recorded, KEY);
    expectNoEcho(recorded, RELAY);
    // 交给错误文案的那段（pi 的原话 / SSE 里包着的错误）也要过同一套秘密。
    const shown = observed.redact(`401: ${JSON.stringify({ echo: [KEY, RELAY] })} ${encodeURIComponent(RELAY)}`);
    expectNoEcho(shown, KEY);
    expectNoEcho(shown, RELAY);
  });

  it("SDK 自己的系统头（版本、重试计数）不当秘密：错误原话里的 0 / 600 不被抹花", async () => {
    const observed = observeModelFetch((async () => new Response("{}", { status: 200 })) as unknown as typeof globalThis.fetch, { modelId: "m" });
    await observed.fetch("https://relay.example/v1/messages", { headers: { "x-stainless-retry-count": "0", "x-stainless-timeout": "600", "anthropic-version": "2023-06-01", "content-type": "application/json" } });
    expect(observed.redact('{"code":0,"timeout":600,"version":"2023-06-01","type":"application/json"}')).toBe('{"code":0,"timeout":600,"version":"2023-06-01","type":"application/json"}');
  });
});
