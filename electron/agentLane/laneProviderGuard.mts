// Agent lane · 供应商流的**看门狗**与**厂商报文归一**（方案 §1.6 前两行 + 第四行）
//
// 它在解决哪个真实摩擦：新通路今天**一点超时都没有**。`observeNativeStream` 只挂在旧路
// （`run.mts:164`），而 `laneHost.mts` 把 `createNomiProvider()` 的 provider 直接交给
// `AgentHarness`——pi 的库路径不装任何 dispatcher（`configureHttpDispatcher` 只在 CLI 入口
// 调用）。供应商流卡住时 lane 会**永远转圈**：没有报错、没有进度、停止键之外没有任何出口。
// `lane-slice.test.mts` 全绿只是因为 loopback 从不卡。
//
// **为什么归一也在这一层**：pi 的重试判据是一张 40 条**英文**正则表
// （`pi-ai/dist/utils/retry.js`：`isRetryableAssistantError`）。那张表是上游资产，我们不改。
// 但 APIMart / kie 这一族说中文，于是两种错法今天都判反了：
//   · HTTP 500 + 「余额不足」→ 命中 `500` → pi 重试三次，把一次确定的付费失败拖成四次；
//   · 「请求超时」（厂商自己 200 里写的）→ 一条都不命中 → 一次网络抖动整轮白等。
// 归一的办法是**追加一个上游认得的标记**，不是替换厂商原话——用户仍然要看到供应商说了什么。
//
// **仓库里另外两处也在认厂商错误，为什么这里还要第三处**（R14.1 的问题，逐个答）：
//   · `electron/vendor/vendorHttp.ts` 的 `categorizeVendorFailure` 按 **HTTP 状态码**查
//     （生成类供应商的作业接口）；这里按**报文文本**查——文本模型的流状态码常常是 200，
//     错误写在体里，状态码那张表看不见它。
//   · `src/workbench/observability/classifyError.ts` 的 `detectBalance` 认的是同一批中文词，
//     但它回答的是**另一个问题**：「给用户看哪句话、指哪个动作」（充值 vs 等待），产出是
//     Nomi 自己的类别；这里回答的是「贴哪个英文标记，好让 pi 那张 40 条正则**别重试**」，
//     产出是上游词表里的一个词。同一批输入、两个不同的输出域，合并成一个函数只会让两个
//     消费者都拿到一个对谁都不精确的中间类别。
//     **但词表不许各长各的**：上面那张表是 `detectBalance` 的超集，`lane-resilience.test.mts`
//     的语料表把两边的真实样本一条条喂进来，漂了当场红（R28：防线放在最早能拦住的那层）。
import { AssistantMessageFrameEncoder, reduceAssistantMessageFrames, createAssistantMessageEventStream, type Api, type AssistantMessage,
  type AssistantMessageEventStream, type Model, type ProviderStreams } from '@earendil-works/pi-ai';
import { observeNativeStream, type NativeClock } from './laneStreamObserver.mjs';

/** 一条流的三个预算。**没有默认值**：忘了配就是没有看门狗，而那正是 09 月的 bug。 */
export interface NomiStreamGuard {
  /** 首字节预算。请求发出到响应头（pi 的 `start`）之间。 */
  readonly firstResponseMs: number
  /** 思考预算。响应头到第一段正文之间（推理模型在这段一个字都不流）。 */
  readonly firstTokenMs: number
  /** 空闲预算。正文开始之后两个事件之间。 */
  readonly idleMs: number
  /** 测试用的可控时钟。生产恒为真 `setTimeout`。 */
  readonly clock?: NativeClock
}

/**
 * 看门狗的三个预算——**唯一一份**（lane 主路与单次调用 `laneSingleShot` 共用；过去单次调用手抄了 90s / 120s 两个数）。
 *
 * - 首字节 90s、空闲 120s：沿用旧路 `run.mts` 的两个数，它们管的是「连不上」与「出字出到一半断了」。
 * - 思考 300s：响应头之后、第一段正文之前。这段静默是推理模型在想（chat completions 不流推理），
 *   不是卡住。300s 对齐 pi 自己的传输层空闲默认值
 *   （`pi-coding-agent/dist/core/http-dispatcher.js` 的 `DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000`，按字节计，
 *   连中转站的保活注释都算进去；我们按事件计，看不见保活，所以更不该比它紧）。
 *   过去这段用的是 120s 的空闲表：真实反馈 NF-1001-0003/0004（gpt-5.6-sol 经中转）里一回合被掐四次，
 *   每次 pi 都把约 6–8 万 token 的上下文整份重发——用户花了钱、什么都没拿到。
 */
