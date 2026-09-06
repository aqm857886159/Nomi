import { isAbsolute } from 'node:path';
import type { AssistantMessage, Context, Usage } from '@earendil-works/pi-ai';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { RunAgentTurn, RuntimeErrorFacts, RuntimeFinishReason, RuntimeToolCallRecord,
  RuntimeTurnResult, RuntimeUsage } from '../runtimePort.js';
import { createControlledSession } from './session.mjs';
import { exportSnapshot, importSnapshot } from './snapshot.mjs';
import { addPdfContext, installNativePdfBridge } from './attachments.mjs';
import { observeNativeStream } from './observeStream.mjs';
import { createErrorFacts } from './errorFacts.mjs';

function nomiUsage(usage: Usage): RuntimeUsage {
  // `reasoning` and `cost` are the two fields the SDK leaves undefined when the
  // provider says nothing. Carry that absence through untouched: a `?? 0` here
  // is what turns "we don't know" into a printed "0" three layers up.
  const reasoning = typeof usage.reasoning === 'number' && Number.isFinite(usage.reasoning)
    ? Math.max(0, Math.floor(usage.reasoning)) : undefined;
  // `cost` is not optional in the SDK: an unpriced model still yields a fully
  // populated zero. A turn that burned tokens and "cost 0" is the runtime
  // saying "I have no price for this model", not "this was free" — and
  // 0 is exactly the number that prints as a confident `$0.00`. Treat it as
  // unknown. A genuinely free turn is one that consumed nothing, and that one
  // has nothing to show either way.
  const total = usage.cost?.total;
  const costUsd = typeof total === 'number' && Number.isFinite(total) && total > 0
    ? total : undefined;
  return { promptTokens: usage.input + usage.cacheRead + usage.cacheWrite,
    completionTokens: usage.output, cachedPromptTokens: usage.cacheRead,
    totalTokens: usage.totalTokens || usage.input + usage.cacheRead + usage.cacheWrite + usage.output,
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}) };
}

function finishReason(reason: AssistantMessage['stopReason']): RuntimeFinishReason {
  return reason === 'pending' || reason === 'deferred' ? 'error' : reason;
}

function modelText(result: unknown): string {
  return typeof result === 'string' ? result : JSON.stringify(result) ?? 'Approved.';
}

function withCurrentWorkContext(input: Context, timestamp: number | undefined,
  durableText: string, currentContextText: string): Context {
  const messages = [...input.messages];
  // The current user is the last exact anchor, even when restored history has
  // the same text and millisecond. Never mutate the SDK's durable messages.
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user' || message.timestamp !== timestamp) continue;
    const original = typeof message.content === 'string' ? message.content
      : message.content.filter((part) => part.type === 'text').map((part) => part.text).join('');
    if (original !== durableText) continue;
    messages[index] = { ...message, content: [
      ...(typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : message.content),
      { type: 'text', text: currentContextText },
    ] };
    return { ...input, messages };
  }
  // Compaction can remove that anchor. Supply this turn's intent and live work
  // only to this normal request; it must not enter summary input or history.
  messages.push({ role: 'user', timestamp: timestamp ?? Date.now(), content: [
    { type: 'text', text: durableText }, { type: 'text', text: currentContextText },
  ] });
  return { ...input, messages };
}

