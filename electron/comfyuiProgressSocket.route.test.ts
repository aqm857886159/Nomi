import { afterEach, expect, it, vi } from 'vitest';
import type { Session } from 'electron';

vi.unmock('./appFetch');
const sockets = vi.hoisted(() => ({ options: [] as Array<{ dispatcher?: unknown }> }));
vi.mock('./catalog/catalogStore', () => ({ readCatalog: () => ({ vendors: [], mappings: [] }) }));
vi.mock('electron', () => ({ webContents: { fromId: () => null } }));
vi.mock('undici', async (importOriginal) => ({
  ...await importOriginal<typeof import('undici')>(),
  WebSocket: class {
    binaryType = '';
    listeners = new Map<string, () => void>();
    constructor(_url: string, options: { dispatcher?: unknown }) {
      sockets.options.push(options);
      queueMicrotask(() => this.listeners.get('open')?.());
    }
    addEventListener(event: string, listener: () => void) { this.listeners.set(event, listener); }
    send() {}
    close() {}
  },
}));

function delayedSession() {
  let ready!: () => void;
  const promise = new Promise<void>((resolve) => { ready = resolve; });
  return { ready, session: { setProxy: async () => promise } as unknown as Session };
}

afterEach(() => { sockets.options.length = 0; vi.resetModules(); });

it('concurrent watches share one WebSocket with the real application dispatcher after boot', async () => {
  const proxy = await import('./systemProxy');
  const { watchComfyuiTask, unwatchComfyuiTask } = await import('./comfyuiProgressSocket');
  const delayed = delayedSession();
  const boot = proxy.applySystemProxy(delayed.session, { mode: 'off', customUrl: '' });
  const first = watchComfyuiTask({ promptId: 'first', nodeId: 'one' }, 1);
  const second = watchComfyuiTask({ promptId: 'second', nodeId: 'two' }, 1);
  delayed.ready();
  await Promise.all([boot, first, second]);
  expect(sockets.options).toHaveLength(1);
  expect(sockets.options[0].dispatcher).toBe(await proxy.getAppDispatcher());
  unwatchComfyuiTask('first'); unwatchComfyuiTask('second');
});

it('unwatching during proxy initialization does not create an orphan connection afterward', async () => {
  const proxy = await import('./systemProxy');
  const { watchComfyuiTask, unwatchComfyuiTask } = await import('./comfyuiProgressSocket');
  const delayed = delayedSession();
  const boot = proxy.applySystemProxy(delayed.session, { mode: 'off', customUrl: '' });
  const watch = watchComfyuiTask({ promptId: 'cancelled', nodeId: 'one' }, 1);
  unwatchComfyuiTask('cancelled');
  delayed.ready();
  await Promise.all([boot, watch]);
  expect(sockets.options).toHaveLength(0);
});
