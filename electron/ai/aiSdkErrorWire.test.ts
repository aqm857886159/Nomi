// 真往返对账（零额度，本机 HTTP，不连外网）：aiSdkVendorError.test.ts 里的 APICallError 是**我手搓的**，
// 只证「给定这个形状，映射对不对」；证不了「真跑一趟 AI SDK 时，抛出来的到底是不是这个形状」。
// 后者才是这次修复的地基，而且实测推翻过两条想当然（2026-08-12 探针）：
//   · `textStream` 失败时**不抛**，静默结束 —— 错误只从 `fullStream` 的 error 块 / onError 出来
//     （生产就是这么接的：agentStreamConsumer.ts / agentLoop.ts，本文件照抄那条线）。
//   · 可重试错误（429/5xx/网络）在生产的 maxRetries=3 下**一律被 RetryError 套壳**，真错误在
//     .lastError 里 —— 不拆壳的话这次修复对最常见的那几类等于没做。
//
// 所以这个文件钉的是地基：ai 包升级后错误形态一变它先红，而不是等用户在错误卡上看到「稍等重试」。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { streamText } from "ai";
import { buildAiSdkModel } from "./buildAiSdkModel";
import { describeAgentError } from "./agentError";
import { classifyGenerationError } from "../../src/workbench/observability/classifyError";
import { parseVendorErrorFromMessage } from "../../src/workbench/generationCanvas/runner/vendorErrorIpc";

let server: http.Server;
let baseURL = "";
/** 每个用例现设：本次请求服务器该回什么。 */
let respond: (res: http.ServerResponse) => void = (res) => res.end();

beforeAll(async () => {
  server = http.createServer((req, res) => {
    req.resume(); // 排空请求体，否则连接不结束
    req.on("end", () => respond(res));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/**
 * 真发一次请求，把 SDK 真给出的错误交给生产漏斗 describeAgentError——取错误的方式与
 * agentStreamConsumer.ts 逐字一致（fullStream 的 error 块），不另走一条测试专用路。
 * maxRetries 由用例给：0=看裸形态，1=看 RetryError 套壳（只多等一次 2s 退避）。
 */
async function realFailureMessage(baseUrl: string, maxRetries: number): Promise<string> {
  const model = buildAiSdkModel({ kind: "openai-compatible", baseURL: baseUrl, apiKey: "sk-test", modelId: "test-model" });
  const result = streamText({ model, prompt: "hi", maxRetries });
  let message = "";
  for await (const chunk of result.fullStream) {
    if (chunk.type === "error") message = describeAgentError(chunk.error, { vendorKey: "localtest" });
  }
  return message;
}

describe("真往返：AI SDK 真抛的错误 → 结构化 → 渲染层分类", () => {
  // 不可重试的几类第一次就裸抛（tryNumber===1），maxRetries=0 跑得最快。
  it.each([
    [401, "auth"],
    [402, "balance"],
    [400, "input"],
  ] as const)("HTTP %i → kind=%s", async (status, kind) => {
    respond = (res) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `upstream says ${status}` } }));
    };
    const message = await realFailureMessage(baseURL, 0);
    expect(parseVendorErrorFromMessage(message)?.category).toBe(kind);
    expect(classifyGenerationError(message).kind).toBe(kind);
    // 上游原话跟着一起到（中转常只把真原因放体里，.message 只有一句裸状态文本）。
    expect(classifyGenerationError(message).providerMessage).toContain(`upstream says ${status}`);
  });

  it("500 打光重试后是 RetryError 套壳——拆得开才拿得到 server（生产 maxRetries=3 走的就是这条）", async () => {
    respond = (res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "upstream boom" } }));
    };
    const message = await realFailureMessage(baseURL, 1);
    expect(parseVendorErrorFromMessage(message)).toMatchObject({ category: "server", httpStatus: 500 });
    expect(classifyGenerationError(message).kind).toBe("server");
  });

  it("连不上（端口没人听）→ network，且不劝「稍等重试」", async () => {
    // 关掉的端口 = 用户断网/代理不通时的同一层失败：TCP 从未建立。真实走的是 provider-utils 的
    // `TypeError: fetch failed` → APICallError（**无 statusCode**）那条分支。
    const message = await realFailureMessage("http://127.0.0.1:1/v1", 0);
    const report = classifyGenerationError(message);
    expect(parseVendorErrorFromMessage(message)?.category).toBe("network");
    expect(parseVendorErrorFromMessage(message)?.httpStatus).toBeUndefined();
    expect(report.kind).toBe("network");
    // 这句才是当初的病：把用户自己的网络问题说成服务商的额度/故障，还劝他重试（必再撞）。
    expect(report.hint).not.toMatch(/临时故障|额度问题/);
  });
});
