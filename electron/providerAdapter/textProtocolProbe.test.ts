// 认证时的文本协议探测（2026-10-27 默认 Responses，不支持才回 Chat）。走真探测 → 真 pi-ai → 真 HTTP（本机假上游，零额度）：
// 裁判是 pi 的 Responses 解析器本身，所以每一种「不是 Responses」都用一段真实的线上字节造出来，而不是桩掉 SDK。
// ⚠ 判据只认协议：用例里刻意放了 new-api 的 convert_request_failed，证明结论不靠任何平台文案。
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => (await import("../../tests/fixtures/textTasks/textTaskCallerState")).electronMock());

import type { Model, Vendor } from "../catalog/types";
import { probeTextProtocol, textProtocolProbeEligible } from "./textProtocolProbe";
import { reply, startTextUpstream, type UpstreamProtocol, type UpstreamReply } from "../../tests/fixtures/textTasks/textUpstream";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });

const model: Model = { modelKey: "gpt-x", vendorKey: "relay", labelZh: "GPT X", kind: "text", enabled: true, createdAt: "", updatedAt: "" };
const vendorAt = (baseURL: string, overrides: Partial<Vendor> = {}): Vendor => ({
  key: "relay", name: "Relay", enabled: true, authType: "bearer", providerKind: "openai-compatible", baseUrlHint: baseURL,
  createdAt: "", updatedAt: "", ...overrides,
});

/** 起一个上游，它在 /responses 上按 protocol 的线格式回 answer。 */
async function probeAgainst(protocol: UpstreamProtocol, answer: UpstreamReply, signal?: AbortSignal) {
  const server = await startTextUpstream(protocol, () => answer);
  closers.push(server.close);
  const verdict = await probeTextProtocol({ vendor: vendorAt(server.baseURL), model, apiKey: "sk-probe", signal });
  return { verdict, requests: server.requests };
}

describe("probeTextProtocol — pi 的 Responses 解析器认得回包才算 Responses", () => {
  it("真 Responses 流 → openai-responses；请求是一次最小的 /responses（16 token、不重试）", async () => {
    const { verdict, requests } = await probeAgainst("openai-responses", reply.text("hi"));
    expect(verdict).toBe("openai-responses");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "POST", path: "/v1/responses", body: { model: "gpt-x", max_output_tokens: 16 } });
  });

  it("推理模型 16 token 全花在思考上（incomplete: max_output_tokens）→ 协议照样通", async () => {
    const { verdict } = await probeAgainst("openai-responses", { type: "stream", steps: [{ kind: "finish", reason: "length" }] });
    expect(verdict).toBe("openai-responses");
  });

  it.each<[string, UpstreamProtocol, UpstreamReply]>([
    ["404 路由不存在（SiliconFlow / Gemini）", "openai-responses", reply.http(404, { error: { message: "Not Found" } })],
    ["400 渠道不支持转换（new-api convert_request_failed）", "openai-responses", reply.http(400, { error: { message: "not implemented", type: "new_api_error", code: "convert_request_failed" } })],
    ["200 但回的是 Chat Completions 的 JSON", "openai-responses", reply.http(200, { id: "c", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }] })],
    ["200 但回的是 Chat Completions 的 SSE", "openai-compatible", reply.text("hi")],
    ["流里报错（response.failed / error 事件）", "openai-responses", reply.sseError("upstream exploded")],
    ["连接被重置", "openai-responses", reply.reset()],
  ])("%s → openai-compatible，不抛", async (_name, protocol, answer) => {
    const { verdict, requests } = await probeAgainst(protocol, answer);
    expect(verdict).toBe("openai-compatible");
    expect(requests).toHaveLength(1);
  });

  it("取消（认证被用户取消 / 到点）→ openai-compatible，不抛、不挂", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const { verdict } = await probeAgainst("openai-responses", reply.silent(), controller.signal);
    expect(verdict).toBe("openai-compatible");
  });
});

describe("textProtocolProbeEligible — 只探 OpenAI 家文本、用户没亲手选协议的连接", () => {
  const chat = { taskKind: "chat" } as Parameters<typeof textProtocolProbeEligible>[2];
  it.each<[string, Vendor, Model, boolean]>([
    ["OpenAI 兼容 + 文本 chat", vendorAt("https://relay.test/v1"), model, true],
    ["providerKind 缺省按 OpenAI 兼容", vendorAt("https://relay.test/v1", { providerKind: undefined }), model, true],
    ["用户亲手选了协议", vendorAt("https://relay.test/v1", { meta: { providerKindPinned: true } }), model, false],
    ["Anthropic", vendorAt("https://relay.test/v1", { providerKind: "anthropic" }), model, false],
    ["连接本来就是 Responses", vendorAt("https://relay.test/v1", { providerKind: "openai-responses" }), model, false],
    ["kind = image（不探）", vendorAt("https://relay.test/v1"), { ...model, kind: "image" }, false],
  ])("%s", (_name, vendor, candidate, expected) => {
    expect(textProtocolProbeEligible(vendor, candidate, chat)).toBe(expected);
  });
});
