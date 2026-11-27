import { describe, expect, it } from "vitest";
import { describeAgentError, describeEmptyAgentReply } from "./agentError";
import { modelCallFailure } from "./runtimeVendorError";
import { parseVendorErrorFromMessage, stripVendorErrorMarker } from "../shared/generationFailure";

/** 服务商回了非 2xx：传输层记下的事实 → 文本任务抛出的那个错误（与生产同一个映射）。 */
function httpFailure(status: number, body = "", vendorKey = "relay"): Error {
  return modelCallFailure({ vendorKey, attempt: { kind: "http", status, body, url: "https://relay.example/v1/chat/completions" } });
}

describe("describeAgentError", () => {
  it("surfaces the upstream human message hidden in a JSON body", () => {
    // The real dm-fox / gpt-5.5 case: HTTP 400 with a useful business message.
    const out = describeAgentError(httpFailure(400, JSON.stringify({ error: { message: "官方算力限制，请等待一段时间后再进行使用" } })));
    expect(out).toContain("官方算力限制");
    expect(out).toContain("400");
  });

  it("reads the common { msg } / { message } envelope shapes", () => {
    expect(describeAgentError(httpFailure(429, JSON.stringify({ msg: "rate limited" })))).toContain("rate limited");
    expect(describeAgentError(httpFailure(500, JSON.stringify({ message: "upstream down" })))).toContain("upstream down");
    expect(describeAgentError(httpFailure(400, JSON.stringify({ error: "plain string error" })))).toContain("plain string error");
  });

  it("keeps plain-text business details and leaves HTML out of the HTTP payload's upstream message", () => {
    const upstream = (body: string) => parseVendorErrorFromMessage(describeAgentError(httpFailure(401, body)));
    expect(upstream("  请先启用此模型。  ")?.upstreamMsg).toBe("请先启用此模型。");
    expect(upstream("<!DOCTYPE html><html><body>Sign in</body></html>")).toMatchObject({
      httpStatus: 401, category: "auth", upstreamMsg: "",
    });
  });

  it("handles plain Errors and non-errors", () => {
    expect(describeAgentError(new Error("boom"))).toBe("boom");
    expect(describeAgentError("just a string")).toBe("just a string");
  });

  // 这个漏斗把厂商失败的 category 结构化带过 IPC，让渲染层不必用关键词猜。两端契约在这里对账：
  // 电子侧编码 ↔ 共享层 generationFailure 解码，改一端不改另一端立刻红。
  it("厂商失败带上结构化 category，且剥掉标记后展示串一字未变", () => {
    const out = describeAgentError(httpFailure(401, JSON.stringify({ error: { message: "Unauthorized" } }), "apimart"));
    expect(parseVendorErrorFromMessage(out)).toMatchObject({ category: "auth", httpStatus: 401, vendorKey: "apimart" });
    expect(stripVendorErrorMarker(out)).toBe("（HTTP 401）Unauthorized");
  });

  it("不是厂商失败的不加标记（没配模型 / 图片读不出 / 用户点停止）", () => {
    expect(parseVendorErrorFromMessage(describeAgentError(new Error("No local text model is configured.")))).toBeNull();
  });
});

describe("describeEmptyAgentReply", () => {
  it("explains a length-truncation and steers to a stronger model", () => {
    const out = describeEmptyAgentReply("length", {
      modelLabel: "moonshot-v1-128k-vision-preview",
      agentSuitability: "poor",
      agentNote: "Moonshot v1 series truncates tool-call argument JSON mid-stream.",
    });
    // Names the cause (length cap / truncation) ...
    expect(out).toMatch(/长度|截断/);
    // ... carries the model name ...
    expect(out).toContain("moonshot-v1-128k-vision-preview");
    // ... and guides toward a general chat model.
    expect(out).toMatch(/GPT-4o|Claude|Gemini|通用/);
  });

  it("returns empty string for finish reasons that are not a recognized failure", () => {
    // stop / tool-calls with empty text is ambiguous — not our truncation bug.
    expect(describeEmptyAgentReply("stop", { modelLabel: "x" })).toBe("");
    expect(describeEmptyAgentReply("tool-calls", { modelLabel: "x" })).toBe("");
  });
});
