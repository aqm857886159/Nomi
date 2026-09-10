import { describe, expect, it } from 'vitest';
import { resolveProviderTrafficPolicy } from './providerTrafficPolicy';

describe('provider traffic contract ownership', () => {
  it('does not turn an unpublished APIMart limit into a guessed number', () => {
    const policy = resolveProviderTrafficPolicy({ baseUrl: 'https://api.apimart.ai', model: 'any-video', kind: 'video' });
    expect(policy.inflight).toBeUndefined();
    expect(policy.requestsPerMinute).toBe(500);
    expect(policy.source).toBe('https://apimart.ai/zh/keys');
  });
  it('uses exact DeepSeek model contracts and does not apply them to proxy services', () => {
    expect(resolveProviderTrafficPolicy({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro', kind: 'text' }).inflight).toBe(500);
    expect(resolveProviderTrafficPolicy({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', kind: 'text' }).inflight).toBe(2500);
    expect(resolveProviderTrafficPolicy({ baseUrl: 'https://proxy.example', model: 'deepseek-v4-pro', kind: 'text' }).inflight).toBeUndefined();
    expect(resolveProviderTrafficPolicy({ baseUrl: 'https://api.deepseek.com', model: 'future-model', kind: 'text' }).inflight).toBeUndefined();
  });
  it('keeps MiniMax region/account/interface dimensions separate', () => {
    const input = { baseUrl: 'https://api.minimaxi.com', model: 'speech-2.6-hd', kind: 'audio' };
    expect(resolveProviderTrafficPolicy(input).requestsPerMinute).toBeUndefined();
    expect(resolveProviderTrafficPolicy({ ...input, accountTier: 'free' }).requestsPerMinute).toBe(10);
    expect(resolveProviderTrafficPolicy({ ...input, accountTier: 'paid' }).requestsPerMinute).toBe(20);
    expect(resolveProviderTrafficPolicy({ ...input, baseUrl: 'https://api.minimax.io' }).requestsPerMinute).toBeUndefined();
    expect(resolveProviderTrafficPolicy({ baseUrl: 'https://api.minimaxi.com', model: 'MiniMax-H3', kind: 'video' }).inflight).toBe(30);
  });
});

describe('provider logical error envelopes', () => {
  it('uses the actual MiniMax envelope without confusing input errors or other providers', async () => {
    const { providerLogicalFailure } = await import('./providerTrafficPolicy');
    for (const code of [1002, 1041, 2045]) expect(providerLogicalFailure('https://api.minimaxi.com', { base_resp: { status_code: code, status_msg: 'limited' } })).toEqual({ code, message: 'limited', rateLimited: true });
    expect(providerLogicalFailure('https://api.minimaxi.com', { base_resp: { status_code: 1039, status_msg: 'adjust max_tokens' } })).toMatchObject({ rateLimited: false });
    expect(providerLogicalFailure('https://api.minimaxi.com', { base_resp: { status_code: 0 } })).toBeUndefined();
    expect(providerLogicalFailure('https://proxy.example', { base_resp: { status_code: 1002 } })).toBeUndefined();
  });
});
