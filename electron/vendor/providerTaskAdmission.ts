import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage<AbortSignal>();
const pending = new Map<string, { owner: number; controller: AbortController }>();
export const providerAdmissionSignal = (): AbortSignal | undefined => context.getStore();

export async function withProviderAdmissionOwner<T>(owner: number, key: string, work: () => Promise<T>): Promise<T> {
  if (!key) return work();
  const identity = `${owner}:${key}`;
  const controller = new AbortController();
  pending.set(identity, { owner, controller });
  try { return await context.run(controller.signal, work); }
  finally { if (pending.get(identity)?.controller === controller) pending.delete(identity); }
}
export function cancelProviderAdmission(owner: number, key?: string): boolean {
  let cancelled = false;
  for (const [identity, entry] of pending) {
    if (entry.owner !== owner || (key !== undefined && identity !== `${owner}:${key}`)) continue;
    entry.controller.abort(new Error('Provider admission cancelled'));
    cancelled = true;
  }
  return cancelled;
}
