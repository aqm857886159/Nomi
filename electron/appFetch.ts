import type { Dispatcher } from 'undici';
import { getAppDispatcher } from './systemProxy';
import { withCredentialRedirectPolicy } from './credentialRedirectPolicy';
import { handOffToNetwork } from './outboundDispatchEvidence';

// Own the implementation, not a route snapshot: later SDK global installs
// cannot replace native Request/Response handling or the fetch implementation.
const nativeFetch = globalThis.fetch.bind(globalThis);
const NativeRequest = globalThis.Request;

/**
 * The sole Node HTTP entry. Keep native Request/Response/FormData together;
 * only inject Nomi's current dispatcher, never a third-party global route.
 * No body reads, wrapping errors, retries or timeout policy here.
 *
 * Credentialed requests never auto-follow a redirect; the rule and its reasons live in
 * credentialRedirectPolicy.ts (this is only where it is applied).
 */
export const appFetch: typeof globalThis.fetch = async (input, init) => {
  const signal = init?.signal === undefined
    ? (input instanceof NativeRequest ? input.signal : undefined) : init.signal;
  const target = input instanceof NativeRequest ? input.url : String(input);
  const suppliedDispatcher = (init as RequestInit & { dispatcher?: Dispatcher } | undefined)?.dispatcher;
  const dispatcher = suppliedDispatcher ?? await getAppDispatcher(signal ?? undefined, target);
  const options: RequestInit & { dispatcher: Dispatcher } = { ...withCredentialRedirectPolicy(input, init), dispatcher };
  // 从这一行起请求可能离开本机：记进当前付费派发的那本账（不在派发里就不记）。上面取路由失败时请求还没交出去，
  // 所以排在它后面。「哪些请求不可能花钱」与「连上之前就失败」的判据都住 outboundDispatchEvidence.ts。
  return handOffToNetwork(input, init, () => nativeFetch(input, options));
};
