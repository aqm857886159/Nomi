import { beforeEach, expect, it, vi } from 'vitest';
import type { ProxyPrefs } from './proxySettings';

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  prefs: { mode: 'off', customUrl: '' } as ProxyPrefs,
  setProxy: vi.fn(async () => {}),
  resolveProxy: vi.fn(async () => 'DIRECT'),
}));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => fixture.handlers.set(name, handler) },
  session: { defaultSession: { setProxy: fixture.setProxy, resolveProxy: fixture.resolveProxy } } }));
vi.mock('./ipcSenderGuard', () => ({ assertTrustedSender() {} }));
vi.mock('./proxySettings', () => ({
  normalizeProxyPrefs: (prefs: ProxyPrefs) => prefs,
  readProxyPrefs: () => fixture.prefs,
  writeProxyPrefs: (prefs: ProxyPrefs) => (fixture.prefs = prefs),
}));
vi.mock('./proxyProbe', () => ({ probeTargets: () => [], probeOutbound: async () => ({ ok: false }) }));

beforeEach(() => {
  vi.resetModules(); fixture.handlers.clear(); fixture.prefs = { mode: 'off', customUrl: '' };
  fixture.setProxy.mockReset().mockResolvedValue();
});

type Reply = { ok: boolean; status: { mode: string; customUrl: string; activeUrl: string; unsupported: string } };
const set = (prefs: ProxyPrefs) => fixture.handlers.get('nomi:proxy:set')!({}, prefs) as Promise<Reply>;

it('failed application returns a failed status, never success with an unconfirmed route', async () => {
  const { registerProxyIpc } = await import('./proxyIpc');
  registerProxyIpc();
  fixture.setProxy.mockRejectedValue(new Error('Synthetic Chromium failure'));
  const result = await set({ mode: 'custom', customUrl: 'http://127.0.0.1:8200' });
  expect(result.ok).toBe(false);
  expect(result.status.activeUrl).toBe('');
  expect(result.status.unsupported).toContain('Synthetic Chromium failure');
});

it('concurrent set replies report the latest saved preference and committed route together', async () => {
  const { registerProxyIpc } = await import('./proxyIpc');
  registerProxyIpc();
  const first = set({ mode: 'custom', customUrl: 'http://127.0.0.1:8201' });
  const latest = set({ mode: 'off', customUrl: '' });
  for (const result of await Promise.all([first, latest])) {
    expect(result.status.mode).toBe('off');
    expect(result.status.customUrl).toBe('');
    expect(result.status.activeUrl).toBe('');
  }
});
