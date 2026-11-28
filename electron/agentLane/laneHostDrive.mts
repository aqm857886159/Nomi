// Agent lane · `pi-agent-core@1.7.0` `Agent` 驱动循环、工具前后钩子与崩溃恢复
import { randomUUID } from 'node:crypto';
import { Agent, type AgentMessage, type AgentOptions, type AgentTool } from '@earendil-works/pi-agent-core';
import { convertToLlm as convertCodingAgentMessagesToLlm } from '@earendil-works/pi-coding-agent';
import {
  createAssistantMessageEventStream,
  createInitialSystemMessage,
  isContextOverflow,
  isRecoverableLength,
  isRetryableAssistantError,
  retryDelayMs,
  toToolDeclaration,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type JsonObject,
  type JsonValue,
  type Model,
  type Models,
  type RetryPolicy,
} from '@earendil-works/pi-ai';
import { PI_CONTEXT_OVERFLOW_MESSAGE } from '../shared/agentLane/laneAssistantFault.js';
import { logWarn } from '../logging/logger.js';
import { capabilityContractById } from '../shared/agentCapabilities/registry.js';
import { modelToolCapabilityId } from '../shared/agentCapabilities/modelFacingTools.js';
import { ASK_USER_VERB_NAME } from '../shared/agentCapabilities/askUser.js';
import type { LaneComposerContext } from '../shared/agentLane/laneDesktopContracts.js';
import { isLaneInputMessage } from '../shared/agentLane/laneInputMessage.js';
import { LANE_APPROVAL_NOTE_TYPE, type LaneApprovalNote, type LaneThinkingLevel } from '../shared/agentLane/laneContracts.js';
import type { LaneRunningToolSnapshot, LaneSnapshot } from '../shared/agentLane/laneSnapshotTypes.js';
import type { createLaneApprovalGate } from './laneApprovalGate.js';
import { appendLaneContinuation, laneContinuationText } from './laneContinuation.mjs';
import {
  maybeCompactLaneSession,
  recordSupersededReadEdits,
  type CompactionSettings,
} from './laneContextBudget.mjs';
import type { openLaneHistoryPage } from './laneHistoryPage.mjs';
import { laneInputIntent, type LaneActiveRunMeta } from './laneInputIntent.mjs';
import { laneOriginalText } from './laneOriginalInput.mjs';
import type { createLaneRepeatedFailureTracker } from './laneRepeatedFailure.mjs';
import type { OpenLaneOptions } from './laneRuntimePort.js';
import type { LaneSession } from './laneSession.mjs';
import { takeLaneToolFailure } from './laneTools.mjs';
import type { createLaneToolInputBoundary } from './laneToolInputBoundary.mjs';
import type { attachLaneTrace } from './laneTraceRecorder.mjs';
import type { createLaneTurnBudget } from './laneTurnBudget.mjs';

export interface LaneOrderObservation {
  reported: number;
  partType: string;
}

export interface QueuedMessageRecord {
  readonly entryId: string;
  readonly kind: 'steer' | 'followUp';
  readonly message: AgentMessage;
}

export interface LiveLaneOperation {
  id: string;
  startedAt: number;
  fromTipId: string | null;
  promptEntryIds: string[];
  streamingMessage?: AssistantMessage;
  runningTools: LaneRunningToolSnapshot[];
  retry?: { attempt: number; maxAttempts: number; nextAttemptAt: number };
  abortController: AbortController;
  abortRequested: boolean;
  nextRequestIsRetry: boolean;
  overflowRecoveryAttempted: boolean;
  lastAssistant?: AssistantMessage;
}

