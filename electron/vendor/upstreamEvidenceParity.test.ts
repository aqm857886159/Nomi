// 三条把上游失败带过 IPC 的通道（图 / 视频 / JSON 请求的 vendorHttp、文本任务的模型调用、Agent 的 pi 运行时）
// 对**同一份上游响应体**必须带出同一份证据——否则渲染层那一张分类目录会在不同通道上对同一次失败说不同的话。
//
// 为什么单独一个对等测试：每条通道各有自己的单测，但「新增一条证据字段时漏掉某条通道」这件事，单条通道的单测看不见
// （漏掉的那条通道根本没有那条用例）。2026-09-29 加 upstreamCode 时，第三条通道（pi 运行时）就是数门才找出来的。
// 这里把三条通道放在同一张表上：新增字段而某条通道没带，这一条红。
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseVendorErrorFromMessage } from "../../src/workbench/generationCanvas/runner/vendorErrorIpc";
import { modelCallFailure } from "../ai/runtimeVendorError";
import { callModelOnce } from "../agentLane/laneModelCall.mjs";
import { laneVendorFailureText } from "../shared/agentLane/laneAssistantFault";
import type { Vendor } from "../catalog/types";
import { VendorRequestError, requestJson } from "./vendorHttp";
import { setSubmitOutboundDepsForTests } from "./vendorOutboundGuard";

const vendor = { key: "kie", authType: "bearer", baseUrlHint: "https://api.kie.ai" } as unknown as Vendor;

beforeEach(() => {
  // 同 vendorHttp.test.ts：把提交侧出站授权的网络事实钉成「公网、无代理」，本文件只测证据怎么带过去。
  setSubmitOutboundDepsForTests({
    resolve: async () => [{ address: "93.184.216.34", family: 4 as const }],
    readEnvironment: async () => ({ syntheticResolver: false, syntheticSample: "" }),
    isApplicationProxyActive: () => false,
  });
});
afterEach(() => {
  setSubmitOutboundDepsForTests(null);
  vi.unstubAllGlobals();
});

type Evidence = { upstreamCode?: string; category?: string; httpStatus?: number };
const evidenceOf = (structured: (Evidence & Record<string, unknown>) | null | undefined): Evidence => ({
  upstreamCode: typeof structured?.upstreamCode === "string" ? structured.upstreamCode : undefined,
  category: typeof structured?.category === "string" ? structured.category : undefined,
  httpStatus: typeof structured?.httpStatus === "number" ? structured.httpStatus : undefined,
});

async function viaVendorHttp(status: number, body: string): Promise<Evidence> {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));
  const error = await requestJson(vendor, "k", "POST", "https://api.kie.ai/v1/images/generations", {}, {}, {}).catch((cause) => cause);
  assert(error instanceof VendorRequestError);
  return evidenceOf(error.structured);
}

/** 文本任务（2026-10-21 起走 pi-ai 单次调用）：传输层记下的状态码 + 响应体 → modelCallFailure。 */
function viaTextTask(status: number, body: string): Evidence {
  const mapped = modelCallFailure({ vendorKey: "relay", attempt: { kind: "http", status, body, url: "https://relay.example/v1/chat/completions" } });
  return evidenceOf((mapped as VendorRequestError).structured);
}

/**
 * Agent 车道（工作区对话 / 单次提问）：走**真的** provider 装配点（createNomiProvider，经 callModelOnce）与真 pi 协议实现，
 * 只把出网口换成就地回这份响应的 fetch；读的是失败消息上挂的那份载荷（投影错误段读的就是它）。
 * 2026-10-27 之前这里调的是一个没有任何生产调用者的 describeRuntimeError——表上三条通道全绿，
 * 而 Agent 车道真实收到的只有 pi 的展示串（model_not_found 落进「服务商返回了一个没见过的错误」）。
 */
async function viaAgentRuntime(status: number, body: string): Promise<Evidence> {
  const { message } = await callModelOnce({
    model: { kind: "openai-compatible", providerId: "relay", modelId: "fixture-model", baseURL: "https://relay.example/v1", authType: "api-key", apiKey: "sk-fixture" },
    fetch: async () => new Response(body, { status, headers: { "content-type": "application/json" } }),
    content: "x", signal: new AbortController().signal,
  });
  return evidenceOf(parseVendorErrorFromMessage(laneVendorFailureText(message) ?? ""));
}

describe("同一份上游响应体，三条通道带出同一份证据", () => {
  it.each([
    ["OpenAI / new-api 信封：码 + 话", 400, { error: { message: "This model has been deprecated and is no longer available.", code: "model_not_found" } }, "model_not_found"],
    ["顶层字符串码", 400, { code: "model_not_found", message: "no available channel" }, "model_not_found"],
    ["同一个码换了 HTTP 状态码（404）", 404, { error: { message: "The model does not exist", code: "model_not_found" } }, "model_not_found"],
    ["没有码", 400, { error: { message: "Bad Request" } }, undefined],
    ["纯数字业务码不是标识码", 400, { code: 1004, msg: "x" }, undefined],
    ["整句话不是码", 400, { error: { message: "x", code: "this is a sentence, not an identifier" } }, undefined],
  ] as const)("%s", async (_label, status, body, expectedCode) => {
    const text = JSON.stringify(body);
    const http = await viaVendorHttp(status, text);
    const textTask = viaTextTask(status, text);
    const runtime = await viaAgentRuntime(status, text);
    // 三条通道对同一份响应体必须同形：码、分类、状态码逐项相同。
    expect(textTask).toEqual(http);
    expect(runtime).toEqual(http);
    expect(http.upstreamCode).toBe(expectedCode);
  });

  it("响应体不是 JSON 时，三条通道都不写码（不把一段文本当码）", async () => {
    const http = await viaVendorHttp(400, "upstream exploded");
    expect(viaTextTask(400, "upstream exploded")).toEqual(http);
    expect(await viaAgentRuntime(400, "upstream exploded")).toEqual(http);
    expect(http.upstreamCode).toBeUndefined();
  });
});
