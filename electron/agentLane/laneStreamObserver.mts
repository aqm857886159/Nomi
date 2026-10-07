import { createAssistantMessageEventStream, type AssistantMessage, type AssistantMessageEvent,
  type AssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { RuntimeErrorFacts } from '../shared/agentCapabilities/transportContracts.js';
import { laneModelTimeoutMessage } from '../shared/agentLane/laneAssistantFault.js';

/**
 * 三个超时相位。**派生，不重抄**：这几个词是 `RuntimeErrorFacts.timeoutPhase` 的合同，错误事实与
 * 诊断文案都按它分叉。原来这里手抄了两遍字面量（`vocabularies-baseline.json` 的两条 debt），
 * 于是同一个词表有三份定义、改一处漏两处。看门狗那句话的格式住 `laneAssistantFault.ts`（投影按它认）。
 *
 * 为什么是三个而不是两个（2026-10-06，NF-1001-0004）：pi 的 openai-completions 在**收到响应头**那一刻就推
 * `start`（`pi-ai/dist/api/openai-completions.js`：`stream.push({ type: "start" })` 紧跟在 `withResponse()` 之后），
 * 早于任何正文。推理模型在 chat completions 上思考时一个字都不流——这段静默是「在想」，不是「卡住」。
 * 过去 `start` 一到就开空闲表，于是长思考被当成卡死掐断、pi 再把整份上下文重发三次（真实反馈 NF-1001-0004：
 * 一回合约 33 万输入 token、几次全被掐）。所以：响应头之前 = `first-response`；响应头之后、第一段正文之前 =
 * `first-token`（思考预算）；正文开始之后两个事件之间 = `idle`。
 */
type StreamTimeoutPhase = NonNullable<RuntimeErrorFacts['timeoutPhase']>;

export interface NativeClock {
  set(callback: () => void, milliseconds: number): unknown;
  clear(timer: unknown): void;
}

export interface NativeStreamObservation {
  signal?: AbortSignal;
  /** 请求发出 → 响应头（pi 的 `start`）。 */
  firstResponseMs: number;
  /** 响应头 → 第一段正文（模型在思考 / 排队）。 */
  firstTokenMs: number;
  /** 正文开始之后，两个事件之间。 */
  idleMs: number;
  clock?: NativeClock;
  onEvent?(event: AssistantMessageEvent): void;
  onResult?(message: AssistantMessage): void;
  onFault?(error: unknown): void;
}

export class NativeStreamTimeout extends Error {
  constructor(readonly phase: StreamTimeoutPhase, milliseconds: number) {
    super(laneModelTimeoutMessage(phase, milliseconds));
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
    // Snapshot fault evidence at the admission cutoff. Upstream return()/abort
    // cleanup may synchronously mutate its shared partial accumulator.
    try { options.onFault?.(error); } catch { /* fault delivery cannot reopen the stream */ }
    release();
    rejectFault(error);
    output.end();
    controller.abort(error);
  };
  const onAbort = () => fail(options.signal?.reason ?? new DOMException('Nomi model cancelled', 'AbortError'));
  const arm = (phase: StreamTimeoutPhase, milliseconds: number) => {
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
        // 只有 `start` 是「连上了、还没出字」；其余任何事件（text / thinking / toolcall 的 start 与 delta）都是正文。
        if (event.type === 'start') arm('first-token', options.firstTokenMs);
        else arm('idle', options.idleMs);
        options.onEvent?.(event);
        if (closed) return;
        output.push(event);
      }
    } catch (error) { fail(error); }
  })();
  return output;
}
