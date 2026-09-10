import { withProviderTextTraffic } from '../vendor/providerTrafficFetch.js';
// Agent lane · pi provider 的**唯一装配点**（阶段 4 前置 ③ 从 `harness/runtime/pi/model.mts` 搬来）
//
// 为什么搬：`laneHost.mts` 每开一条 lane 都要调 `createNomiProvider`，而它原来住在
// 阶段 4 要整个删掉的 `electron/harness/runtime/` 里——新通路依赖旧通路目录，这条反向边
// 会让「删旧目录」变成「顺手删掉新通路的模型装配」。搬过来之后旧位置只留一条 re-export
// （`pi/model.mts` 仍导出 `createNomiModelRuntime`，那是旧路 `session.mts` 的专属接缝，
// 随本目录一起死），**不是第二份实现**（P1）。
import { createProvider, InMemoryCredentialStore, type Api, type Model, type ProviderHeaders,
  type ProviderStreams, type StreamOptions } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { z } from 'zod';
import type { NomiModelConfig, NomiPricingBasis } from '../shared/agentLane/laneModelConfig.js';
import { guardProviderStreams, type NomiStreamGuard } from './laneProviderGuard.mjs';

export type { NomiStreamGuard } from './laneProviderGuard.mjs';

export type { NomiModelConfig, NomiPricingBasis } from '../shared/agentLane/laneModelConfig.js';

export const modelConfigSchema = z.object({
  kind: z.enum(['openai-compatible', 'openai-responses', 'anthropic']),
  providerId: z.string().min(1).refine((value) => value === value.trim(), 'providerId must be exact'),
  modelId: z.string().min(1).refine((value) => value === value.trim(), 'modelId must be exact'),
  baseURL: z.string().url().refine((value) => /^https?:\/\//.test(value), 'HTTP model endpoint required'),
  authType: z.enum(['api-key', 'none']),
  apiKey: z.string().optional(),
  headers: z.record(z.string()).optional(),
  accountTier: z.string().optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  temperature: z.number().finite().optional(),
  tokenPricing: z.object({
    inputPerMTokUsd: z.number().finite().nonnegative(),
    outputPerMTokUsd: z.number().finite().nonnegative(),
    cacheReadPerMTokUsd: z.number().finite().nonnegative().optional(),
    cacheWritePerMTokUsd: z.number().finite().nonnegative().optional(),
  }).optional(),
  free: z.literal(true).optional(),
  reasoning: z.boolean().optional(),
  thinkingLevelMap: z.record(z.string().nullable()).optional(),
}).superRefine((model, ctx) => {
  // 一个模型不能既有价目又声明免费：那样「花费」这一行有两个互相矛盾的答案，
  // 而下游必须在两者之间挑一个——挑哪个都是我们在替用户猜。
  if (model.tokenPricing && model.free) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'tokenPricing and free are mutually exclusive' });
  }
  if (model.authType === 'none' && model.kind !== 'openai-compatible') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'auth:none is supported only by openai-compatible' });
  }
  if (model.authType === 'api-key' && !model.apiKey?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'An explicit model API key is required' });
  }
});

// Keep runtime validation private; the CJS/ESM boundary owns the canonical type.
const configCompatibility: z.ZodType<NomiModelConfig> = modelConfigSchema;

const protocols = {
  'openai-compatible': { api: 'openai-completions', streams: openAICompletionsApi },
  'openai-responses': { api: 'openai-responses', streams: openAIResponsesApi },
  anthropic: { api: 'anthropic-messages', streams: anthropicMessagesApi },
} as const;

function anthropicFetch(baseURL: string, fetchRequest: NonNullable<StreamOptions['fetch']>) {
  const base = new URL(baseURL);
  const basePath = base.pathname.replace(/\/+$/, '');
  const send: NonNullable<StreamOptions['fetch']> = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    // Old @ai-sdk/anthropic appends /messages, whereas native Anthropic appends
    // /v1/messages. Rewrite that one known SDK suffix, preserving every user
    // gateway prefix, query parameter and request body (including native PDF).
    if (url.origin !== base.origin || url.pathname !== `${basePath}/v1/messages`) {
      throw new Error('Unexpected Anthropic SDK endpoint');
    }
    url.pathname = `${basePath}/messages`;
    return fetchRequest(input instanceof Request ? new Request(url, input) : url, init);
  };
  return send;
}

/** 每百万 token 的美元价 → pi `ModelCost` 的每百万单价（`calculateCost` 自己除以 1e6）。 */
function modelCost(config: NomiModelConfig): Model<Api>['cost'] {
  const pricing = config.tokenPricing;
  // 没有价目就填零——pi 的类型不给我们「不填」这个选项。零在这里**不是一个断言**，
  // 是一个占位；真正的断言由 `pricingBasis` 带出去，投影层只信它。
  if (!pricing) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  return {
    input: pricing.inputPerMTokUsd,
    output: pricing.outputPerMTokUsd,
    // 供应商不单列缓存价时，缓存读写就是按输入价结算的——`?? 0` 会把它白送出去。
    cacheRead: pricing.cacheReadPerMTokUsd ?? pricing.inputPerMTokUsd,
    cacheWrite: pricing.cacheWritePerMTokUsd ?? pricing.inputPerMTokUsd,
  };
}

