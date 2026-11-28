// Agent lane · 流式包装、中断工具恢复、失败尝试折叠与工具结算辅助（从 `laneHostDrive.mts` 拆出，单文件 < 300 行）
import type { AgentMessage, AgentOptions, AgentTool } from '@earendil-works/pi-agent-core';
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type JsonObject,
  type JsonValue,
  type Models,
} from '@earendil-works/pi-ai';
import { logWarn } from '../logging/logger.js';
import type { LaneRunningToolSnapshot, LaneSnapshot } from '../shared/agentLane/laneSnapshotTypes.js';
import type { createLaneApprovalGate } from './laneApprovalGate.js';
import type { openLaneHistoryPage } from './laneHistoryPage.mjs';
import type { OpenLaneOptions } from './laneRuntimePort.js';
import type { LaneSession } from './laneSession.mjs';
import { takeLaneToolFailure } from './laneTools.mjs';
import type { createLaneToolInputBoundary } from './laneToolInputBoundary.mjs';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sleepAbortable(ms: number, signal?: AbortSignal): Promise<boolean> {
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

export function createLaneStreamFn(
  models: Models,
  options: OpenLaneOptions,
): NonNullable<AgentOptions['streamFn']> {
  return (chosenModel, ctx, streamOpts) => {
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
}

export function renderLaneAuthoritySection(
  gate: ReturnType<typeof createLaneApprovalGate> | undefined,
  currentTools: readonly AgentTool<object, unknown>[],
  options: OpenLaneOptions,
): string {
  if (!gate) return '';
  return currentTools
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
    .join('\n');
}

export function settleLaneToolResult(input: {
  toolCall: { id: string; name: string };
  args: unknown;
  result: { content: ReadonlyArray<{ type: string; text?: string }>; details?: unknown };
  isError: boolean;
  options: OpenLaneOptions;
  gate: ReturnType<typeof createLaneApprovalGate> | undefined;
  directlyApplied: Set<string>;
  toolInput: ReturnType<typeof createLaneToolInputBoundary>;
}) {
  const { toolCall, args, result, isError, options, gate, directlyApplied, toolInput } = input;
  options.toolLifecycle?.settled({
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    args,
  });
  gate?.forget(toolCall.id);
  const appliedDirectly = directlyApplied.delete(toolCall.id);
  const body = result.content.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('');
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
}

export async function omitFailedAssistantAttempt(
  session: LaneSession,
  entryIdByMessage: WeakMap<object, string>,
  failed: AssistantMessage,
): Promise<void> {
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

export async function replayInterruptedToolCalls(input: {
  laneName: string;
  session: LaneSession;
  history: Awaited<ReturnType<typeof openLaneHistoryPage>>;
  interrupted: ReturnType<typeof interruptedToolCalls>;
  executableTools: () => AgentTool<object, unknown>[];
  runBeforeToolHook: (toolCallId: string, toolName: string, args: unknown) => Promise<{ block: true; reason?: string } | undefined>;
  flushDeferredNotes: () => Promise<void>;
  publish: () => void;
  driveOperation: (promptEntryIds: string[], fromTipId: string | null) => Promise<void>;
}): Promise<void> {
  const { laneName, session, history, interrupted, executableTools, runBeforeToolHook, flushDeferredNotes, publish, driveOperation } = input;
  const fromTipId = session.getTipId();
  try {
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
  } catch (error: unknown) {
    logWarn('agent', 'lane-resume-failed', { lane: laneName }, error);
  }
}
