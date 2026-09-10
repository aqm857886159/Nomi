import { providerLogicalFailure, providerRequestPolicy } from './providerTrafficPolicy';
import { providerTrafficScheduler } from './providerTrafficScheduler';

/** HTTP Retry-After is either delay-seconds or a HTTP date (RFC 9110 §10.2.3). */
export function providerRetryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : undefined;
}

/** Text connections count through the complete stream, not just response headers. */
export function withProviderTextTraffic(send: typeof globalThis.fetch, accountTier?: string): typeof globalThis.fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const pathname = new URL(url).pathname;
    if (!/(?:chat\/completions|responses|messages)\/?$/.test(pathname)) return send(input, init);
    const requestBody = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const lease = await providerTrafficScheduler.acquire(providerRequestPolicy({ meta: { accountTier } }, url, requestBody), signal ?? undefined);
    try {
      const response = await send(input, init);
      if (response.headers.get('content-type')?.includes('application/json')) {
        const failure = providerLogicalFailure(url, await response.clone().json().catch(() => undefined));
        if (failure?.rateLimited) {
          lease.rateLimited(providerRetryAfterMs(response.headers.get('retry-after')));
          lease.release(false);
          // Normalize a documented logical rejection for the SDK's existing retry owner.
          return new Response(response.body, { status: 429, statusText: response.statusText, headers: response.headers });
        }
      }
      if (response.status === 429) lease.rateLimited(providerRetryAfterMs(response.headers.get('retry-after')));
      if (!response.ok || !response.body) { lease.release(response.ok); return response; }
      const reader = response.body.getReader();
      const finish = (succeeded: boolean) => { signal?.removeEventListener('abort', abort); lease.release(succeeded); };
      const abort = () => { finish(false); void reader.cancel(signal?.reason).catch(() => undefined); };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) { finish(true); controller.close(); }
            else controller.enqueue(chunk.value);
          } catch (error) { finish(false); controller.error(error); }
        },
        async cancel(reason) { try { await reader.cancel(reason); } finally { finish(false); } },
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) { lease.release(false); throw error; }
  };
}
