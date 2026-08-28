import { describe, expect, it } from "vitest";
import { buildOpenAiCompatibleDraft } from "./builtinOpenAiCompatibleDraft";

// 2026-08-28 用户接 Claude 实测:连接检查通过,但「验证全部」每次卡到 90s 超时,面板报
// 「没有能力通过验证 / 还不能在画布上使用」。
//
// 根因:文字模型的验证通道写死了 OpenAI 契约(`/v1/chat/completions` + OpenAI body),不看 providerKind。
// 对 Anthropic 端点那个路径不存在 → 验证一直失败到超时。而 onboarding 的协议探测是另一条代码路径,
// 它自己拼对了 `/v1/messages`,所以「连接能过、验证过不了」。
//
// 这条把「验证通道随协议 derive」钉死。
const textModel = [{ modelKey: "claude-opus-5", labelZh: "claude-opus-5", kind: "text" as const }];

function chatOpFor(providerKind: "anthropic" | "openai-compatible", authType: "bearer" | "x-api-key") {
  const draft = buildOpenAiCompatibleDraft({
    baseUrl: "https://api.anthropic.com",
    authType,
    providerKind,
    models: textModel,
  });
  const mode = draft.models[0]?.modes?.find((m) => m.taskKind === "chat");
  if (!mode) throw new Error("no chat mode in draft");
  return mode.create;
}

describe("内置验证草案 — 文字模型的聊天通道随协议 derive", () => {
  it("anthropic 走 /v1/messages,不是 /chat/completions", () => {
    const op = chatOpFor("anthropic", "x-api-key");
    expect(op.path).toBe("/v1/messages");
    expect(op.path).not.toContain("chat/completions");
  });

  it("anthropic 带 anthropic-version,且 max_tokens 必填(缺了 Anthropic 直接 400)", () => {
    const op = chatOpFor("anthropic", "x-api-key");
    expect(op.headers?.["anthropic-version"]).toBe("2023-06-01");
    expect((op.body as Record<string, unknown>).max_tokens).toBeTypeOf("number");
  });

  // 鉴权头由 withAuthHeader 按 authType 补:anthropic 用 x-api-key,且不能残留 Bearer。
  it("anthropic 用 x-api-key,不留 Authorization", () => {
    const op = chatOpFor("anthropic", "x-api-key");
    expect(op.headers?.["x-api-key"]).toBe("{{user_api_key}}");
    expect(op.headers?.Authorization).toBeUndefined();
  });

  it("非 anthropic 协议照旧走 OpenAI 契约(没被这次改动带偏)", () => {
    const op = chatOpFor("openai-compatible", "bearer");
    expect(op.path).toBe("/v1/chat/completions");
    expect(op.headers?.Authorization).toBe("Bearer {{user_api_key}}");
    expect(op.headers?.["anthropic-version"]).toBeUndefined();
  });
});
