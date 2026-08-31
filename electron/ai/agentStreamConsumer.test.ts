import { describe, expect, it } from "vitest";
import { consumeAgentStreamWithTimeout } from "./agentStreamConsumer";

const hooks = { emit: () => {} } as unknown as Parameters<typeof consumeAgentStreamWithTimeout>[2];

async function* stream(chunks: unknown[]): AsyncGenerator<never> {
  for (const chunk of chunks) yield chunk as never;
}

const consume = (chunks: unknown[]) =>
  consumeAgentStreamWithTimeout(
    { fullStream: stream(chunks) as never },
    new AbortController(),
    hooks,
    { firstChunkTimeoutMs: 5000, label: "test" },
  );

describe("consumeAgentStreamWithTimeout — 缓存命中观测", () => {
  it("逐 step 累加 providerMetadata 的缓存命中,finish 不重复吃末步镜像", async () => {
    const out = await consume([
      { type: "step-finish", finishReason: "tool-calls", providerMetadata: { openai: { cachedPromptTokens: 4000 } } },
      { type: "step-finish", finishReason: "stop", providerMetadata: { openai: { cachedPromptTokens: 9000 } } },
      { type: "finish", finishReason: "stop", usage: { promptTokens: 20000, completionTokens: 500, totalTokens: 20500 }, providerMetadata: { openai: { cachedPromptTokens: 9000 } } },
    ]);
    expect((out.finalUsage as { cachedPromptTokens?: number }).cachedPromptTokens).toBe(13000);
  });

  it("单步流(无 step-finish 元数据)由 finish 兜底;Anthropic 字段同样识别", async () => {
    const out = await consume([
      { type: "finish", finishReason: "stop", usage: { promptTokens: 8000, completionTokens: 200, totalTokens: 8200 }, providerMetadata: { anthropic: { cacheReadInputTokens: 6500 } } },
    ]);
    expect((out.finalUsage as { cachedPromptTokens?: number }).cachedPromptTokens).toBe(6500);
  });

  it("vendor 不回报 → usage 不长出字段(缺省=未知,不冒充 0%)", async () => {
    const out = await consume([
      { type: "finish", finishReason: "stop", usage: { promptTokens: 8000, completionTokens: 200, totalTokens: 8200 } },
    ]);
    expect((out.finalUsage as { cachedPromptTokens?: number }).cachedPromptTokens).toBeUndefined();
  });
});
