// agent 流式消费 + 首字块超时 + 流中途空闲超时（从 runtime.ts 抽出——规则 9/12：别喂巨壳，且单点可测）。
//
// 根因修复（2026-06-06「处理中」永转）：模型流无超时 → 端点慢/挂起 = 永久「处理中」。
// 两道闸都汇到同一个 abortController：
//  ① 首字块超时：streamText 启动后 firstChunkTimeoutMs 内无任何 chunk → abort。
//  ② 流中途空闲超时（修首字之后的下半场）：首字到达后若 idleTimeoutMs 内无新 chunk → abort。
//     relay 吐几个 token 后 TCP 半挂起是常见故障，旧实现只堵「首字前挂」漏了「首字后挂」。
// 关键陷阱：等用户确认工具时 fullStream 合法静默（SDK 发 tool-call → execute await 确认 → 发
// tool-result），这段不能算空闲。用在途工具调用计数器 gate idle 计时器：>0 暂停、归 0 恢复
// （计数支持模型一步并行多个 tool-call 的情形）。

import type { AgentChatV2Hooks } from "../runtime";
import { describeAgentError } from "./agentError";
import { vendorStallError } from "./aiSdkVendorError";
import type { VendorRequestError } from "../vendor/vendorHttp";

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
  opts: { firstChunkTimeoutMs: number; idleTimeoutMs: number; label: string; vendorKey?: string },
): Promise<AgentStreamResult> {
  let firstChunkSeen = false;
  // 在途工具调用计数:>0 表示正等用户确认(合法静默),idle 计时器暂停。
  let pendingToolCalls = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const errorContext = { ...(opts.vendorKey ? { vendorKey: opts.vendorKey } : {}) };
  // 我们自己 abort 掉的那次超时——在**触发那一刻**就造好结构化错误(network·可重试)，
  // 与 vendorHttp 给自家超时的待遇一致。不这么做的话它只是一句中文裸串，legacy 正则一个词
  // 都匹配不上('timeout' 是英文)，「端点挂起」会被说成「可能是额度问题」。
  // 抛出的形态由 SDK 层决定(可能被换壳)，所以这里另存一份，catch 时优先用它，不靠反解字符串。
  let stallError: VendorRequestError | null = null;
  const abortStalled = (upstreamMsg: string): void => {
    stallError = vendorStallError(upstreamMsg, errorContext);
    abortController.abort(stallError);
  };

  const clearIdle = (): void => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = undefined; }
  };
  // 重置空闲窗口。仅在没有在途工具确认时才真正武装计时器。
  const armIdle = (): void => {
    clearIdle();
    if (pendingToolCalls > 0) return;
    idleTimer = setTimeout(() => {
      console.error(`[agentv2] 流中途 ${opts.idleTimeoutMs}ms 无新内容，abort（${opts.label}）`);
      abortStalled(`流式 ${opts.idleTimeoutMs / 1000}s 无新内容（端点中途挂起）`);
    }, opts.idleTimeoutMs);
  };

  const timer = setTimeout(() => {
    if (!firstChunkSeen) {
      console.error(`[agentv2] 模型 ${opts.firstChunkTimeoutMs}ms 内无首字块，abort（${opts.label}）`);
      abortStalled(`模型 ${opts.firstChunkTimeoutMs / 1000}s 内无响应（端点慢或挂起）`);
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
      // idle 计时器管理：tool-call=进确认等待(暂停)，tool-result=出确认(恢复)，其余=有活动(重置窗口)。
      if (chunk.type === "tool-call") {
        pendingToolCalls += 1;
        clearIdle();
      } else if (chunk.type === "tool-result") {
        pendingToolCalls = Math.max(0, pendingToolCalls - 1);
        armIdle();
      } else {
        armIdle();
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
        const message = describeAgentError(chunk.error, errorContext);
        console.error(`[agentv2] stream error chunk: ${message}`);
        hooks.emit({ type: "error", message });
      }
      // tool-call / tool-result 已在各工具 execute 里 emit，这里忽略 SDK 镜像事件避免重复。
    }
  } catch (streamError: unknown) {
    // abort（首字块/空闲超时）或流式异常 → 收口成 error 事件，避免 UI 永远「处理中」。
    // 超时是我们自己按下的，用当时造好的结构化错误，不去反解 SDK 换过壳的抛出物。
    const message = describeAgentError(stallError ?? streamError, errorContext);
    console.error(`[agentv2] 流式中断: ${message}`);
    hooks.emit({ type: "error", message });
    hooks.emit({ type: "finish", finishReason: "error", usage: finalUsage });
    return { finalText, finalFinish: "error", finalUsage, ok: false };
  } finally {
    clearTimeout(timer);
    clearIdle();
  }

  hooks.emit({ type: "finish", finishReason: finalFinish, usage: finalUsage });
  return { finalText, finalFinish, finalUsage, ok: true };
}
