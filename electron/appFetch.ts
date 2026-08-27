import type { Dispatcher } from 'undici';
import { getAppDispatcher } from './systemProxy';

// Own the implementation, not a route snapshot: later SDK global installs
// cannot replace native Request/Response handling or the fetch implementation.
const nativeFetch = globalThis.fetch.bind(globalThis);
const NativeRequest = globalThis.Request;

/**
 * The sole Node HTTP entry. Keep native Request/Response/FormData together;
 * only inject Nomi's current dispatcher, never a third-party global route.
 * No body reads, wrapping errors, retries, credentials or timeout policy here.
 */
export const appFetch: typeof globalThis.fetch = async (input, init) => {
  const signal = init?.signal === undefined
    ? (input instanceof NativeRequest ? input.signal : undefined) : init.signal;
  const target = input instanceof NativeRequest ? input.url : String(input);
  const dispatcher = await getAppDispatcher(signal ?? undefined, target);
  const options: RequestInit & { dispatcher: Dispatcher } = { ...init, dispatcher };
  return nativeFetch(input, options);
};
