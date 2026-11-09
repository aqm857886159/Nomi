// 「调一次模型」的**唯一主人**（2026-10-21，文本任务迁 pi-ai 单次调用；设计卡 docs/plan/2026-10-21-text-tasks-to-pi-ai.md ★2）。
//
// 一次 provider 调用：没有 Agent 循环、没有会话、没有工具。三个消费者都经这里：
//   · lane 的一次性提问（laneSingleShot.mts）；
//   · 文本任务（electron/textTaskRunner.ts：文本节点、提示词优化 / 翻译、拆解读图、浏览器提取……全部）；
//   · 接入说明卡编译器（electron/providerAdapter/compiler.ts）。
// 过去文本任务走的是另一台发动机（ai@4），判活、超时、重试、取消各写了一份，判活只数正文 token，
// 思考型模型 30 秒就被当死连接掐掉（docs/audit/2026-10-21-text-stream-first-token-gate.md）。这里只有一份：
//   · 判活 / 超时：lane 的三相看门狗（LANE_STREAM_WATCHDOG，任何事件都算活着，思考期另给预算）；
//   · 整体上限：调用方**没给** signal（一次性入口，没有停止键）时才加 MODEL_CALL_CEILING_MS 兜底收尾；
//     给了 signal 的入口有停止键、进度看得见，不设整体上限（协调 10-21 定，D2）；
//   · 重试：pi 的可打断重试，次数由调用方显式给（缺省 0）；
//   · 取消：signal 直达 SDK，pi 对 aborted 永不重试。
// 本模块之外不许再调 `streamSimple` / `stream`（check:llm-stream-owner 门岗）。
import { createModels } from '@earendil-works/pi-ai';
import { createNomiProvider, prewarmProviderProtocols } from './laneModelProvider.mjs';
import { LANE_STREAM_WATCHDOG, MODEL_CALL_CEILING_MS } from './laneProviderGuard.mjs';
import { MODEL_CALL_CEILING_ERROR, type CallModelOnce, type ModelCallOptions, type ModelCallResult, type PrewarmModelCall } from '../shared/agentLane/modelCallPort.js';
import { assertNativeFileCapability, bindNativeFile, rewriteNativeFilePayload, NativeMediaInputError, NativeMediaBudget } from '../ai/nativeFilePayload.js';

export type { ModelCallOptions, ModelCallResult } from '../shared/agentLane/modelCallPort.js';

/** 一次性入口的整体兜底到点（不是存活判据：存活由三相看门狗管）。 */
export class ModelCallCeilingError extends Error {
  constructor(readonly milliseconds: number) {
    super(`Nomi model call exceeded ${milliseconds}ms`);
    this.name = MODEL_CALL_CEILING_ERROR;
  }
}

export const callModelOnce: CallModelOnce = async (options: ModelCallOptions): Promise<ModelCallResult> => {
  options.signal?.throwIfAborted();
  const ceiling = options.signal ? undefined : AbortSignal.timeout(MODEL_CALL_CEILING_MS);
  const signal = options.signal ?? ceiling!;
  const files = new Map<string, ReturnType<typeof bindNativeFile>>();
  const budget = new NativeMediaBudget();
  const content = typeof options.content === 'string' ? options.content : options.content.map((part, index) => {
    if (part.type !== 'file') return part;
    assertNativeFileCapability(part, options.model.inputModalities);
    const padding = part.data.endsWith('==') ? 2 : part.data.endsWith('=') ? 1 : 0;
    budget.reserve(String(index), Math.floor(part.data.length / 4) * 3 - padding);
    const file = bindNativeFile(part);
    files.set(file.marker, file);
    return { type: 'text' as const, text: file.marker };
  });
  const { provider, model, credentials, pricingBasis } = await createNomiProvider(options.model, options.fetch, LANE_STREAM_WATCHDOG);
  const models = createModels({ credentials });
  models.setProvider(provider);
  signal.throwIfAborted();
  const stream = models.streamSimple(model, {
    ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
    messages: [{ role: 'user', content, timestamp: Date.now() }],
    tools: [],
  }, {
    signal,
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    ...((options.onPayload || files.size) ? { onPayload: async (payload: unknown) => {
      const customized = options.onPayload ? await options.onPayload(payload, model.api) : payload;
      const result = rewriteNativeFilePayload(customized, model.api, [...files.values()]);
      if ([...files.keys()].some(marker => !result.applied.has(marker))) throw new NativeMediaInputError('unbound');
      return result.payload;
    } } : {}),
  });
  if (options.onEvent) for await (const event of stream) options.onEvent(event);
  const message = await stream.result();
  if (ceiling?.aborted) throw new ModelCallCeilingError(MODEL_CALL_CEILING_MS);
  options.signal?.throwIfAborted();
  return { message, model, pricingBasis };
};

/**
 * 把核心与点名的协议实现先装好；点名里有 OpenAI 兼容就对它**空跑一次**（有意图时预热：指针移进 / 焦点进文本动作时渲染层空闲回调里
 * 经 nomi:tasks:text:prewarm 叫，主进程按目录里启用的文本模型点名协议，electron/ai/textStreamIpc.ts）。
 * 空跑不出网：传输换成一个就地回一段固定 SSE 的假 fetch，走的是同一条装配 → SDK → 解析 → 看门狗的路，
 * 只为让这些代码在用户第一次点之前就已初始化 / 编译过（实测首调从约 110ms 降到与后续调用同级）。
 */
export const prewarmModelCall: PrewarmModelCall = async (protocols) => {
  await prewarmProviderProtocols(protocols);
  if (!protocols.includes('openai-compatible')) return;
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    `data: ${JSON.stringify({ id: 'prewarm', object: 'chat.completion.chunk', created: 0, model: 'prewarm', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const body = chunk({ role: 'assistant', content: '' }) + chunk({ content: '.' }) + chunk({}, 'stop') + 'data: [DONE]\n\n';
  const offline: typeof globalThis.fetch = async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  await callModelOnce({
    model: { kind: 'openai-compatible', providerId: 'nomi-prewarm', modelId: 'prewarm', baseURL: 'http://prewarm.invalid/v1', authType: 'none' },
    fetch: offline, content: 'prewarm', signal: new AbortController().signal, onEvent: () => undefined,
  });
};
