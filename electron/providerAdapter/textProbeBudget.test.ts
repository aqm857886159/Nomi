// 探测额度的回归钉子（2026-08-11 用户接 DeepSeek V4 踩到）。
//
// 思考型模型（DeepSeek V4 / R1 / o 系…）先花 token 思考再写正文，思考的 token 同样计入
// max_tokens，而 AI SDK 的 textStream **只含正文**。旧值 maxTokens: 24 被思考全部吃光 →
// 正文为空 → 探测判「模型不可用」，把完全正常的模型判死（实测 deepseek-v3.1-250821：
// max_tokens=24 → finish_reason=length、content=""；=2048 → "ready"，只用 35 token）。
//
// 这里不测「等于某个具体数值」（阈值可以调），测的是**不能再回到饿死思考模型的量级**。
import { describe, expect, it, vi } from "vitest";
import type { Model, Vendor } from "../catalog/types";
import type { AdapterModeDraft } from "./types";

const streamTextTask = vi.fn().mockResolvedValue({ text: "ready", raw: {} });
vi.mock("../ai/streamTextTask", () => ({ streamTextTask: (...args: unknown[]) => streamTextTask(...args) }));

const { verifyAdapterMode } = await import("./verifier");

const now = "2026-08-12T00:00:00.000Z";
const vendor: Vendor = {
  key: "api-deepseek-com",
  name: "DeepSeek",
  enabled: false,
  baseUrlHint: "https://api.deepseek.com/v1",
  authType: "bearer",
  createdAt: now,
  updatedAt: now,
};
const model: Model = {
  vendorKey: vendor.key,
  modelKey: "deepseek-v3.1-250821",
  labelZh: "deepseek-v3.1-250821",
  kind: "text",
  enabled: false,
  createdAt: now,
  updatedAt: now,
};
const chatMode: AdapterModeDraft = {
  taskKind: "chat",
  create: { method: "POST", path: "/chat/completions" },
  testParams: {},
  sourceUrls: ["https://api-docs.deepseek.com/"],
};

describe("text probe token budget", () => {
  it("leaves room for a thinking preamble instead of starving it", async () => {
    streamTextTask.mockClear();

    const verification = await verifyAdapterMode({ vendor, model, apiKey: "sk-test", mode: chatMode });

    expect(verification.ok).toBe(true);
    const [input] = streamTextTask.mock.calls[0] as [{ maxTokens?: number }];
    // 一次思考前言轻松就是几百 token；几十个 token 的额度必然只够思考、正文一个字都出不来。
    expect(input.maxTokens).toBeGreaterThanOrEqual(1_024);
  });
});
