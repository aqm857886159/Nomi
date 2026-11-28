// 阶段 3 前置探针（方案 §4.3）与回放影子的裸 lane 夹具（`pi-agent-core@1.7.0` `Agent` + `SessionManager` v3）。
//
// `openLane`（`laneHost.mts`）故意只露产品面命令。探针与 L2 回放影子需要直接观测：
//   - `appendMessage` 回填历史前文；
//   - `before_tool` 钩子里挂等待与打断；
//   - `steer` / `abort` 未消费插话回收；
//   - `resume` 对停在预检里的调用重跑预检与执行；
//   - `retry_scheduled` / `retry_end` 看门狗重试事件。
import { randomUUID } from 'node:crypto';
import { Agent, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core';
import {
  createInitialSystemMessage,
  createModels,
  getSupportedThinkingLevels,
  isRetryableAssistantError,
  retryDelayMs,
  toToolDeclaration,
  validateToolArguments,
  type AssistantMessage,
  type JsonValue,
  type Message,
  type Provider,
  type RetryPolicy,
  type StreamOptions,
} from '@earendil-works/pi-ai';

import { createNomiProvider } from '../../electron/agentLane/laneModelProvider.mjs';
import type { LaneModelFacts } from '../../electron/shared/agentLane/laneProjection.js';
import type { LaneThinkingLevel } from '../../electron/shared/agentLane/laneContracts.js';
import type {
  LaneBranchQuery,
  LaneEntry,
  LaneQueueItem,
  LaneRunningToolSnapshot,
  LaneSnapshot,
} from '../../electron/shared/agentLane/laneSnapshotTypes.js';
import { createLaneTools } from '../../electron/agentLane/laneTools.mjs';
import { openLaneSession, type LaneSession } from '../../electron/agentLane/laneSession.mjs';
import type { OpenLaneOptions } from '../../electron/agentLane/laneRuntimePort.js';
import { LANE_SYSTEM_PROMPT } from './laneFixture.mjs';

export const PROBE_CONTEXT = Object.freeze({});
export type ProbeContext = typeof PROBE_CONTEXT;

export interface ProbeCleanup {
  after(fn: () => void | Promise<void>): void;
}

export type ProbeBeforeToolResult = {
  block?: { reason: string; terminate?: boolean };
} | undefined;

export type ProbeBeforeToolHandler = (
  event: { toolCallId: string; toolName: string; args: unknown },
  hookContext: { abortSignal?: AbortSignal },
) => Promise<ProbeBeforeToolResult> | ProbeBeforeToolResult;

export type ProbeBeforeRequestHandler = () => Promise<undefined> | undefined;

export type ProbeEvent =
  | { type: 'retry_scheduled'; attempt: number; errorMessage: string; delayMs: number }
  | { type: 'retry_end'; attempt: number }
  | { type: 'fault'; error: unknown };

export interface ProbeWatch {
  readonly snapshot: LaneSnapshot;
  start(listener: (snapshot: LaneSnapshot) => void): void;
  resnapshot(_ctx?: unknown): Promise<LaneSnapshot>;
  unsubscribe(): void;
}

export interface ProbeLaneHandle {
  prompt(input: string | readonly AgentMessage[], _opts?: unknown, _ctx?: unknown): Promise<{ ok: true } | { ok: false; error: unknown }>;
  steer(text: string, _opts?: unknown, _ctx?: unknown): Promise<{ ok: true; value: { entryId: string } }>;
  abort(_ctx?: unknown): Promise<{ ok: true; value: { steer: AgentMessage[] } }>;
  appendMessage(message: AgentMessage, _ctx?: unknown): Promise<string>;
  appendCustomEntry(customType: string, data?: JsonValue, _ctx?: unknown): Promise<string>;
  findEntries(query?: LaneBranchQuery, _ctx?: unknown): Promise<LaneEntry[]>;
  inspectExecution(_ctx?: unknown): Promise<{ current?: { status: 'open' } }>;
  resume(_ctx?: unknown): Promise<{ ok: true } | { ok: false; error: unknown }>;
  setActiveTools(names: readonly string[], _ctx?: unknown): Promise<void>;
  getActiveTools(_ctx?: unknown): Promise<string[]>;
  watch(_ctx?: unknown): Promise<ProbeWatch>;
}

export interface ProbeHarnessHandle {
  readonly events: {
    on<T extends ProbeEvent['type']>(type: T, listener: (event: Extract<ProbeEvent, { type: T }>) => void): () => void;
  };
  readonly hooks: {
    on(name: 'before_tool', handler: ProbeBeforeToolHandler): void;
    on(name: 'before_request', handler: ProbeBeforeRequestHandler): void;
  };
  setRetryPolicy(policy: RetryPolicy, _ctx?: unknown): Promise<void>;
  setStreamOptions(options: Partial<StreamOptions>, _ctx?: unknown): Promise<void>;
  getTools(_ctx?: unknown): Promise<AgentTool[]>;
  setTools(tools: readonly AgentTool[], _ctx?: unknown): Promise<void>;
  close(_ctx?: unknown): Promise<void>;
}

export interface ProbeLane {
  harness: ProbeHarnessHandle;
  lane: ProbeLaneHandle;
  session: LaneSession;
  sessionId: string;
  modelFacts: LaneModelFacts;
  close(): Promise<void>;
}

export interface ProbeLaneOptions {
  sessionId?: string;
  wrapProvider?(provider: Provider): Provider;
  beforeTool?: ProbeBeforeToolHandler;
}

function defaultLlmFilter(messages: readonly AgentMessage[]): Message[] {
  return messages.filter((m): m is Message =>
    m.role === 'system' || m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult');
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function unpairedCallsOf(entries: readonly LaneEntry[]) {
  const paired = new Set<string>();
  let lastAssistant: AssistantMessage | undefined;
  for (const entry of entries) {
    if (entry.type !== 'message') continue;
    if (entry.message.role === 'assistant') lastAssistant = entry.message;
    else if (entry.message.role === 'toolResult') paired.add(entry.message.toolCallId);
  }
  const unpaired = lastAssistant
    ? lastAssistant.content.filter(
        (part): part is Extract<AssistantMessage['content'][number], { type: 'toolCall' }> =>
          part.type === 'toolCall' && !paired.has(part.id),
      )
    : [];
  return { lastAssistant, unpaired };
}

export async function openProbeLane(
  t: ProbeCleanup,
  options: Omit<OpenLaneOptions, 'gate'>,
  probe: ProbeLaneOptions = {},
): Promise<ProbeLane> {
  const laneName = options.laneName ?? 'main';
  const { session, sessionId, release } = await openLaneSession({
    projectDir: options.projectDir,
    laneName,
    ...(probe.sessionId ? { sessionId: probe.sessionId } : {}),
  });
  const { provider, model, credentials, pricingBasis } = await createNomiProvider(options.model, options.fetch);
  const modelFacts: LaneModelFacts = {
    pricing: pricingBasis,
    supportedThinkingLevels: getSupportedThinkingLevels(model) as readonly LaneThinkingLevel[],
    ...(options.model.contextWindow === undefined ? {} : { contextWindow: options.model.contextWindow }),
  };
  const models = createModels({ credentials });
  models.setProvider(probe.wrapProvider ? probe.wrapProvider(provider) : provider);

  let registeredTools: AgentTool[] = [...createLaneTools(options.tools)];
  let activeToolNames: string[] = registeredTools.map((tool) => tool.name);
  let retryPolicy: RetryPolicy = { enabled: true, maxRetries: 3, baseDelayMs: 1_000 };
  let extraStreamOptions: Partial<StreamOptions> = {};
  const systemPromptText = typeof options.systemPrompt === 'function'
    ? options.systemPrompt()
    : (options.systemPrompt || LANE_SYSTEM_PROMPT);

  const beforeToolHandlers: ProbeBeforeToolHandler[] = probe.beforeTool ? [probe.beforeTool] : [];
  const beforeRequestHandlers: ProbeBeforeRequestHandler[] = [];
  const eventListeners = new Map<ProbeEvent['type'], Set<(event: ProbeEvent) => void>>();
  const emitProbeEvent = (event: ProbeEvent) => {
    for (const listener of eventListeners.get(event.type) ?? []) listener(event);
  };

  const pendingSteer: Array<{ entryId: string; message: AgentMessage }> = [];
  const deferredWrites: Array<{ entryId: string; customType: string; data?: JsonValue }> = [];
  let liveOp: {
    id: string;
    startedAt: number;
    fromTipId: string | null;
    streamingMessage?: AssistantMessage;
    runningTools: LaneRunningToolSnapshot[];
    retry?: { attempt: number; maxAttempts: number; nextAttemptAt: number };
    abortController: AbortController;
    abortRequested: boolean;
    lastAssistant?: AssistantMessage;
  } | null = null;
  let activeRunPromise: Promise<void> | null = null;

  const watchers = new Set<(snapshot: LaneSnapshot) => void>();

  const executableTools = (): AgentTool[] =>
    registeredTools.filter((tool) => activeToolNames.includes(tool.name));

  const buildSnapshot = (): LaneSnapshot => {
    const queues: LaneQueueItem[] = [
      ...pendingSteer.map((item) => ({
        entryId: item.entryId,
        kind: 'steer' as const,
        type: 'message' as const,
        message: item.message,
      })),
      ...deferredWrites.map((item) => ({
        entryId: item.entryId,
        kind: 'write' as const,
        type: 'custom' as const,
        customType: item.customType,
        ...(item.data === undefined ? {} : { data: item.data }),
      })),
    ];
    return {
      lane: laneName,
      transcript: session.activeTranscript(),
      tipId: session.getTipId(),
      configuration: {
        model: { provider: model.provider, modelId: model.id },
        thinkingLevel: 'off',
        activeToolNames: [...activeToolNames],
      },
      stats: session.getStats(),
      operation: liveOp
        ? {
            id: liveOp.id,
            kind: 'run',
            startedAt: liveOp.startedAt,
            fromTipId: liveOp.fromTipId,
            status: 'open',
            ...(liveOp.streamingMessage ? { streamingMessage: liveOp.streamingMessage } : {}),
            runningTools: [...liveOp.runningTools],
            ...(liveOp.retry ? { retry: liveOp.retry } : {}),
          }
        : null,
      queues,
      faulted: false,
    };
  };

  const notifyWatchers = () => {
    if (watchers.size === 0) return;
    const snap = buildSnapshot();
    for (const listener of watchers) listener(snap);
  };

  const flushDeferredWrites = async () => {
    for (const write of deferredWrites.splice(0)) {
      await session.appendCustomEntry(write.customType, write.data);
    }
  };

  const buildContextForAgent = () => {
    const currentTools = executableTools();
    const nonSystem = session.buildSessionContext().messages.filter((m) => m.role !== 'system');
    const head = createInitialSystemMessage(systemPromptText, currentTools.map(toToolDeclaration));
    return {
      messages: head ? [head, ...nonSystem] : [...nonSystem],
      tools: currentTools,
    };
  };

  const runBeforeTool = async (
    toolCallId: string,
    toolName: string,
    args: unknown,
    signal?: AbortSignal,
  ): Promise<{ block: true; reason?: string; terminate?: boolean } | undefined> => {
    for (const handler of beforeToolHandlers) {
      const res = await handler({ toolCallId, toolName, args }, { abortSignal: signal });
      if (res?.block) {
        return {
          block: true,
          reason: res.block.reason,
          ...(res.block.terminate === true ? { terminate: true } : {}),
        };
      }
    }
    if (!signal?.aborted && liveOp) {
      liveOp.runningTools = [
        ...liveOp.runningTools.filter((item) => item.toolCallId !== toolCallId),
        { status: 'running', toolCallId, toolName, args },
      ];
      notifyWatchers();
    }
    return undefined;
  };

  const agent = new Agent({
    initialState: {
      systemPrompt: systemPromptText,
      model,
      thinkingLevel: 'off',
      tools: executableTools(),
      messages: session.buildSessionContext().messages,
    },
    streamFn: (chosenModel, ctx, streamOpts) =>
      models.streamSimple(chosenModel, ctx, { ...streamOpts, ...extraStreamOptions }),
    sessionId,
    steeringMode: 'one-at-a-time',
    followUpMode: 'one-at-a-time',
    toolExecution: 'sequential',
    identity: { attribution: null },
    convertToLlm: (messages) => defaultLlmFilter(messages),
    prepareRequest: async () => {
      for (const handler of beforeRequestHandlers) await handler();
      return {
        context: buildContextForAgent(),
        model,
        thinkingLevel: 'off',
      };
    },
    prepareNextTurnWithContext: async (turnCtx) => ({
      ...turnCtx,
      context: buildContextForAgent(),
      model,
      thinkingLevel: 'off',
    }),
    beforeToolCall: async ({ toolCall, args }, signal) => {
      const effectiveSignal = liveOp?.abortController.signal ?? signal;
      return runBeforeTool(toolCall.id, toolCall.name, args, effectiveSignal);
    },
    finishTurn: async (_turn, signal) =>
      signal?.aborted || liveOp?.abortRequested ? { action: 'end' as const } : undefined,
  });

  const entryIdByMessage = new WeakMap<object, string>();
  const stopAgentSub = agent.subscribe(async (event) => {
    if (event.type === 'message_start') {
      const idx = pendingSteer.findIndex((item) => item.message === event.message);
      if (idx !== -1) pendingSteer.splice(idx, 1);
      if (event.message.role === 'assistant' && liveOp) {
        liveOp.streamingMessage = event.message;
      }
      notifyWatchers();
      return;
    }
    if (event.type === 'message_update') {
      if (event.message.role === 'assistant' && liveOp) {
        liveOp.streamingMessage = event.message;
        notifyWatchers();
      }
      return;
    }
    if (event.type === 'tool_execution_end') {
      if (liveOp) {
        liveOp.runningTools = liveOp.runningTools.map((item) =>
          item.toolCallId === event.toolCallId ? { ...item, status: 'completed' } : item);
        notifyWatchers();
      }
      return;
    }
    if (event.type === 'message_end') {
      if (event.message.role === 'system') return;
      const id = await session.appendMessage(event.message);
      entryIdByMessage.set(event.message as object, id);
      if (event.message.role === 'assistant' && liveOp) {
        liveOp.streamingMessage = undefined;
        liveOp.lastAssistant = event.message;
      }
      notifyWatchers();
      return;
    }
    if (event.type === 'turn_end') {
      if (liveOp) liveOp.runningTools = [];
      if (!liveOp?.abortRequested) {
        await flushDeferredWrites();
      }
      notifyWatchers();
    }
  });

  const driveContinue = async (fromTipId: string | null): Promise<{ ok: true } | { ok: false; error: unknown }> => {
    const op = {
      id: randomUUID(),
      startedAt: Date.now(),
      fromTipId,
      streamingMessage: undefined as AssistantMessage | undefined,
      runningTools: [] as LaneRunningToolSnapshot[],
      retry: undefined as { attempt: number; maxAttempts: number; nextAttemptAt: number } | undefined,
      abortController: new AbortController(),
      abortRequested: false,
      lastAssistant: undefined as AssistantMessage | undefined,
    };
    liveOp = op;
    notifyWatchers();
    let retryAttempt = 0;
    const runTask = (async () => {
      try {
        for (;;) {
          if (op.abortRequested) break;
          op.lastAssistant = undefined;
          const ctx = buildContextForAgent();
          agent.state.tools = ctx.tools;
          agent.state.messages = ctx.messages;
          await agent.continue();
          await agent.waitForIdle();
          const readLastAssistant = (): AssistantMessage | undefined => op.lastAssistant;
          const last = readLastAssistant();
          if (op.abortRequested || last?.stopReason === 'aborted') break;
          if (
            retryPolicy.enabled
            && last?.stopReason === 'error'
            && isRetryableAssistantError(last)
            && retryAttempt < retryPolicy.maxRetries
          ) {
            retryAttempt += 1;
            const delayMs = retryDelayMs(retryPolicy, retryAttempt);
            emitProbeEvent({
              type: 'retry_scheduled',
              attempt: retryAttempt,
              errorMessage: last.errorMessage ?? '',
              delayMs,
            });
            op.retry = {
              attempt: retryAttempt,
              maxAttempts: retryPolicy.maxRetries,
              nextAttemptAt: Date.now() + delayMs,
            };
            notifyWatchers();
            const slept = await sleepAbortable(delayMs, op.abortController.signal);
            op.retry = undefined;
            emitProbeEvent({ type: 'retry_end', attempt: retryAttempt });
            if (!slept || op.abortRequested) break;
            const failedId = entryIdByMessage.get(last as object);
            if (failedId) await session.appendContextEdit(failedId, null);
            continue;
          }
          break;
        }
      } finally {
        const wasAborted = op.abortRequested;
        liveOp = null;
        if (!wasAborted) {
          await flushDeferredWrites();
        }
        notifyWatchers();
      }
    })();
    activeRunPromise = runTask.finally(() => {
      if (activeRunPromise === runTask) activeRunPromise = null;
    });
    try {
      await runTask;
      return { ok: true };
    } catch (error) {
      emitProbeEvent({ type: 'fault', error });
      return { ok: false, error };
    }
  };

  const laneHandle: ProbeLaneHandle = {
    prompt: async (input) => {
      await flushDeferredWrites();
      const fromTipId = session.getTipId();
      const messages: AgentMessage[] = typeof input === 'string'
        ? [{ role: 'user', content: [{ type: 'text', text: input }], timestamp: Date.now() }]
        : [...input];
      for (const message of messages) {
        await session.appendMessage(message);
      }
      return driveContinue(fromTipId);
    },
    steer: async (text) => {
      const entryId = randomUUID();
      const message: AgentMessage = {
        role: 'user',
        content: [{ type: 'text', text }],
        timestamp: Date.now(),
      };
      pendingSteer.push({ entryId, message });
      agent.steer(message);
      notifyWatchers();
      return { ok: true, value: { entryId } };
    },
    abort: async () => {
      const drained = pendingSteer.splice(0).map((item) => item.message);
      agent.clearAllQueues();
      agent.abort();
      if (liveOp) {
        liveOp.abortRequested = true;
        liveOp.abortController.abort(new Error('Abort requested'));
      }
      if (activeRunPromise) {
        await activeRunPromise.catch(() => undefined);
      }
      notifyWatchers();
      return { ok: true, value: { steer: drained } };
    },
    appendMessage: async (message) => {
      if (!liveOp) await flushDeferredWrites();
      const id = await session.appendMessage(message);
      notifyWatchers();
      return id;
    },
    appendCustomEntry: async (customType, data) => {
      if (liveOp) {
        const entryId = randomUUID();
        deferredWrites.push({ entryId, customType, ...(data === undefined ? {} : { data }) });
        notifyWatchers();
        return entryId;
      }
      await flushDeferredWrites();
      const id = await session.appendCustomEntry(customType, data);
      notifyWatchers();
      return id;
    },
    findEntries: async (query) => session.findBranchEntries(query),
    inspectExecution: async () => {
      if (liveOp) return { current: { status: 'open' } };
      const { unpaired } = unpairedCallsOf(session.activeTranscript());
      return unpaired.length > 0 ? { current: { status: 'open' } } : {};
    },
    resume: async () => {
      const fromTipId = session.getTipId();
      const { unpaired } = unpairedCallsOf(session.activeTranscript());
      for (const call of unpaired) {
        const tool = executableTools().find((candidate) => candidate.name === call.name);
        let content: Array<{ type: 'text'; text: string }>;
        let details: unknown = {};
        let isError = false;
        if (!tool) {
          isError = true;
          content = [{ type: 'text', text: `Tool ${call.name} not found` }];
        } else {
          try {
            const preparedArgs = tool.prepareArguments ? tool.prepareArguments(call.arguments) : call.arguments;
            const validated = validateToolArguments(tool, { ...call, arguments: preparedArgs as typeof call.arguments });
            const blocked = await runBeforeTool(call.id, call.name, validated);
            if (blocked?.block) {
              isError = true;
              content = [{ type: 'text', text: blocked.reason || 'Tool execution was blocked' }];
            } else {
              const res = await tool.execute(call.id, validated as never);
              content = res.content.filter((c): c is { type: 'text'; text: string } => c.type === 'text');
              details = res.details;
            }
          } catch (error) {
            isError = true;
            content = [{ type: 'text', text: error instanceof Error ? error.message : String(error) }];
          }
        }
        await session.appendMessage({
          role: 'toolResult',
          toolCallId: call.id,
          toolName: call.name,
          content,
          details: details as JsonValue,
          isError,
          timestamp: Date.now(),
        });
      }
      return driveContinue(fromTipId);
    },
    setActiveTools: async (names) => {
      const known = new Set(registeredTools.map((tool) => tool.name));
      activeToolNames = names.filter((name) => known.has(name));
      notifyWatchers();
    },
    getActiveTools: async () => [...activeToolNames],
    watch: async () => {
      let subscribed = true;
      let listenerFn: ((snapshot: LaneSnapshot) => void) | undefined;
      return {
        snapshot: buildSnapshot(),
        start: (listener) => {
          if (!subscribed) return;
          listenerFn = listener;
          watchers.add(listener);
        },
        resnapshot: async () => {
          if (!subscribed) throw new Error('Watcher is unsubscribed');
          return buildSnapshot();
        },
        unsubscribe: () => {
          subscribed = false;
          if (listenerFn) watchers.delete(listenerFn);
        },
      };
    },
  };

  const harnessHandle: ProbeHarnessHandle = {
    events: {
      on: (type, listener) => {
        let set = eventListeners.get(type);
        if (!set) {
          set = new Set();
          eventListeners.set(type, set);
        }
        const wrapped = listener as unknown as (event: ProbeEvent) => void;
        set.add(wrapped);
        return () => { set!.delete(wrapped); };
      },
    },
    hooks: {
      on: (name: 'before_tool' | 'before_request', handler: ProbeBeforeToolHandler | ProbeBeforeRequestHandler) => {
        if (name === 'before_tool') beforeToolHandlers.push(handler as ProbeBeforeToolHandler);
        else beforeRequestHandlers.push(handler as ProbeBeforeRequestHandler);
      },
    },
    setRetryPolicy: async (policy) => { retryPolicy = policy; },
    setStreamOptions: async (opts) => { extraStreamOptions = opts; },
    getTools: async () => [...registeredTools],
    setTools: async (nextTools) => {
      registeredTools = [...nextTools];
      const known = new Set(registeredTools.map((tool) => tool.name));
      activeToolNames = activeToolNames.filter((name) => known.has(name));
    },
    close: async () => close(),
  };

  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    if (liveOp) {
      liveOp.abortRequested = true;
      liveOp.abortController.abort(new Error('Abort requested'));
    }
    agent.abort();
    if (activeRunPromise) {
      await activeRunPromise.catch(() => undefined);
    }
    stopAgentSub();
    watchers.clear();
    await session.close();
    await release();
  })();
  t.after(() => close());
  return { harness: harnessHandle, lane: laneHandle, session, sessionId, modelFacts, close };
}

/** 一个外部可 resolve 的 promise：探针用它把「钩子进来了」这件事交给测试主体，不用墙钟等。 */
export function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** `AbortSignal` → 一个在 abort 时**拒绝**的 promise（拒绝理由 = `signal.reason`）。 */
export function rejectOnAbort(signal: AbortSignal | undefined): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

/** `AbortSignal` → 一个在 abort 时**兑现**的 promise。 */
export function resolveOnAbort(signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!signal) return;
    if (signal.aborted) { resolve(); return; }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}
