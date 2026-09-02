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
import { appFetch } from "../appFetch";
// 单一真相源：provider-kind 联合定义在 catalog/types，这里只 re-export，避免并行定义漂移（规则 1）。
import type { AiSdkProviderKind, Vendor } from "../catalog/types";
import { createExplicitProxyDispatcher } from "../systemProxy";
export type { AiSdkProviderKind };

export interface BuildAiSdkModelInput {
  kind: AiSdkProviderKind;
  baseURL: string;
  apiKey: string;
  /** `none` is supported by OpenAI-compatible gateways and omits Authorization entirely. */
  authType?: Vendor["authType"];
  modelId: string;
  /**
   * Extra HTTP headers sent on every request to the provider. Lets users add
   * relay/proxy auth headers (e.g. `HTTP-Referer`, a second bearer, a vendor's
   * custom gateway token) without us hardcoding per-provider knowledge.
   */
  headers?: Record<string, string>;
  /** Optional per-connection proxy; empty/absent keeps the application route. */
  proxyUrl?: string;
}

/**
 * Wrap the app transport so each request body gets profile-driven adjustments
 * (forced temperature, default max_tokens, extra body fields).
 *
 * Optional debug: set LAB_DEBUG_REQUESTS=1 to dump each request body to /tmp.
 */
function buildProfiledFetch(modelId: string, proxyUrl?: string): typeof fetch {
  const profile = getModelProfile(modelId);
  const debug = process.env.LAB_DEBUG_REQUESTS === "1";
  const dispatcher = proxyUrl ? createExplicitProxyDispatcher(proxyUrl) : undefined;

  return (async (url: RequestInfo | URL, init?: RequestInit) => {
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
      const res = await appFetch(url, { ...init, ...(dispatcher ? { dispatcher } : {}) });
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

/**
 * Anthropic base URLs must carry the version segment: `@ai-sdk/anthropic` defaults to
 * `https://api.anthropic.com/v1` and only appends `/messages` after that base.
 *
 * We persist a host root instead — onboarding probing (onboardingIpc.probeOneProtocol) strips a
 * trailing `/v1` (to avoid double-joining its own `/v1/messages`), so the stored baseUrl is
 * `https://api.anthropic.com`. The two paths hold opposite conventions for the same stored value:
 * the probe side treats it as a root and adds `/v1`; the runtime side needs `/v1` already present.
 *
 * Without this, the runtime POSTs to `{root}/messages` → 404 Not Found, while onboarding probing
 * still succeeds — surfacing as "connection passes, canvas 404s" (2026-08-28: connecting Claude
 * made the agent HTTP 404 on every request). Normalizing on read (not in storage) rescues both
 * legacy libraries already stored as roots and new connections.
 */
export function anthropicBaseUrl(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, "");
  return /\/v\d+$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

export function buildAiSdkModel(input: BuildAiSdkModelInput): LanguageModelV1 {
  const apiKey = (input.apiKey || "").trim();
  const unauthenticated = input.authType === "none";
  if (!apiKey && !unauthenticated) {
    throw new Error("buildAiSdkModel: apiKey is required");
  }
  const modelId = (input.modelId || "").trim();
  if (!modelId) {
    throw new Error("buildAiSdkModel: modelId is required");
  }
  const baseURL = (input.baseURL || "").trim().replace(/\/+$/, "");
  const headers = sanitizeHeaders(input.headers);
  const dispatcher = input.proxyUrl ? createExplicitProxyDispatcher(input.proxyUrl) : undefined;

  if (input.kind === "anthropic") {
    if (unauthenticated) throw new Error("buildAiSdkModel: authType none requires an openai-compatible provider");
    const provider = createAnthropic({
      apiKey,
      fetch: async (url, init) => appFetch(url, { ...init, ...(dispatcher ? { dispatcher } : {}) }),
      ...(baseURL ? { baseURL: anthropicBaseUrl(baseURL) } : {}),
      ...(headers ? { headers } : {}),
    });
    return provider.languageModel(modelId);
  }

  // OpenAI Responses API（/responses）：中转如 foxcode codex 渠道 wire_api=responses，只认 /responses，
  // 走 chat/completions 会 502（2026-06-06 实测根因）。用官方 @ai-sdk/openai 的 .responses()。
  if (input.kind === "openai-responses") {
    if (unauthenticated) throw new Error("buildAiSdkModel: authType none requires an openai-compatible provider");
    if (!baseURL) throw new Error("buildAiSdkModel: baseURL is required for openai-responses");
    const provider = createOpenAI({
      apiKey,
      baseURL,
      ...(headers ? { headers } : {}),
      fetch: buildProfiledFetch(modelId, input.proxyUrl),
    });
    return provider.responses(modelId);
  }

  if (!baseURL) {
    throw new Error("buildAiSdkModel: baseURL is required for openai-compatible providers");
  }
  const provider = createOpenAICompatible({
    name: "nomi",
    baseURL,
    ...(apiKey ? { apiKey } : {}),
    ...(headers ? { headers } : {}),
    fetch: buildProfiledFetch(modelId, input.proxyUrl),
  });
  return provider.chatModel(modelId);
}

// Re-export profile lookup for the onboarding wizard's capability test.
export { getModelProfile } from "./modelProfiles";