const PART_TYPE_BY_EVENT: Readonly<Record<string, string>> = {
  text_start: 'text', text_delta: 'text', text_end: 'text',
  thinking_start: 'thinking', thinking_delta: 'thinking', thinking_end: 'thinking',
  toolcall_start: 'toolCall', toolcall_delta: 'toolCall', toolcall_end: 'toolCall',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

export function interruptedToolCalls(snapshot: LaneSnapshot): {
  ids: string[];
  assistantMessage?: AssistantMessage;
  unpairedCalls: Array<Extract<AssistantMessage['content'][number], { type: 'toolCall' }>>;
} {
  const paired = new Set<string>();
  let lastAssistant: AssistantMessage | undefined;
  const allCalled = new Set<string>();
  for (const entry of snapshot.transcript) {
    if (entry.type !== 'message') continue;
    const message = entry.message;
    if (message.role === 'assistant') {
      if (message.stopReason !== 'aborted' && message.stopReason !== 'error') {
        lastAssistant = message;
        for (const part of message.content) {
          if (part.type === 'toolCall') allCalled.add(part.id);
        }
      } else {
        lastAssistant = undefined;
      }
      continue;
    }
    if (message.role === 'toolResult') {
      allCalled.delete(message.toolCallId);
      paired.add(message.toolCallId);
    }
  }
  const unpairedCalls = lastAssistant
    ? lastAssistant.content.filter(
        (part): part is Extract<AssistantMessage['content'][number], { type: 'toolCall' }> =>
          part.type === 'toolCall' && !paired.has(part.id),
      )
    : [];
  return { ids: [...allCalled], assistantMessage: lastAssistant, unpairedCalls };
}

export function createLaneHostDrive(deps: {
  laneName: string;
  session: LaneSession;
  sessionId: string;
  history: Awaited<ReturnType<typeof openLaneHistoryPage>>;
  options: OpenLaneOptions;
  model: Model<Api>;
  models: Models;
  thinkingLevel: LaneThinkingLevel;
  compactionSettings: CompactionSettings;
  retryPolicy: RetryPolicy;
  turn: ReturnType<typeof createLaneTurnBudget>;
  failures: ReturnType<typeof createLaneRepeatedFailureTracker>;
  toolInput: ReturnType<typeof createLaneToolInputBoundary>;
  gate: ReturnType<typeof createLaneApprovalGate> | undefined;
  toolAccessDenial: (toolName: string) => Promise<string | undefined>;
  trace: ReturnType<typeof attachLaneTrace>;
  executableTools: () => AgentTool<object, unknown>[];
  registeredToolNames: ReadonlySet<string>;
  initialPrompt: string;
  renderModelIndex: (context: LaneComposerContext) => string;
  systemPromptForRun: (runId: string) => Promise<{ prompt: string; closing: string }>;
  pendingSteer: QueuedMessageRecord[];
  pendingFollowUp: QueuedMessageRecord[];
  consumedQueueIds: Set<string>;
  appendCustomDuringOrAfterRun: (customType: string, data?: JsonValue) => Promise<void>;
  flushDeferredNotes: () => Promise<void>;
  publish: () => void;
  isClosed: () => boolean;
  interrupted: ReturnType<typeof interruptedToolCalls>;
}) {
  const {
    laneName, session, sessionId, history, options, model, models, thinkingLevel,
    compactionSettings, retryPolicy, turn, failures, toolInput, gate, toolAccessDenial,
    trace, executableTools, registeredToolNames, initialPrompt, renderModelIndex, systemPromptForRun,
    pendingSteer, pendingFollowUp, consumedQueueIds,
    appendCustomDuringOrAfterRun, flushDeferredNotes, publish, isClosed, interrupted,
  } = deps;

  let liveOperation: LiveLaneOperation | null = null;
  let activeDrivePromise: Promise<void> | null = null;
  let consumedContext: LaneComposerContext | undefined;
  const directlyApplied = new Set<string>();
  const observations: LaneOrderObservation[] = [];
  const entryIdByMessage = new WeakMap<object, string>();

  const NON_OBJECT_ARGS_PREFIX = 'Tool arguments must be a JSON object\n\nReceived arguments:\n';
  function unwrapNonObjectToolCallArgs(message: AssistantMessage): AssistantMessage {
    let changed = false;
    const content = message.content.map((block) => {
      if (block.type !== 'toolCall' || !block.argumentsError?.startsWith(NON_OBJECT_ARGS_PREFIX)) {
        return block;
      }
      const rawJson = block.argumentsError.slice(NON_OBJECT_ARGS_PREFIX.length);
      try {
        const parsed = JSON.parse(rawJson) as unknown;
        changed = true;
        const { argumentsError: _omitted, ...rest } = block;
        return { ...rest, arguments: parsed as JsonObject };
      } catch {
        return block;
      }
    });
    return changed ? { ...message, content } : message;
  }

  const streamFn: AgentOptions['streamFn'] = (chosenModel, ctx, streamOpts) => {
    const rawStream = models.streamSimple(chosenModel, ctx, {
      ...streamOpts,
      onPayload: async (payload, selectedModel) => {
        const rewritten = options.input ? options.input.rewritePayload(payload, selectedModel.api) : payload;
        return (await streamOpts?.onPayload?.(rewritten, selectedModel)) ?? rewritten;
      },
    });
    const wrapped: AssistantMessageEventStream = createAssistantMessageEventStream();
    void (async () => {
      try {
        for await (const event of rawStream) {
          if (event.type === 'done') {
            wrapped.push({ ...event, message: unwrapNonObjectToolCallArgs(event.message) });
          } else {
            wrapped.push(event);
          }
        }
        wrapped.end(unwrapNonObjectToolCallArgs(await rawStream.result()));
      } catch (err) {
        wrapped.end({
          role: 'assistant',
          content: [],
          api: chosenModel.api,
          provider: chosenModel.provider,
          model: chosenModel.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: streamOpts?.signal?.aborted ? 'aborted' : 'error',
          errorMessage: err instanceof Error ? err.message : String(err),
          timestamp: Date.now(),
        });
      }
    })();
    return wrapped;
  };

  const buildRequestContext = async (baseMessages: readonly AgentMessage[]): Promise<{
    messages: AgentMessage[];
    tools: AgentTool<object, unknown>[];
  }> => {
    const runId = liveOperation?.id ?? 'idle';
    const runMeta: LaneActiveRunMeta | undefined = liveOperation
      ? { sourceTipId: liveOperation.fromTipId, promptEntryIds: liveOperation.promptEntryIds }
      : undefined;
    const nonSystem = baseMessages.filter((msg) => msg.role !== 'system');
    const { quote, input, catalogInput } = laneInputIntent(session, runMeta, nonSystem);
    consumedContext = input?.context;
    if (input && options.input) options.input.activate(input.context);

    const currentTools = executableTools();
    const authority = gate
      ? currentTools
          .filter((tool) => options.tools.some((spec) => spec.name === tool.name))
          .flatMap((tool) => {
            const operation = (tool.parameters as unknown as { properties?: Record<string, { enum?: unknown[] }> }).properties?.operation;
            const operations = operation?.enum?.filter((value): value is string => typeof value === 'string') ?? [undefined];
            return operations.map((value) => {
              let description = 'requires user confirmation';
              try {
                description = gate.describe({
                  toolCallId: '',
                  toolName: tool.name,
                  args: value ? { operation: value } : {},
                });
              } catch {
                description = 'denied by policy';
              }
              return `- ${tool.name}${value ? `.${value}` : ''}: ${description}`;
            });
          })
          .join('\n')
      : '';

    const { prompt, closing } = await systemPromptForRun(runId);
    const fullSystemPrompt = [
      prompt,
      catalogInput ? renderModelIndex(catalogInput.context) : '',
      input?.context.systemPrompt,
      input?.context.skillPrompt,
      quote,
      authority,
      closing,
    ].filter(Boolean).join('\n\n');

    const head = createInitialSystemMessage(fullSystemPrompt, currentTools.map(toToolDeclaration));
    return {
      messages: head ? [head, ...nonSystem] : [...nonSystem],
      tools: currentTools,
    };
  };

  const drainQueuesForAbort = () => {
    const drained = [
      ...pendingSteer.splice(0).map((item) => ({ kind: 'steer' as const, message: item.message })),
      ...pendingFollowUp.splice(0).map((item) => ({ kind: 'followUp' as const, message: item.message })),
    ];
    agent.clearAllQueues();
    return drained;
  };

  const runBeforeToolHook = async (
    toolCallId: string,
    toolName: string,
    args: unknown,
    signal?: AbortSignal,
  ): Promise<{ block: true; reason?: string } | undefined> => {
    const spec = options.tools.find((tool) => tool.name === toolName);
    const contract = spec ? capabilityContractById(modelToolCapabilityId(spec, args)) : undefined;
    if (
      options.input
      && contract?.effect === 'destructive'
      && contract.execution.availability === 'renderer_required'
      && consumedContext?.admissionSurface !== contract.targetKind
    ) {
      return {
        block: true,
        reason: `surface_authority_denied: This action requires the ${contract.targetKind} surface. `
          + 'Ask the user to switch to that surface and send the action again; approval cannot grant another surface.',
      };
    }
    const accessDenial = await toolAccessDenial(toolName);
    if (accessDenial) return { block: true, reason: accessDenial };
    const preflightSignal = signal ?? new AbortController().signal;
    const rejected = await toolInput.prepare(
      toolName,
      args,
      () => options.toolLifecycle?.prepare({ toolCallId, toolName, args }, preflightSignal),
    );
    if (rejected !== undefined) return { block: true, reason: rejected };

    if (gate) {
      const exhausted = toolName === ASK_USER_VERB_NAME ? failures.exhausted() : undefined;
      const askArgs = exhausted && isRecord(args)
        ? { ...args, askReason: { code: 'retry_exhausted', attempts: exhausted.attempts } }
        : args;
      const outcome = await gate.preflight(
        { toolCallId, toolName, args: askArgs },
        signal,
      );
      if (outcome.allow && outcome.decision === 'auto-granted' && outcome.undoable) {
        directlyApplied.add(toolCallId);
      }
      if (outcome.decision !== 'cancelled' || outcome.cause === 'restart') {
        const note: LaneApprovalNote = {
          toolCallId,
          toolName,
          decision: outcome.decision,
          ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
          ...(outcome.cause === undefined ? {} : { cause: outcome.cause }),
        };
        await appendCustomDuringOrAfterRun(LANE_APPROVAL_NOTE_TYPE, { ...note });
      }
      if (!outcome.allow) {
        if (outcome.decision === 'cancelled' && outcome.cause !== 'restart' && signal?.aborted) {
          return { block: true, reason: 'Tool execution was cancelled before completion.' };
        }
        return { block: true, reason: outcome.reason ?? '' };
      }
    }

    await options.toolLifecycle?.approved(
      { toolCallId, toolName, args },
      async (type, data) => { await appendCustomDuringOrAfterRun(type, data as JsonValue); },
      {
        signal: preflightSignal,
        canAskUser: Boolean(gate) && options.approval?.hasUserInterface === true,
        waitForUser: () => gate
          ? {
              outcome: gate.hold({ toolCallId, toolName }, preflightSignal),
              settle: (outcome) => gate.settleHold(toolCallId, outcome),
            }
          : {
              outcome: Promise.resolve({ kind: 'cancelled' as const, cause: 'stopped' as const }),
              settle: () => false,
            },
      },
    );
    if (!signal?.aborted && liveOperation) {
      trace.onToolStart({ runId: liveOperation.id, toolCallId });
      liveOperation.runningTools = [
        ...liveOperation.runningTools.filter((t) => t.toolCallId !== toolCallId),
        { status: 'running', toolCallId, toolName, args },
      ];
      publish();
    }
    return undefined;
  };

  const agentOptions: AgentOptions = {
    initialState: {
      systemPrompt: initialPrompt,
      model,
      thinkingLevel,
      tools: executableTools(),
      messages: session.buildSessionContext().messages,
    },
    streamFn,
    sessionId: `${sessionId}:${laneName}`,
    steeringMode: 'one-at-a-time',
    followUpMode: 'one-at-a-time',
    toolExecution: 'sequential',
    identity: { attribution: null },
    convertToLlm: async (messages) => {
      const mapped = await Promise.all(messages.map(async (message, index) => {
        if (!isLaneInputMessage(message)) return message;
        if (!options.input) throw new Error('This lane cannot resolve its recorded input context.');
        const source = message.context.continueFromEntryId && message.context.retryFromEntryId
          ? session.getEntry(message.context.retryFromEntryId)
          : undefined;
        const originalText = source ? laneOriginalText(source) : undefined;
        const providerInput = originalText
          ? { ...message, content: `${message.content}\n\nOriginal task to continue:\n${originalText}` }
          : message;
        const content = await options.input.providerContent(
          providerInput,
          messages.slice(0, index).reverse().find(isLaneInputMessage)?.context,
        );
        const reference = message.context.continueFromEntryId;
        return {
          role: 'user' as const,
          content: reference === undefined
            ? content
            : appendLaneContinuation(content, laneContinuationText(session.getEntry(reference))),
          timestamp: message.timestamp,
        };
      }));
      return convertCodingAgentMessagesToLlm(mapped);
    },
    prepareRequest: async () => {
      const runId = liveOperation?.id ?? 'idle';
      const isRetry = Boolean(liveOperation?.nextRequestIsRetry);
      if (liveOperation) liveOperation.nextRequestIsRetry = false;
      const allowed = turn.onBeforeRequest({
        runId,
        isRetry,
        abortWithQueued: () => {
          if (liveOperation) liveOperation.abortRequested = true;
          const drained = drainQueuesForAbort();
          agent.abort();
          return drained;
        },
      });
      if (!allowed) return undefined;
      const projectedMessages = session.buildSessionContext().messages;
      const nextContext = await buildRequestContext(projectedMessages);
      return {
        context: nextContext,
        model,
        thinkingLevel,
      };
    },
    prepareNextTurnWithContext: async (turnCtx, signal) => {
      await maybeCompactLaneSession({
        session,
        model,
        streamFn,
        settings: compactionSettings,
        options,
        retry: retryPolicy,
        signal,
      });
      await history.reset(session.getTipId());
      const projectedMessages = session.buildSessionContext().messages;
      const nextContext = await buildRequestContext(projectedMessages);
      return {
        ...turnCtx,
        context: nextContext,
        model,
        thinkingLevel,
      };
    },
    beforeToolCall: async ({ toolCall, args }, signal) =>
      runBeforeToolHook(toolCall.id, toolCall.name, args, signal),
    finishTurn: async (_completedTurn, signal) =>
      signal?.aborted || liveOperation?.abortRequested ? { action: 'end' as const } : undefined,
    afterToolCall: async ({ toolCall, args, result, isError }) => {
      options.toolLifecycle?.settled({
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        args,
      });
      gate?.forget(toolCall.id);
      const appliedDirectly = directlyApplied.delete(toolCall.id);
      const body = result.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
      const failure = isError ? takeLaneToolFailure(toolCall.id) : undefined;
      const { consecutive, stop } = toolInput.settle(toolCall.name, isError, failure);
      if (isError) {
        logWarn('agent', 'lane-tool-failed', {
          tool: toolCall.name,
          firstLine: body.split('\n', 1)[0]!.slice(0, 200),
          consecutive,
        });
      }
      const details = failure
        ? { ...(isRecord(result.details) ? result.details : {}), failure }
        : undefined;
      if (appliedDirectly && !isError) {
        const undoNote = '\n[Applied directly under Direct mode; user can undo with Cmd+Z / Ctrl+Z.]';
        return {
          content: [{ type: 'text' as const, text: `${body}${undoNote}${stop ? `\n\n${stop}` : ''}` }],
          ...(details ? { details } : {}),
        };
      }
      if (!stop && !details) return undefined;
      return {
        ...(details ? { details } : {}),
        ...(stop ? { content: [{ type: 'text' as const, text: `${body}\n\n${stop}` }] } : {}),
      };
    },
  };
  const agent = new Agent(agentOptions);

  const stopSubscription = agent.subscribe(async (event) => {
    const runId = liveOperation?.id ?? 'idle';
    if (event.type === 'message_start') {
      const steerIndex = pendingSteer.findIndex((item) => item.message === event.message);
      if (steerIndex !== -1) {
        const [consumed] = pendingSteer.splice(steerIndex, 1);
        if (consumed) consumedQueueIds.add(consumed.entryId);
        if (liveOperation) liveOperation.overflowRecoveryAttempted = false;
        publish();
      } else {
        const followIndex = pendingFollowUp.findIndex((item) => item.message === event.message);
        if (followIndex !== -1) {
          const [consumed] = pendingFollowUp.splice(followIndex, 1);
          if (consumed) consumedQueueIds.add(consumed.entryId);
          if (liveOperation) liveOperation.overflowRecoveryAttempted = false;
          publish();
        }
      }
      if (event.message.role === 'assistant' && liveOperation) {
        liveOperation.streamingMessage = event.message;
        publish();
      }
      return;
    }
    if (event.type === 'message_update') {
      const inner = event.assistantMessageEvent;
      const partType = PART_TYPE_BY_EVENT[inner.type];
      if (partType !== undefined && 'contentIndex' in inner) {
        observations.push({ reported: inner.contentIndex, partType });
      }
      if (event.message.role === 'assistant' && liveOperation) {
        liveOperation.streamingMessage = event.message;
        publish();
      }
      return;
    }
    if (event.type === 'tool_execution_start') {
      return;
    }
    if (event.type === 'tool_execution_end') {
      trace.onToolEnd({ toolCallId: event.toolCallId });
      turn.onToolEnd(event.toolName, event.isError, registeredToolNames);
      if (liveOperation) {
        liveOperation.runningTools = liveOperation.runningTools.map((t) =>
          t.toolCallId === event.toolCallId ? { ...t, status: 'completed' } : t);
        publish();
      }
      return;
    }
    if (event.type === 'message_end') {
      if (event.message.role === 'system') return;
      turn.onMessageEnd(runId, event.message);
      const entryId = await session.appendMessage(event.message);
      entryIdByMessage.set(event.message as object, entryId);
      const persisted = session.getEntry(entryId);
      if (persisted) history.append(persisted);
      if (event.message.role === 'toolResult') {
        await recordSupersededReadEdits(session, options.tools, entryId);
      }
      if (event.message.role === 'assistant' && liveOperation) {
        liveOperation.streamingMessage = undefined;
        liveOperation.lastAssistant = event.message;
        if (event.message.stopReason !== 'error' && event.message.stopReason !== 'length') {
          liveOperation.overflowRecoveryAttempted = false;
        }
      }
      publish();
      return;
    }
    if (event.type === 'turn_end') {
      if (liveOperation) {
        liveOperation.runningTools = [];
      }
      if (!liveOperation?.abortRequested) {
        await flushDeferredNotes();
      }
      publish();
    }
  });

  async function omitFailedAssistantAttempt(failed: AssistantMessage): Promise<void> {
    const assistantEntryId = entryIdByMessage.get(failed as object)
      ?? [...session.branchEntries()].reverse().find(
        (e) => e.type === 'message' && e.message === failed,
      )?.id;
    if (!assistantEntryId) return;
    const toolCallIds = new Set(
      failed.content.flatMap((block) => (block.type === 'toolCall' ? [block.id] : [])),
    );
    await session.appendContextEdit(assistantEntryId, null);
    if (toolCallIds.size > 0) {
      const branch = session.branchEntries();
      const startIdx = branch.findIndex((e) => e.id === assistantEntryId);
      if (startIdx >= 0) {
        for (const entry of branch.slice(startIdx + 1)) {
          if (entry.type !== 'message') continue;
          if (entry.message.role === 'assistant') break;
          if (entry.message.role === 'toolResult' && toolCallIds.has(entry.message.toolCallId)) {
            await session.appendContextEdit(entry.id, null);
          }
        }
      }
    }
  }

  async function driveOperation(initialPromptEntryIds: string[], fromTipId: string | null): Promise<void> {
    const runId = randomUUID();
    const startedAt = Date.now();
    const op: LiveLaneOperation = {
      id: runId,
      startedAt,
      fromTipId,
      promptEntryIds: [...initialPromptEntryIds],
      streamingMessage: undefined,
      runningTools: [],
      retry: undefined,
      abortController: new AbortController(),
      abortRequested: false,
      nextRequestIsRetry: false,
      overflowRecoveryAttempted: false,
      lastAssistant: undefined,
    };
    liveOperation = op;
    trace.onRunStart({ runId, startedAt });
    publish();

    let retryAttempt = 0;
    let status: 'completed' | 'aborted' | 'failed' = 'completed';
    try {
      for (;;) {
        if (op.abortRequested || isClosed()) {
          status = 'aborted';
          break;
        }
        if (retryAttempt === 0 && !op.overflowRecoveryAttempted) {
          const preCompacted = await maybeCompactLaneSession({
            session,
            model,
            streamFn,
            settings: compactionSettings,
            options,
            retry: retryPolicy,
            signal: op.abortController.signal,
          });
          if (preCompacted) {
            await history.reset(session.getTipId());
          }
        }
        op.lastAssistant = undefined;
        const currentCtx = await buildRequestContext(session.buildSessionContext().messages);
        agent.state.tools = currentCtx.tools;
        agent.state.messages = currentCtx.messages;
        await agent.continue();
        await agent.waitForIdle();

        const readLastAssistant = (): AssistantMessage | undefined => op.lastAssistant;
        const last = readLastAssistant();
        if (op.abortRequested || isClosed() || last?.stopReason === 'aborted') {
          status = 'aborted';
          break;
        }
        if (
          last
          && !op.overflowRecoveryAttempted
          && (
            isContextOverflow(last, model.contextWindow)
            || (last.stopReason === 'length' && isRecoverableLength(last, model.maxTokens))
          )
        ) {
          op.overflowRecoveryAttempted = true;
          await omitFailedAssistantAttempt(last);
          const compacted = await maybeCompactLaneSession({
            session,
            model,
            streamFn,
            settings: compactionSettings,
            options,
            retry: retryPolicy,
            signal: op.abortController.signal,
            force: true,
          }).catch(() => false);
          if (compacted) {
            await history.reset(session.getTipId());
            publish();
            continue;
          }
          if (!last.errorMessage) {
            const overflowFailure: AssistantMessage = {
              ...last,
              content: [],
              stopReason: 'error',
              errorMessage: PI_CONTEXT_OVERFLOW_MESSAGE,
            };
            const id = await session.appendMessage(overflowFailure);
            const persisted = session.getEntry(id);
            if (persisted) history.append(persisted);
            status = 'failed';
            break;
          }
        }
        if (
          retryPolicy.enabled
          && last?.stopReason === 'error'
          && isRetryableAssistantError(last)
          && retryAttempt < retryPolicy.maxRetries
        ) {
          retryAttempt += 1;
          const delayMs = retryDelayMs(retryPolicy, retryAttempt);
          op.retry = {
            attempt: retryAttempt + 1,
            maxAttempts: retryPolicy.maxRetries + 1,
            nextAttemptAt: Date.now() + delayMs,
          };
          publish();
          const slept = await sleepAbortable(delayMs, op.abortController.signal);
          op.retry = undefined;
          if (!slept || op.abortRequested || isClosed()) {
            status = 'aborted';
            break;
          }
          await omitFailedAssistantAttempt(last);
          op.nextRequestIsRetry = true;
          publish();
          continue;
        }
        if (last?.stopReason === 'error') {
          status = 'failed';
          break;
        }
        const compacted = await maybeCompactLaneSession({
          session,
          model,
          streamFn,
          settings: compactionSettings,
          options,
          retry: retryPolicy,
          signal: op.abortController.signal,
        });
        if (compacted) {
          await history.reset(session.getTipId());
        }
        status = 'completed';
        break;
      }
    } finally {
      const endedAt = Date.now();
      liveOperation = null;
      await flushDeferredNotes();
      for (const item of turn.drainUnconsumed()) {
        const entryId = randomUUID();
        if (item.kind === 'steer') {
          pendingSteer.push({ entryId, kind: 'steer', message: item.message });
          agent.steer(item.message);
        } else {
          pendingFollowUp.push({ entryId, kind: 'followUp', message: item.message });
          agent.followUp(item.message);
        }
      }
      trace.onRunEnd({
        runId,
        fromTipId,
        tipId: session.getTipId(),
        endedAt,
        status,
      });
      publish();
    }
  }

  const startDrive = (promptEntryIds: string[], fromTipId: string | null): Promise<void> => {
    const tracked = driveOperation(promptEntryIds, fromTipId).finally(() => {
      if (activeDrivePromise === tracked) activeDrivePromise = null;
    });
    activeDrivePromise = tracked;
    return tracked;
  };

  if (interrupted.unpairedCalls.length > 0 && interrupted.assistantMessage) {
    const fromTipId = session.getTipId();
    activeDrivePromise = (async () => {
      for (const call of interrupted.unpairedCalls) {
        const tool = executableTools().find((t) => t.name === call.name);
        const blocked = await runBeforeToolHook(call.id, call.name, call.arguments);
        let content: Array<{ type: 'text'; text: string }>;
        let details: unknown = {};
        let isError = false;
        if (blocked?.block) {
          isError = true;
          content = [{ type: 'text', text: blocked.reason || 'Tool execution was cancelled before completion.' }];
        } else if (tool && tool.replay === 'safe') {
          try {
            const res = await tool.execute(call.id, call.arguments as never);
            content = res.content.filter((c): c is { type: 'text'; text: string } => c.type === 'text');
            details = res.details;
          } catch (err) {
            isError = true;
            content = [{ type: 'text', text: err instanceof Error ? err.message : String(err) }];
          }
        } else {
          isError = true;
          content = [{
            type: 'text',
            text: 'Tool call interrupted by restart before completion and cannot be automatically replayed.',
          }];
        }
        const toolResultMsg: AgentMessage = {
          role: 'toolResult',
          toolCallId: call.id,
          toolName: call.name,
          content,
          details: details as JsonValue,
          isError,
          timestamp: Date.now(),
        };
        const id = await session.appendMessage(toolResultMsg);
        const persisted = session.getEntry(id);
        if (persisted) history.append(persisted);
      }
      await flushDeferredNotes();
      publish();
      await driveOperation([], fromTipId);
    })()
      .catch((error: unknown) => {
        logWarn('agent', 'lane-resume-failed', { lane: laneName }, error);
      })
      .finally(() => {
        activeDrivePromise = null;
      });
  }

  return {
    agent,
    observations,
    entryIdByMessage,
    getLiveOperation: () => liveOperation,
    hasActiveDrive: () => activeDrivePromise !== null,
    waitActiveDrive: async () => {
      if (activeDrivePromise) await activeDrivePromise.catch(() => undefined);
    },
    abortLiveOperation: () => {
      if (liveOperation) {
        liveOperation.abortRequested = true;
        liveOperation.abortController.abort();
      }
    },
    drainQueuesForAbort,
    startDrive,
    stopSubscription,
  };
}
