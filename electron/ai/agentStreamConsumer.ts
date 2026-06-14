// agent 流式消费 + 首字块超时（从 runtime.ts 抽出——规则 9/12：别喂巨壳，且单点可测）。
//
// 根因修复（2026-06-06「处理中」永转）：模型流无超时 → 端点慢/挂起 = 永久「处理中」。
// 首字块超时：streamText 启动后若 firstChunkTimeoutMs 内无任何 chunk → abort → 报错收口。
// 只超「等模型首响应」，不超「等用户确认工具」（确认在首字块之后发生，那时 timer 已清）。

import type { AgentChatV2Hooks } from "../runtime";
import { describeAgentError } from "./agentError";

type StreamChunk = {
  type: string;
  textDelta?: string;
  finishReason?: string;
  usage?: unknown;
  error?: unknown;
};

export type AgentStreamResult = {
  finalText: string;
  finalFinish: string;
  finalUsage: unknown;
  ok: boolean;
};

/**
 * 消费 streamText 的 fullStream，带首字块超时。emit content-delta/step-finish/error/finish。
 * 返回 {finalText, finalFinish, finalUsage, ok}；ok=false 表示中断/报错（调用方据此决定是否落历史）。
 * abortController 必须就是传给 streamText 的那个（其 signal 用于超时 abort）。
 */
export async function consumeAgentStreamWithTimeout(
  result: { fullStream: AsyncIterable<StreamChunk> },
  abortController: AbortController,
  hooks: AgentChatV2Hooks,
  opts: { firstChunkTimeoutMs: number; label: string },
): Promise<AgentStreamResult> {
  let firstChunkSeen = false;
  const timer = setTimeout(() => {
    if (!firstChunkSeen) {
      console.error(`[agentv2] 模型 ${opts.firstChunkTimeoutMs}ms 内无首字块，abort（${opts.label}）`);
      abortController.abort(new Error(`模型 ${opts.firstChunkTimeoutMs / 1000}s 内无响应（端点慢或挂起）`));
    }
  }, opts.firstChunkTimeoutMs);

  let finalText = "";
  let finalFinish = "unknown";
  let finalUsage: unknown;
  // 缓存命中观测:vendor 前缀缓存命中的输入 token(OpenAI cachedPromptTokens /
  // Anthropic cacheReadInputTokens / DeepSeek prompt_cache_hit_tokens 等)。
  // 多步轮按 step 累加(finish 块的 providerMetadata 只带最后一步)。
  let cachedPromptTokens = 0;

  const harvestCached = (meta: unknown): void => {
    if (!meta || typeof meta !== "object") return;
    for (const provider of Object.values(meta as Record<string, unknown>)) {
      if (!provider || typeof provider !== "object") continue;
      const rec = provider as Record<string, unknown>;
      const hit = [rec.cachedPromptTokens, rec.cacheReadInputTokens, rec.promptCacheHitTokens, rec.cached_tokens]
        .find((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
      if (typeof hit === "number") cachedPromptTokens += hit;
    }
  };

  try {
    for await (const chunk of result.fullStream) {
      if (!firstChunkSeen) {
        firstChunkSeen = true;
        clearTimeout(timer);
      }
      if (chunk.type === "text-delta") {
        finalText += chunk.textDelta ?? "";
        hooks.emit({ type: "content-delta", delta: chunk.textDelta ?? "" });
      } else if (chunk.type === "step-finish") {
        harvestCached((chunk as { experimental_providerMetadata?: unknown; providerMetadata?: unknown }).providerMetadata
          ?? (chunk as { experimental_providerMetadata?: unknown }).experimental_providerMetadata);
        hooks.emit({ type: "step-finish", finishReason: String(chunk.finishReason ?? "") });
      } else if (chunk.type === "finish") {
        finalFinish = String(chunk.finishReason ?? "unknown");
        finalUsage = chunk.usage;
        // finish 块的 metadata 是最后一步的镜像——step-finish 已逐步累加过就不再吃,只兜底单步流。
        if (cachedPromptTokens === 0) {
          harvestCached((chunk as { experimental_providerMetadata?: unknown; providerMetadata?: unknown }).providerMetadata
            ?? (chunk as { experimental_providerMetadata?: unknown }).experimental_providerMetadata);
        }
        if (cachedPromptTokens > 0 && finalUsage && typeof finalUsage === "object") {
          finalUsage = { ...(finalUsage as Record<string, unknown>), cachedPromptTokens };
        }
      } else if (chunk.type === "error") {
        // 透传上游人话(根因1):APICallError 的 responseBody 里常有真原因(如"官方算力限制"),
        // 别只取 .message(=裸 HTTP 状态文本"Bad Request")。
        const message = describeAgentError(chunk.error);
        console.error(`[agentv2] stream error chunk: ${message}`);
        hooks.emit({ type: "error", message });
      }
      // tool-call / tool-result 已在各工具 execute 里 emit，这里忽略 SDK 镜像事件避免重复。
    }
  } catch (streamError: unknown) {
    // abort（首字块超时）或流式异常 → 收口成 error 事件，避免 UI 永远「处理中」。
    const message = describeAgentError(streamError);
    console.error(`[agentv2] 流式中断: ${message}`);
    hooks.emit({ type: "error", message });
    hooks.emit({ type: "finish", finishReason: "error", usage: finalUsage });
    return { finalText, finalFinish: "error", finalUsage, ok: false };
  } finally {
    clearTimeout(timer);
  }

  hooks.emit({ type: "finish", finishReason: finalFinish, usage: finalUsage });
  return { finalText, finalFinish, finalUsage, ok: true };
}
