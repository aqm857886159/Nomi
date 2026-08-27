import { afterEach, expect, it, vi } from 'vitest';
import type { Session } from 'electron';
import { createServer } from 'node:http';
import { once } from 'node:events';

// Transport assertions must exercise the production entry, not the domain-test fixture.
vi.unmock('./appFetch');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

it('does not send any request before a network configuration has been confirmed', async () => {
  const send = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
  const { appFetch } = await import('./appFetch');
  await expect(appFetch('https://fixture.invalid')).rejects.toThrow(/not ready/);
  expect(send).not.toHaveBeenCalled();
});

it('first configuration failure is visible and never silently confirms direct routing', async () => {
  const send = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
  const proxy = await import('./systemProxy');
  const error = new Error('Synthetic session policy failure');
  await proxy.applySystemProxy({ setProxy: async () => { throw error; } } as unknown as Session,
    { mode: 'custom', customUrl: 'http://127.0.0.1:8100' });
  const { appFetch } = await import('./appFetch');
  await expect(appFetch('https://fixture.invalid')).rejects.toBe(error);
  expect(proxy.getProxyStatus().unsupported).toContain(error.message);
  expect(send).not.toHaveBeenCalled();
});

it('explicit local RPC and private services stay directly reachable after public proxy initialization fails', async () => {
  const send = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
  const proxy = await import('./systemProxy');
  await proxy.applySystemProxy({ setProxy: async () => { throw new Error('Public proxy unavailable'); } } as unknown as Session,
    { mode: 'custom', customUrl: 'http://127.0.0.1:8100' });
  const { appFetch } = await import('./appFetch');
  for (const target of ['http://127.0.0.1:8123/rpc', 'http://192.168.1.2:8188/system_stats']) {
    await expect(appFetch(target)).resolves.toMatchObject({ status: 200 });
  }
  expect(send).toHaveBeenCalledTimes(2);
  await expect(appFetch('https://public-fixture.invalid')).rejects.toThrow('Public proxy unavailable');
  expect(send).toHaveBeenCalledTimes(2);
});

it('real local RPC remains reachable, but its public redirect cannot inherit private bypass', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: 'http://public-fixture.invalid/never-send' });
      response.end();
    } else response.end('local rpc');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected local TCP fixture');
  const proxy = await import('./systemProxy');
  const failure = new Error('Public proxy unavailable');
  await proxy.applySystemProxy({ setProxy: async () => { throw failure; } } as unknown as Session,
    { mode: 'custom', customUrl: 'http://127.0.0.1:8100' });
  const { appFetch } = await import('./appFetch');
  try {
    const response = await appFetch(new Request(`http://127.0.0.1:${address.port}/rpc`));
    expect(await response.text()).toBe('local rpc');
    await expect(appFetch(`http://127.0.0.1:${address.port}/redirect`)).rejects.toMatchObject({ cause: failure });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('the first request waits for boot configuration and preserves native Request identity', async () => {
  const send = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
  const proxy = await import('./systemProxy');
  const started = deferred<void>();
  const ready = deferred<void>();
  const boot = proxy.applySystemProxy({ setProxy: async () => {
    started.resolve();
    await ready.promise;
  } } as unknown as Session, { mode: 'off', customUrl: '' });
  await started.promise;
  const { appFetch } = await import('./appFetch');
  const request = new Request('https://fixture.invalid/upload', { method: 'POST', body: 'native request body',
    headers: { Authorization: 'Bearer synthetic-literal' } });
  const sending = appFetch(request);
  await Promise.resolve();
  expect(send).not.toHaveBeenCalled();
  ready.resolve();
  await Promise.all([boot, sending]);
  expect(send.mock.calls[0][0]).toBe(request);
  expect(request.bodyUsed).toBe(false);
  expect(send.mock.calls[0][1]).toMatchObject({ dispatcher: expect.objectContaining({ dispatch: expect.any(Function) }) });
});

it('cancellation during network initialization rejects promptly with the original reason and no send', async () => {
  const send = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
  const proxy = await import('./systemProxy');
  const ready = deferred<void>();
  const boot = proxy.applySystemProxy({ setProxy: async () => ready.promise } as unknown as Session,
    { mode: 'off', customUrl: '' });
  const { appFetch } = await import('./appFetch');
  const controller = new AbortController();
  const request = new Request('https://fixture.invalid', { signal: controller.signal });
  const sending = appFetch(request);
  const stopped = new Error('Synthetic user stop');
  controller.abort(stopped);
  try {
    await expect(sending).rejects.toBe(stopped);
    expect(send).not.toHaveBeenCalled();
  } finally {
    ready.resolve();
    await boot;
  }
});

it('an explicit null signal keeps native Request cancellation override semantics', async () => {
  const send = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
  const proxy = await import('./systemProxy');
  await proxy.applySystemProxy({ setProxy: async () => {} } as unknown as Session, { mode: 'off', customUrl: '' });
  const { appFetch } = await import('./appFetch');
  const request = new Request('https://fixture.invalid', { signal: AbortSignal.abort() });
  await expect(appFetch(request, { signal: null })).resolves.toMatchObject({ status: 200 });
  expect(send).toHaveBeenCalledWith(request, expect.objectContaining({ signal: null }));
});

it('transport rejection is not wrapped, flattened or retried', async () => {
  const original = new TypeError('fetch failed', { cause: Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' }) });
  const send = vi.spyOn(globalThis, 'fetch').mockRejectedValue(original);
  const proxy = await import('./systemProxy');
  await proxy.applySystemProxy({ setProxy: async () => {} } as unknown as Session, { mode: 'off', customUrl: '' });
  const { appFetch } = await import('./appFetch');
  await expect(appFetch('https://fixture.invalid')).rejects.toBe(original);
  expect(send).toHaveBeenCalledTimes(1);
});

it('a later SDK global fetch replacement cannot change the native fetch implementation owned by the app', async () => {
  const native = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
  const proxy = await import('./systemProxy');
  await proxy.applySystemProxy({ setProxy: async () => {} } as unknown as Session, { mode: 'off', customUrl: '' });
  const { appFetch } = await import('./appFetch');
  const foreign = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
  const original = globalThis.fetch;
  globalThis.fetch = foreign;
  try {
    await appFetch('https://fixture.invalid');
    expect(native).toHaveBeenCalledTimes(1);
    expect(foreign).not.toHaveBeenCalled();
  } finally { globalThis.fetch = original; }
});
