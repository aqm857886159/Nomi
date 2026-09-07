import { createProvider, InMemoryCredentialStore, type Api, type Model, type ProviderHeaders,
  type ProviderStreams, type StreamOptions } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import type { NomiModelConfig } from '../runtimePort.js';

export type { NomiModelConfig } from '../runtimePort.js';

export const modelConfigSchema = z.object({
  kind: z.enum(['openai-compatible', 'openai-responses', 'anthropic']),
  providerId: z.string().min(1).refine((value) => value === value.trim(), 'providerId must be exact'),
  modelId: z.string().min(1).refine((value) => value === value.trim(), 'modelId must be exact'),
  baseURL: z.string().url().refine((value) => /^https?:\/\//.test(value), 'HTTP model endpoint required'),
  authType: z.enum(['api-key', 'none']),
  apiKey: z.string().optional(),
  headers: z.record(z.string()).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  temperature: z.number().finite().optional(),
}).superRefine((model, ctx) => {
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

/**
 * Provider assembly, extracted so the two Nomi call sites build **one** pi provider
 * instead of two lookalikes: the legacy `createAgentSession` path (below) and the
 * `AgentHarness` lane (`electron/agentLane/`), which needs a `Models` rather than a
 * `ModelRuntime`. P1: a second copy of this would be a parallel version, and the
 * copy that drifts is always the one nobody is looking at.
 *
 * Literal configuration only; never use registerProvider's command/env-valued config surface.
 */
export async function createNomiProvider(input: NomiModelConfig) {
  const config = configCompatibility.parse(input);
  const credentials = new InMemoryCredentialStore();
  if (config.authType === 'api-key') {
    await credentials.modify(config.providerId, async () => ({ type: 'api_key', key: config.apiKey }));
  }
  const protocol = protocols[config.kind];
  const baseUrl = config.baseURL.replace(/\/+$/, '');
  const model: Model<Api> = {
    provider: config.providerId, id: config.modelId, name: config.modelId,
    api: protocol.api, baseUrl, reasoning: false, input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    // Internal SDK accounting only; onPayload below preserves Nomi's actual
    // configured output cap, or absence of one, instead of sending this bound.
    contextWindow: config.contextWindow ?? 128_000, maxTokens: config.maxOutputTokens ?? 16_384,
  };
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
    ...(config.kind === 'anthropic' ? { fetch: anthropicFetch(baseUrl, options?.fetch ?? globalThis.fetch) } : {}),
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
  const streams: ProviderStreams = {
    stream: (chosen, context, options) => native.stream(chosen, context, requestOptions(options)),
    streamSimple: (chosen, context, options) => native.streamSimple(chosen, context, requestOptions(options)),
  };
  const provider = createProvider({
    id: config.providerId, baseUrl, models: [model], api: streams,
    auth: { apiKey: {
      name: 'Nomi-owned credentials',
      resolve: async ({ credential }) => config.authType === 'none'
        ? { auth: { headers }, source: 'Nomi auth:none' }
        : credential?.key ? { auth: { apiKey: credential.key, headers }, source: 'Nomi memory credential' } : undefined,
    } },
  });
  return { provider, model, credentials };
}

/** The legacy `createAgentSession` seam. Unchanged behaviour; it just no longer owns the assembly. */
export async function createNomiModelRuntime(input: NomiModelConfig) {
  const { provider, model, credentials } = await createNomiProvider(input);
  const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null,
    allowModelNetwork: false, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(provider);
  return { modelRuntime, model };
}