export const LANE_STREAM_WATCHDOG: NomiStreamGuard = Object.freeze({
  firstResponseMs: 90_000,
  firstTokenMs: 300_000,
  idleMs: 120_000,
});

/**
 * 厂商报文 → 上游正则认得的标记。**顺序即优先级**：余额排第一，因为它同时是
 * 「别重试」的开关（上游先跑 `NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN`），
 * 而把一次确定的付费失败重试三次，用户等的是四倍的时间换同一个结果。
 */
const VENDOR_CLASSIFICATIONS: readonly { readonly match: RegExp; readonly marker: string }[] = [
  // 余额这一档的词表**不是想出来的**，是把仓库里已有的真实样本抄齐的：
  // `src/workbench/observability/classifyError.ts:287-294` 的 `detectBalance`（渲染层
  // 已经在用这套词判生成作业的失败）、RunningHub 605 / 1620 两条原话
  // （`classifyGenerationError.test.ts:155,157`）、kie 402 的 `余额不足`
  // （`electron/vendor/vendorHttp.test.ts:47`）。两张表不合并的理由见文件头；
  // 词表**必须是那张的超集**，`lane-resilience.test.mts` 的语料表把这条钉死。
  { marker: 'insufficient_quota',
    match: /余额不足|余额已用[尽完]|账户余额|余额为负|欠费|请充值|不支持 ?API ?调用|积分不足|额度不足|配额不足|insufficient[ _-]?balance|not enough (?:balance|credit)|please recharge|top ?up/i },
  { marker: 'timeout', match: /超时|请求超时|响应超时|等待超时/ },
  { marker: 'rate limit', match: /请求过于频繁|访问过于频繁|频率超限|并发超限|限流|触发限流/ },
  { marker: 'server error', match: /服务器?内部错误|服务器错误|服务不可用|系统繁忙|服务繁忙|网关错误|上游错误/ },
  // `网络请求失败` 是**我们自己**的兜底文案（`electron/systemProxy.ts:455`），不是厂商的。
  // 它照样要归一：上游那张表全是英文，中文的「压根没连上」一条都不命中，于是一次代理不通
  // 会被当成不可重试的确定失败——而它恰恰是最该重试一次的那种。
  { marker: 'network error', match: /网络错误|网络异常|网络请求失败|连接失败|连接被拒绝|连接超时/ },
];

/**
 * 给一段厂商报文追加**一个**上游认得的标记。
 *
 * 只追加一个：两个标记同时出现时，第一条（余额）赢——那是唯一一个「重试有害」的类别。
 * 已经命中上游表的报文（英文的 `429` / `timeout` / `insufficient_quota` …）走这里也不会变差：
 * 追加同义标记不改变分类，而漏判才会。
 */
export function normalizeProviderErrorText(text: string): string {
  const hit = VENDOR_CLASSIFICATIONS.find((rule) => rule.match.test(text));
  if (!hit) return text;
  // 标记看得见、说得清是谁加的。藏起来的分类在排错时就是一个查不出来源的行为差异。
  return `${text} [nomi-classified: ${hit.marker}]`;
}

function normalizeMessage(message: AssistantMessage): AssistantMessage {
  if (message.stopReason !== 'error' || !message.errorMessage) return message;
  const errorMessage = normalizeProviderErrorText(message.errorMessage);
  return errorMessage === message.errorMessage ? message : { ...message, errorMessage };
}

