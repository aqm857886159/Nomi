import { afterEach, expect, it, vi } from 'vitest';
import { getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import type { Session } from 'electron';
vi.unmock('./appFetch');

// 主进程诊断输出已收口到 electron/logging/logger（打包后 console.* 没人接住，见
// docs/fixes/2026-09-06-main-process-logs-into-the-void.root-cause.json）。
// 这里断言那个出口——尤其重要的一条没变：代理地址里的凭据不许进日志。
const logged = vi.hoisted(() => [] as { level: string; scope: string; event: string; rest: unknown[] }[])
vi.mock('./logging/logger', () => {
  const record = (level: string) => (scope: string, event: string, ...rest: unknown[]) => {
    logged.push({ level, scope, event, rest })
  }
  return {
    logInfo: record('info'),
    logWarn: record('warn'),
    logError: record('error'),
    logDevDetail: () => undefined,
    logVendorCall: () => undefined,
    installMainLogger: () => undefined,
    currentLogFile: () => '',
  }
})

const originalDispatcher = getGlobalDispatcher();
const envKeys = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function sessionWith(setProxy: Session['setProxy'], resolveProxy: Session['resolveProxy'] = async () => 'DIRECT'): Session {
  return { setProxy, resolveProxy } as Session;
}

afterEach(() => {
  setGlobalDispatcher(originalDispatcher);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

it('publishes the actual route only after Chromium accepts the same configuration', async () => {
  const proxy = await import('./systemProxy');
  await proxy.applySystemProxy(sessionWith(async () => {}), { mode: 'custom', customUrl: 'http://127.0.0.1:8101' });
  const entered = deferred<void>();
  const finish = deferred<void>();
  const applying = proxy.applySystemProxy(sessionWith(async () => {
    entered.resolve();
    await finish.promise;
  }), { mode: 'custom', customUrl: 'http://127.0.0.1:8102' });
  await entered.promise;
  try {
    expect(proxy.getProxyStatus().activeUrl).toBe('http://127.0.0.1:8101');
  } finally {
    finish.resolve();
    await applying;
  }
  expect(proxy.getProxyStatus().activeUrl).toBe('http://127.0.0.1:8102');
});

it('an older delayed system resolution cannot overwrite a later off preference', async () => {
  for (const key of envKeys) vi.stubEnv(key, '');
  const proxy = await import('./systemProxy');
  const resolving = deferred<void>();
  const answer = deferred<string>();
  let chromium: Electron.ProxyConfig = {};
  const session = sessionWith(async (config) => { chromium = config; }, async () => {
    resolving.resolve();
    return answer.promise;
  });
  const old = proxy.applySystemProxy(session, { mode: 'system', customUrl: '' });
  await resolving.promise;
  const latest = proxy.applySystemProxy(session, { mode: 'off', customUrl: '' });
  answer.resolve('PROXY 127.0.0.1:8103');
  await Promise.all([old, latest]);
  expect(proxy.getProxyStatus({ mode: 'off', customUrl: '' }).activeUrl).toBe('');
  expect(chromium).toEqual({ mode: 'direct' });
});

it('failed Chromium application retains the previous actual route rather than advertising the rejected address', async () => {
  const proxy = await import('./systemProxy');
  logged.length = 0;
  await proxy.applySystemProxy(sessionWith(async () => {}), { mode: 'custom', customUrl: 'http://127.0.0.1:8104' });
  await proxy.applySystemProxy(sessionWith(async () => { throw new Error('Proxy configuration rejected'); }),
    { mode: 'custom', customUrl: 'http://127.0.0.1:8105' });
  expect(proxy.getProxyStatus().activeUrl).toBe('http://127.0.0.1:8104');
  expect(proxy.getProxyStatus().unsupported).toMatch(/Proxy configuration rejected/);
  expect(JSON.stringify(logged)).toContain('Proxy configuration rejected');
});

it('logs only the redacted message when a malformed proxy address contains credentials', async () => {
  const proxy = await import('./systemProxy');
  logged.length = 0;
  const prefs = {
    mode: 'custom' as const,
    customUrl: 'socks5://synthetic-user:synthetic-proxy-secret@127.0.0.1:bad-port',
  };
  await proxy.applySystemProxy(sessionWith(async () => {}), prefs);
  const text = JSON.stringify(logged);
  expect(text).toContain('解析不了的 SOCKS 地址');
  expect(text).not.toContain('synthetic-user');
  expect(text).not.toContain('synthetic-proxy-secret');
  expect(logged).toContainEqual(expect.objectContaining({
    level: 'error',
    scope: 'proxy',
    event: 'apply-failed-kept-confirmed-route',
    rest: [undefined, { reason: proxy.getProxyStatus(prefs).unsupported }],
  }));
});

it('application proxy configuration never takes ownership of a third-party global dispatcher', async () => {
  const proxy = await import('./systemProxy');
  const foreign = getGlobalDispatcher();
  await proxy.applySystemProxy(sessionWith(async () => {}), { mode: 'custom', customUrl: 'http://127.0.0.1:8106' });
  expect(getGlobalDispatcher() === foreign).toBe(true);
});

it('the existing vendor request entry explicitly dispatches without changing body, signal or literal headers', async () => {
  const proxy = await import('./systemProxy');
  await proxy.applySystemProxy(sessionWith(async () => {}), { mode: 'off', customUrl: '' });
  const send = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
  const { fetchVendorWithBaseFallback } = await import('./vendor/vendorBaseFallback');
  const body = new FormData();
  body.append('file', new Blob(['original bytes']), 'input.txt');
  const signal = new AbortController().signal;
  const headers = { Authorization: 'Bearer literal-fixture-key', 'x-fixture': 'unchanged' };
  await fetchVendorWithBaseFallback('https://transport-fixture.invalid/upload?literal=1', { method: 'POST', body, signal, headers });
  const [url, init] = send.mock.calls[0];
  expect(url).toBe('https://transport-fixture.invalid/upload?literal=1');
  expect(init).toMatchObject({ method: 'POST', dispatcher: expect.objectContaining({ dispatch: expect.any(Function) }) });
  expect(init?.body).toBe(body);
  expect(init?.signal).toBe(signal);
  expect(init?.headers).toBe(headers);
});