/** A turn owns one fresh SDK session. The caller owns all cross-turn publication. */
export const runAgentTurn: RunAgentTurn = async (request, hooks) => {
  const facts = createErrorFacts(request.model);
  const usage: RuntimeUsage = { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0, totalTokens: 0 };
  const records = new Map<string, RuntimeToolCallRecord>();
  let text = '';
  let normalRequests = 0;
  let summaryRequests = 0;
  let steps = 0;
  let compactions = 0;
  let currentUserTimestamp: number | undefined;
  let lastAssistant: AssistantMessage | undefined;
  let lastNormalFailure: RuntimeErrorFacts | undefined;
  let lastSummaryFailure: RuntimeErrorFacts | undefined;
  let controlled: Awaited<ReturnType<typeof createControlledSession>> | undefined;
  let unsubscribe: (() => void) | undefined;
  let uninstallPdf: (() => void) | undefined;
  let stop: Promise<void> | undefined;
  let failure: RuntimeErrorFacts | undefined;
  let snapshot: string | undefined;
  let context: RuntimeTurnResult['context'];
  const cancel = () => { stop ??= controlled?.stop(); };
  hooks.signal?.addEventListener('abort', cancel, { once: true });
  try {
    hooks.signal?.throwIfAborted();
    if (![request.cwd, request.agentDir, request.tempRoot].every(isAbsolute)) {
      throw new Error('Nomi runtime paths must be absolute');
    }
    const sessionManager = request.snapshot && !request.capability.singleShot
      ? await importSnapshot(request.snapshot, { cwd: request.cwd, tempRoot: request.tempRoot }) : undefined;
    hooks.signal?.throwIfAborted();
    controlled = await createControlledSession({ ...request, sessionManager,
      singleShot: request.capability.singleShot,
      tools: request.tools.map((tool) => ({ ...tool, execute: async (args, { toolCallId, signal }) => {
        signal.throwIfAborted();
        const call = { toolCallId, toolName: tool.name, args };
        hooks.emit({ type: 'tool-call', ...call });
        const record: RuntimeToolCallRecord = { ...call, status: 'error' };
        records.set(toolCallId, record);
        // Activity listeners can synchronously stop the turn. Check again at
        // the sole host-dispatch boundary, not only before domain validation.
        signal.throwIfAborted();
        const decision = await hooks.awaitToolConfirmation(call, signal);
        signal.throwIfAborted();
        record.decision = decision;
        if (!decision.ok) {
          record.status = decision.denied ? 'denied' : 'error';
          record.error = decision.message ?? 'Nomi did not approve the tool call.';
          return { status: record.status, message: record.error };
        }
        record.status = 'ok';
        record.result = decision.result;
        return { status: 'ok', content: [{ type: 'text', text: modelText(decision.result) }], details: decision };
      } })),
    });
    hooks.signal?.throwIfAborted();
    const { session } = controlled;
    const currentControlled = controlled;
    session.settingsManager.applyOverrides({ compaction: { ...request.compaction,
      enabled: request.compaction.enabled && !request.capability.singleShot } });
    if (hooks.onPayload) session.agent.onPayload = async (payload) => {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Nomi model profile requires a plain request object');
      }
      const body = { ...payload } as Record<string, unknown>;
      const adjusted = await hooks.onPayload!(body);
      hooks.signal?.throwIfAborted();
      return adjusted ?? body;
    };
    const normalPrompt = session.systemPrompt;
    const previousStream = session.agent.streamFunction;
    session.agent.shouldStopAfterTurn = () => normalRequests >= request.capability.maxSteps;
    session.agent.streamFunction = (model, input, options) => {
      const signal = options?.signal
        ? AbortSignal.any([currentControlled.launchSignal, options.signal]) : currentControlled.launchSignal;
      if (signal.aborted) {
        // A late auto-compaction controller must be marked aborted too, so the
        // SDK cannot save an empty summary after cancellation during auth.
        session.abortCompaction();
        session.abortBranchSummary();
      }
      signal.throwIfAborted();
      const normal = input.systemPrompt === normalPrompt;
      if (normal) {
        if (normalRequests >= request.capability.maxSteps) {
          throw new Error('Nomi step limit rejected an extra model continuation');
        }
        normalRequests += 1;
        if (normalRequests === request.capability.maxSteps) {
          // Post-agent auto-compaction may otherwise continue after agent_end.
          session.setAutoCompactionEnabled(false);
        }
      } else summaryRequests += 1;
      const context = normal && request.user.currentContextText
        ? withCurrentWorkContext(input, currentUserTimestamp, request.user.durableText, request.user.currentContextText)
        : input;
      let httpFailure: RuntimeErrorFacts | undefined;
      return observeNativeStream((activeSignal) => previousStream(model, context, {
        ...options, signal: activeSignal, maxRetries: 0,
        fetch: facts.fetch(hooks.fetch ?? options?.fetch ?? globalThis.fetch, (error) => { httpFailure = error; }),
      }), {
        signal, firstResponseMs: normalRequests + summaryRequests === 1 ? 90_000 : 120_000, idleMs: 120_000,
        onResult: (message) => {
          const consumed = nomiUsage(message.usage);
          usage.promptTokens += consumed.promptTokens;
          usage.completionTokens += consumed.completionTokens;
          usage.cachedPromptTokens += consumed.cachedPromptTokens;
          usage.totalTokens += consumed.totalTokens;
          // 两个可选字段逐项累加，而且**只在这一步真的报了**的时候才累加：
          // 一个回合有多次模型请求，其中一次报了推理 token、另一次没报，
          // 把没报的当 0 加进去会让总数看起来「这一步没思考」，而真相是「这一步没说」。
          // 只要有一步报过，字段就存在；一步都没报过，它整个不存在。
          if (consumed.reasoningTokens !== undefined) {
            usage.reasoningTokens = (usage.reasoningTokens ?? 0) + consumed.reasoningTokens;
          }
          if (consumed.costUsd !== undefined) usage.costUsd = (usage.costUsd ?? 0) + consumed.costUsd;
          const failure = message.stopReason === 'error' || message.stopReason === 'aborted'
            ? httpFailure ?? facts.describe(message.errorMessage ?? 'Model request failed') : undefined;
          if (normal) lastNormalFailure = failure;
          else lastSummaryFailure = failure;
        },
        onFault: (error) => {
          if (normal) lastNormalFailure = httpFailure ?? facts.describe(error);
          else lastSummaryFailure = httpFailure ?? facts.describe(error);
        },
      });
    };
    unsubscribe = session.subscribe((event) => {
      if (event.type === 'message_start' && event.message.role === 'user' && currentUserTimestamp === undefined) {
        const content = typeof event.message.content === 'string' ? event.message.content
          : event.message.content.filter((part) => part.type === 'text').map((part) => part.text).join('');
        if (content === request.user.durableText) currentUserTimestamp = event.message.timestamp;
      } else if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        const delta = event.assistantMessageEvent.delta;
        text += delta;
        hooks.emit({ type: 'content-delta', delta });
      } else if (event.type === 'message_end' && event.message.role === 'assistant') {
        lastAssistant = event.message;
      } else if (event.type === 'tool_execution_start') {
        // This is before Zod validation: retain raw facts, but never emit host execution.
        records.set(event.toolCallId, { toolCallId: event.toolCallId, toolName: event.toolName,
          args: event.args, status: 'error' });
      } else if (event.type === 'tool_execution_end') {
        const record: RuntimeToolCallRecord = records.get(event.toolCallId) ?? { toolCallId: event.toolCallId,
          toolName: event.toolName, args: undefined, status: 'error' };
        records.set(event.toolCallId, record);
        if (event.isError) {
          record.status = hooks.signal?.aborted ? 'cancelled' : record.status === 'denied' ? 'denied' : 'error';
          const result: AgentToolResult<unknown> = event.result;
          record.error ??= result.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
          hooks.emit({ type: 'tool-error', toolCallId: record.toolCallId, toolName: record.toolName,
            message: record.error, ...(record.status === 'denied' ? { denied: true } : {}),
            ...(record.status === 'cancelled' ? { cancelled: true } : {}) });
        } else {
          hooks.emit({ type: 'tool-result', toolCallId: record.toolCallId, toolName: record.toolName,
            result: record.result, decision: record.decision });
        }
      } else if (event.type === 'turn_end' && event.message.role === 'assistant') {
        hooks.emit({ type: 'step-finish', step: ++steps, finishReason: finishReason(event.message.stopReason),
          usage: nomiUsage(event.message.usage) });
      } else if (event.type === 'compaction_end') {
        if (event.result && !event.aborted) compactions += 1;
        if (event.errorMessage && event.reason === 'threshold' && !hooks.signal?.aborted) {
          hooks.emit({ type: 'warning', error: lastSummaryFailure ?? facts.describe(event.errorMessage) });
        }
      }
    });
    uninstallPdf = installNativePdfBridge(session);
    await addPdfContext(session, request.user.pdfs ?? []);
    hooks.signal?.throwIfAborted();
    await session.prompt(request.user.durableText, { expandPromptTemplates: false,
      images: request.user.images?.map((file) => ({ type: 'image', mimeType: file.mimeType,
        data: Buffer.from(file.data).toString('base64') })) });
  } catch (error) {
    failure = facts.describe(error);
  } finally {
    await stop;
    if (controlled) {
      try {
        if (!request.capability.singleShot) snapshot = exportSnapshot(controlled.session);
        context = { normalRequests, summaryRequests, compactions, retainedMessages: controlled.session.messages.length };
      } catch (error) { failure ??= facts.describe(error); }
      unsubscribe?.();
      uninstallPdf?.();
      await controlled.dispose();
    }
    hooks.signal?.removeEventListener('abort', cancel);
  }
  if (hooks.signal?.aborted) {
    return { status: 'cancelled', text, finishReason: 'aborted', usage, toolCalls: [...records.values()], snapshot, context,
      error: { kind: 'abort', message: 'Nomi turn cancelled' } };
  }
  const reason = lastAssistant ? finishReason(lastAssistant.stopReason) : 'error';
  if (reason === 'toolUse' && normalRequests >= request.capability.maxSteps) {
    failure = { kind: 'step-limit', message: `Nomi turn reached its ${request.capability.maxSteps}-request limit before a final answer` };
  }
  if (failure || reason === 'error' || reason === 'aborted') {
    return { status: 'error', text, finishReason: reason, usage, toolCalls: [...records.values()], snapshot, context,
      error: lastNormalFailure ?? failure ?? facts.describe(lastAssistant?.errorMessage ?? 'Nomi runtime did not produce a response') };
  }
  return { status: 'finished', text, finishReason: reason, usage, toolCalls: [...records.values()], snapshot, context };
};
