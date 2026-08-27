import { createAssistantMessageEventStream, type AssistantMessage, type AssistantMessageEvent,
  type AssistantMessageEventStream } from '@earendil-works/pi-ai';

export interface NativeClock {
  set(callback: () => void, milliseconds: number): unknown;
  clear(timer: unknown): void;
}

export interface NativeStreamObservation {
  signal?: AbortSignal;
  firstResponseMs: number;
  idleMs: number;
  clock?: NativeClock;
  onEvent?(event: AssistantMessageEvent): void;
  onResult?(message: AssistantMessage): void;
  onFault?(error: unknown): void;
}

export class NativeStreamTimeout extends Error {
  constructor(readonly phase: 'first-response' | 'idle', milliseconds: number) {
    super(`Nomi model ${phase} timeout after ${milliseconds}ms`);
    this.name = 'NativeStreamTimeout';
  }
}

const realClock: NativeClock = {
  set: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export function observeNativeStream(
  delegate: (signal: AbortSignal) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>,
  options: NativeStreamObservation,
): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  const clock = options.clock ?? realClock;
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let rejectFault!: (error: unknown) => void;
  const fault = new Promise<never>((_resolve, reject) => { rejectFault = reject; });
  // SDK EventStream.result() only resolves. One rejectable completion is needed
  // for both ordinary Agent iteration and the summarizer's result()-only use.
  const completion = Promise.race([output.result(), fault]);
  output.result = () => completion;
  void completion.catch(() => {});
  let closed = false;
  let timer: unknown;
  let iterator: AsyncIterator<AssistantMessageEvent> | undefined;
  const clearTimer = () => {
    if (timer !== undefined) clock.clear(timer);
    timer = undefined;
  };
  const release = () => {
    clearTimer();
    options.signal?.removeEventListener('abort', onAbort);
    // A provider may ignore abort or keep next()/return() pending forever.
    // Closing our output must never await its cleanup.
    try { void Promise.resolve(iterator?.return?.()).catch(() => {}); } catch { /* best effort */ }
  };
  const fail = (error: unknown) => {
    if (closed) return;
    closed = true;
    release();
    rejectFault(error);
    output.end();
    controller.abort(error);
    try { options.onFault?.(error); } catch { /* fault delivery cannot reopen the stream */ }
  };
  const onAbort = () => fail(options.signal?.reason ?? new DOMException('Nomi model cancelled', 'AbortError'));
  const arm = (phase: 'first-response' | 'idle', milliseconds: number) => {
    clearTimer();
    timer = clock.set(() => fail(new NativeStreamTimeout(phase, milliseconds)), milliseconds);
  };
  const finish = (result: AssistantMessage, event?: AssistantMessageEvent) => {
    if (closed) return;
    // Clear before forwarding done/error: host approval can take minutes.
    clearTimer();
    options.onResult?.(result);
    if (closed) return;
    if (event) options.onEvent?.(event);
    if (closed) return;
    closed = true;
    if (event) output.push(event);
    output.end(result);
    release();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) {
    onAbort();
    return output;
  }
  arm('first-response', options.firstResponseMs);
  void (async () => {
    try {
      const upstream = await Promise.race([Promise.resolve().then(() => {
        signal.throwIfAborted();
        return delegate(signal);
      }), fault]);
      if (closed) return;
      iterator = upstream[Symbol.asyncIterator]();
      while (!closed) {
        const item = await Promise.race([iterator.next(), fault]);
        if (closed) return;
        if (item.done) {
          const result = await Promise.race([upstream.result(), fault]);
          if (closed) return;
          finish(result);
          return;
        }
        const event = item.value;
        if (event.type === 'done' || event.type === 'error') {
          finish(event.type === 'done' ? event.message : event.error, event);
          return;
        }
        arm('idle', options.idleMs);
        options.onEvent?.(event);
        if (closed) return;
        output.push(event);
      }
    } catch (error) { fail(error); }
  })();
  return output;
}