/**
 * Provider assembly, extracted so the two Nomi call sites build **one** pi provider
 * instead of two lookalikes: the legacy `createAgentSession` path
 * (`harness/runtime/pi/model.mts`) and the `AgentHarness` lane (`laneHost.mts`), which
 * needs a `Models` rather than a `ModelRuntime`. P1: a second copy of this would be a
 * parallel version, and the copy that drifts is always the one nobody is looking at.
 *
 * Literal configuration only; never use registerProvider's command/env-valued config surface.
 *
 * `guard` 装上传输层看门狗与厂商报文归一（`laneProviderGuard.mts`）。**旧路不传**——它在
 * `run.mts:164` 有自己那处接线（同一个 `observeNativeStream`，不同的预算与失败出口：
 * 旧路要 rejection，harness 要一条可重试的助手消息）。传了就会包两层看门狗。
 */
export function createNomiModelDescriptor(config: NomiModelConfig): Model<Api> {
  const protocol = protocols[config.kind];
  const baseUrl = config.baseURL.replace(/\/+$/, '');
  const model: Model<Api> = {
    provider: config.providerId, id: config.modelId, name: config.modelId,
    api: protocol.api, baseUrl, reasoning: config.reasoning ?? false, input: ['text', 'image'],
    // 契约层不认识 pi 的 `ThinkingLevelMap`（它是 `Partial<Record<ModelThinkingLevel, …>>`），
    // 键的合法性由 pi 自己在 `getSupportedThinkingLevels` 里过滤：认不出的键被忽略、
    // 值为 null 的档被剔掉。这里只负责原样递过去，不在两侧各维护一份档位清单。
    ...(config.thinkingLevelMap
      ? { thinkingLevelMap: config.thinkingLevelMap as Model<Api>['thinkingLevelMap'] } : {}),
    cost: modelCost(config),
    // Internal SDK accounting only; onPayload below preserves Nomi's actual
    // configured output cap, or absence of one, instead of sending this bound.
    contextWindow: config.contextWindow ?? 128_000, maxTokens: config.maxOutputTokens ?? 16_384,
  };
  return model;
}

export async function createNomiProvider(input: NomiModelConfig, fetchRequest: typeof globalThis.fetch, guard?: NomiStreamGuard) {
  if (typeof fetchRequest !== 'function') throw new Error('agent_lane_transport_required');
  const config = configCompatibility.parse(input);
  fetchRequest = withProviderTextTraffic(fetchRequest, config.accountTier);
  const credentials = new InMemoryCredentialStore();
  if (config.authType === 'api-key') {
    await credentials.modify(config.providerId, async () => ({ type: 'api_key', key: config.apiKey }));
  }
  const protocol = protocols[config.kind];
  const baseUrl = config.baseURL.replace(/\/+$/, '');
  const model = createNomiModelDescriptor(config);
  const headers: ProviderHeaders = { ...config.headers };
  if (config.authType === 'none') {
    for (const name of Object.keys(headers)) {
      if (['authorization', 'x-api-key', 'cf-aig-authorization'].includes(name.toLowerCase())) delete headers[name];
    }
    headers.Authorization = null;
  }
  const native = protocol.streams();
  const requestOptions = <T extends StreamOptions>(options?: T) => ({
    ...options,
    // pi requires a nonempty constructor key, even for keyless servers. This is
    // NOT a credential: the public null header suppression removes it on wire.
    ...(config.authType === 'none' ? { apiKey: 'nomi-keyless-constructor-only' } : {}),
    headers: { ...options?.headers, ...headers },
    fetch: config.kind === 'anthropic' ? anthropicFetch(baseUrl, fetchRequest) : fetchRequest,
    onPayload: async (payload: unknown, selected: Model<Api>) => {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Expected a provider request object');
      }
      const body = { ...payload } as Record<string, unknown>;
      delete body.max_tokens;
      delete body.max_completion_tokens;
      delete body.max_output_tokens;
      const cap = options?.maxTokens ?? config.maxOutputTokens ?? (config.kind === 'anthropic' ? 4096 : undefined);
      if (cap !== undefined) {
        body[config.kind === 'openai-responses' ? 'max_output_tokens' : 'max_tokens'] = cap;
      }
      if (config.temperature !== undefined) body.temperature = config.temperature;
      return (await options?.onPayload?.(body, selected)) ?? body;
    },
  });
  const base: ProviderStreams = {
    stream: (chosen, context, options) => native.stream(chosen, context, requestOptions(options)),
    streamSimple: (chosen, context, options) => native.streamSimple(chosen, context, requestOptions(options)),
  };
  const streams = guard ? guardProviderStreams(base, guard) : base;
  const provider = createProvider({
    id: config.providerId, baseUrl, models: [model], api: streams,
    auth: { apiKey: {
      name: 'Nomi-owned credentials',
      resolve: async ({ credential }) => config.authType === 'none'
        ? { auth: { headers }, source: 'Nomi auth:none' }
        : credential?.key ? { auth: { apiKey: credential.key, headers }, source: 'Nomi memory credential' } : undefined,
    } },
  });
  const pricingBasis: NomiPricingBasis = config.tokenPricing ? 'priced' : config.free ? 'free' : 'unpriced';
  return { provider, model, credentials, pricingBasis };
}
