import { describe, expect, it, vi } from 'vitest';
import { providerRetryAfterMs, withProviderTextTraffic } from './providerTrafficFetch';
import { providerTrafficScheduler } from './providerTrafficScheduler';

describe('text traffic stream ownership', () => {
  it('parses Retry-After seconds and dates without a guessed delay', () => {
    expect(providerRetryAfterMs('12')).toBe(12_000);
    expect(providerRetryAfterMs('Thu, 10 Sep 2026 00:00:12 GMT', Date.parse('2026-09-10T00:00:00Z'))).toBe(12_000);
    expect(providerRetryAfterMs('garbage')).toBeUndefined();
    expect(providerRetryAfterMs('-1')).toBeUndefined();
  });
  it.each(['', '/'])('keeps a Request body intact and holds the permit through the full response (suffix %s)', async (suffix) => {
    const release = vi.fn();
    const acquire = vi.spyOn(providerTrafficScheduler, 'acquire').mockResolvedValue({ release, rateLimited: vi.fn() });
    let finish!: () => void;
    const send = vi.fn<typeof fetch>(async (input) => {
      expect(await (input as Request).clone().json()).toEqual({ model: 'deepseek-v4-pro' });
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('hello')); finish = () => controller.close(); } }));
    });
    try {
      const response = await withProviderTextTraffic(send)(new Request(`https://api.deepseek.com/chat/completions${suffix}`, { method: 'POST', body: JSON.stringify({ model: 'deepseek-v4-pro' }) }));
      expect(acquire.mock.calls[0][0].inflight).toBe(500);
      expect(release).not.toHaveBeenCalled();
      const read = response.text(); finish();
      expect(await read).toBe('hello');
      expect(release).toHaveBeenCalledWith(true);
    } finally { acquire.mockRestore(); }
  });
  it('releases rejected responses even when the SDK never reads their body', async () => {
    const release = vi.fn(), rateLimited = vi.fn();
    const acquire = vi.spyOn(providerTrafficScheduler, 'acquire').mockResolvedValue({ release, rateLimited });
    try {
      const send = vi.fn<typeof fetch>(async () => new Response('busy', { status: 429, headers: { 'Retry-After': '3' } }));
      const response = await withProviderTextTraffic(send)('https://api.deepseek.com/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'deepseek-v4-pro' }) });
      expect(response.status).toBe(429);
      expect(rateLimited).toHaveBeenCalledWith(3000);
      expect(release).toHaveBeenCalledWith(false);
      await response.body?.cancel();
    } finally { acquire.mockRestore(); }
  });
  it('releases an aborted stream even when its caller stops reading', async () => {
    const release = vi.fn(), cancel = vi.fn();
    const acquire = vi.spyOn(providerTrafficScheduler, 'acquire').mockResolvedValue({ release, rateLimited: vi.fn() });
    try {
      const abort = new AbortController();
      const send = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ cancel })));
      await withProviderTextTraffic(send)('https://api.deepseek.com/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'deepseek-v4-pro' }), signal: abort.signal });
      abort.abort();
      expect(release).toHaveBeenCalledWith(false);
      expect(cancel).toHaveBeenCalled();
    } finally { acquire.mockRestore(); }
  });
});
