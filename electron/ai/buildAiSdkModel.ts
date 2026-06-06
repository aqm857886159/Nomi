/**
 * AI SDK model factory.
 *
 * Returns a Vercel AI SDK `LanguageModelV1` for either an OpenAI-compatible
 * endpoint (most providers) or the Anthropic Messages API.
 *
 * Provider-specific quirks (Moonshot's `enable_thinking`, reasoning models'
 * fixed temperature, max_tokens defaults) are NOT hardcoded here — they
 * live in `modelProfiles.ts` as data. This module just plumbs the profile
 * through a wrapping fetch.
 *
 * Adding a new quirky provider = adding one entry to modelProfiles, not
 * editing this file.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV1 } from "ai";
import { applyProfileToRequestBody, getModelProfile } from "./modelProfiles";
// 单一真相源：provider-kind 联合定义在 catalog/types，这里只 re-export，避免并行定义漂移（规则 1）。
import type { AiSdkProviderKind } from "../catalog/types";
export type { AiSdkProviderKind };

export interface BuildAiSdkModelInput {
  kind: AiSdkProviderKind;
  baseURL: string;
  apiKey: string;
  modelId: string;
  /**
   * Extra HTTP headers sent on every request to the provider. Lets users add
   * relay/proxy auth headers (e.g. `HTTP-Referer`, a second bearer, a vendor's
   * custom gateway token) without us hardcoding per-provider knowledge.
   */
  headers?: Record<string, string>;
}

/**
 * Wrap the global fetch so each request body gets profile-driven adjustments
 * (forced temperature, default max_tokens, extra body fields).
 *
 * Optional debug: set LAB_DEBUG_REQUESTS=1 to dump each request body to /tmp.
 */
function buildProfiledFetch(modelId: string): typeof fetch {
  const profile = getModelProfile(modelId);
  const debug = process.env.LAB_DEBUG_REQUESTS === "1";

  return (async (url: any, init?: any) => {
    if (init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        const adjusted = applyProfileToRequestBody(body, profile);
        if (debug) {
          const fs = await import("node:fs");
          fs.writeFileSync(
            `/tmp/lab-request-${Date.now()}.json`,
            JSON.stringify(adjusted, null, 2),
          );
        }
        init = { ...init, body: JSON.stringify(adjusted) };
      } catch {
        /* body is not JSON — pass through unchanged */
      }
    }
    // 可观测：vendor HTTP **失败时**打实际 URL + 状态 + 上游返回体片段（诊断 502/超时/路由错的根因，别靠猜——
    // 见 docs/workflow/2026-06-06-real-generation-e2e-loop.md「主进程埋点」）。成功不打，避免噪音。
    const urlStr = typeof url === "string" ? url : ((url as { url?: string })?.url || String(url));
    try {
      const res = await fetch(url as any, init);
      if (!res.ok) {
        let snippet = "";
        try { snippet = (await res.clone().text()).replace(/\s+/g, " ").slice(0, 300); } catch { /* body unreadable */ }
        console.error(`[vendor-http] ${res.status} ${res.statusText} ← ${urlStr} (model=${modelId}) :: ${snippet}`);
      }
      return res;
    } catch (fetchError: unknown) {
      console.error(`[vendor-http] fetch threw ← ${urlStr} (model=${modelId}) :: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
      throw fetchError;
    }
  }) as typeof fetch;
}

/**
 * Drop blank keys/values and trim, returning undefined when nothing usable is
 * left so callers can spread conditionally.
 */
function sanitizeHeaders(
  raw: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!raw) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const k = (key || "").trim();
    const v = (value || "").trim();
    if (k && v) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function buildAiSdkModel(input: BuildAiSdkModelInput): LanguageModelV1 {
  const apiKey = (input.apiKey || "").trim();
  if (!apiKey) {
    throw new Error("buildAiSdkModel: apiKey is required");
  }
  const modelId = (input.modelId || "").trim();
  if (!modelId) {
    throw new Error("buildAiSdkModel: modelId is required");
  }
  const baseURL = (input.baseURL || "").trim().replace(/\/+$/, "");
  const headers = sanitizeHeaders(input.headers);

  if (input.kind === "anthropic") {
    const provider = createAnthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      ...(headers ? { headers } : {}),
    });
    return provider.languageModel(modelId);
  }

  // OpenAI Responses API（/responses）：中转如 foxcode codex 渠道 wire_api=responses，只认 /responses，
  // 走 chat/completions 会 502（2026-06-06 实测根因）。用官方 @ai-sdk/openai 的 .responses()。
  if (input.kind === "openai-responses") {
    if (!baseURL) throw new Error("buildAiSdkModel: baseURL is required for openai-responses");
    const provider = createOpenAI({
      apiKey,
      baseURL,
      ...(headers ? { headers } : {}),
      fetch: buildProfiledFetch(modelId),
    });
    return provider.responses(modelId);
  }

  if (!baseURL) {
    throw new Error("buildAiSdkModel: baseURL is required for openai-compatible providers");
  }
  const provider = createOpenAICompatible({
    name: "nomi",
    baseURL,
    apiKey,
    ...(headers ? { headers } : {}),
    fetch: buildProfiledFetch(modelId),
  });
  return provider.chatModel(modelId);
}

// Re-export profile lookup for the onboarding wizard's capability test.
export { getModelProfile } from "./modelProfiles";