/** 看门狗自己开火时，产出一条 pi 认得的失败助手消息——**不是**一个 rejection。 */
function faultMessage(model: Model<Api>, error: unknown, aborted: boolean, partial?: AssistantMessage): AssistantMessage {
  const text = error instanceof Error ? error.message : String(error);
  const message: AssistantMessage = partial ?? {
    role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'pending', timestamp: Date.now(),
  };
  return {
    ...message,
    // 用户按了停 = `aborted`，上游**永不重试**（`retry.js:120-125`）。看门狗开火 = `error`，
    // 正文里带着 `timeout` 三个字，于是上游把它当一次可重试的抖动。这两条的区别就是
    // 「按停止之后它还偷偷重试三次」和「网络抖一下整轮白等」这两个 bug 各自的开关。
    stopReason: aborted ? 'aborted' : 'error',
    ...(aborted ? {} : { errorMessage: normalizeProviderErrorText(text) }),
  };
}

/** One fault-time copy through pi's public codec; no token log or per-delta full replay. */
function snapshotPartial(partial: AssistantMessage): AssistantMessage | undefined {
  const encoder = new AssistantMessageFrameEncoder();
  function* frames() {
    yield encoder.encode({ type: 'start', partial })!;
    for (let contentIndex = 0; contentIndex < partial.content.length; contentIndex++) {
      const block = partial.content[contentIndex]!;
      // Block starts let the SDK copy only its public content fields, excluding
      // the provider parser's mutable index/partialArgs scratch properties.
      if (block.type === 'text') yield encoder.encode({ type: 'text_start', contentIndex, partial })!;
      else if (block.type === 'thinking') yield encoder.encode({ type: 'thinking_start', contentIndex, partial })!;
      else yield encoder.encode({ type: 'toolcall_start', contentIndex, partial })!;
    }
  }
  return reduceAssistantMessageFrames(frames());
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  return error instanceof Error && error.name === 'AbortError';
}

function guardedStream(
  model: Model<Api>,
  signal: AbortSignal | undefined,
  guard: NomiStreamGuard,
  delegate: (activeSignal: AbortSignal) => AssistantMessageEventStream,
): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  let currentPartial: AssistantMessage | undefined;
  let faultPartial: AssistantMessage | undefined;
  const observed = observeNativeStream(delegate, {
    ...(signal ? { signal } : {}),
    firstResponseMs: guard.firstResponseMs,
    firstTokenMs: guard.firstTokenMs,
    idleMs: guard.idleMs,
    ...(guard.clock ? { clock: guard.clock } : {}),
    onEvent: (event) => { if ('partial' in event) currentPartial = event.partial; },
    // Capture synchronously at the observer's admission cutoff, before a late
    // provider completion can mutate its shared accumulator again.
    onFault: () => { if (currentPartial) faultPartial = snapshotPartial(currentPartial); },
  });
  void (async () => {
    try {
      for await (const event of observed) {
        // 终止事件也是结果的来源（`AssistantMessageEventStream` 用它 resolve `result()`），
        // 所以归一必须发生在**推出去之前**——推完再改就晚了，消费者拿到的是原样那条。
        output.push(event.type === 'error' ? { ...event, error: normalizeMessage(event.error) } : event);
      }
      output.end(normalizeMessage(await observed.result()));
    } catch (error) {
      // `observeNativeStream` 的 `fail()` 让 `result()` **reject**。旧路要的就是这个
      // （`run.mts` 把它兜成 `kind:'timeout'` 的事实交给用户），但 harness 那条路要的是
      // 一条 `stopReason:'error'` 的助手消息——只有它才走得到上游的重试判据。
      output.push({ type: 'error', reason: isAbort(error, signal) ? 'aborted' : 'error',
        error: faultMessage(model, error, isAbort(error, signal), faultPartial) });
    }
  })();
  return output;
}

/**
 * 给一份 `ProviderStreams` 装上看门狗与归一。
 *
 * **唯一的包装点。** 旧路在 `run.mts:164` 直接调同一个 `observeNativeStream`——同一份实现、
 * 两处接线，不是两份实现（P1）。阶段 4 删掉旧路时，留下来的就是这里这一处。
 */
export function guardProviderStreams(base: ProviderStreams, guard: NomiStreamGuard): ProviderStreams {
  return {
    stream: (model, context, options) => guardedStream(model, options?.signal, guard,
      (activeSignal) => base.stream(model, context, { ...options, signal: activeSignal })),
    streamSimple: (model, context, options) => guardedStream(model, options?.signal, guard,
      (activeSignal) => base.streamSimple(model, context, { ...options, signal: activeSignal })),
  };
}
