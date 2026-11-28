import { collectTraceRedactions, LANE_TRACE_REDACTIONS_NOTE } from './laneTraceRedaction.mjs';
import type { JsonValue } from '@earendil-works/pi-agent-core/harness/session';
import type { AgentHarness, Session } from '@earendil-works/pi-agent-core';
import type { JsonlSessionMetadata } from '@earendil-works/pi-agent-core/harness/session';
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';
import type { NomiPricingBasis } from '../shared/agentLane/laneModelConfig.js';
import { logError } from '../logging/logger.js';
import { clampAgentRetryCount, TELEMETRY_IDENTIFIER_PATTERN, type AgentFaultCategory, type TelemetryResult } from '../shared/contracts/telemetry.js';
import { laneAssistantFaultOf, laneOutputTruncatedOf, laneVendorFailureText } from '../shared/agentLane/laneAssistantFault.js';
import { parseVendorErrorFromMessage } from '../shared/generationFailureWire.js';
import { BALANCE_CLASSIFIER_MARKER } from './laneProviderGuard.mjs';
import type { LaneToolFailureEvent, LaneTurnCompletedEvent } from './laneRuntimePort.js';
import { LANE_RUN_FAILED, LANE_TRACE_NOTE, laneErrorKind, traceSafeValue, writeLaneTrace, type LaneTraceRun } from './laneTrace.mjs';

export type LaneTraceFailureSink = {
  bind(handler: (event: LaneToolFailureEvent) => void): void;
  wrap(next?: (event: LaneToolFailureEvent) => void): (event: LaneToolFailureEvent) => void;
};

export function createLaneTraceFailureSink(): LaneTraceFailureSink {
  let listener: ((event: LaneToolFailureEvent) => void) | undefined;
  return {
    bind: (handler) => { listener = handler; },
    wrap: (next) => (event) => { listener?.(event); next?.(event); },
  };
}

// Only transient timings live here; durable facts use pi's standard custom entry.
const liveViews = new Map<string, () => Promise<string>>();
export function registerLiveLaneTrace(sessionPath: string, refresh: () => Promise<string>): () => void {
  liveViews.set(sessionPath, refresh);
  return () => { if (liveViews.get(sessionPath) === refresh) liveViews.delete(sessionPath); };
}
export function refreshLiveLaneTrace(sessionPath: string): Promise<string> | undefined {
  return liveViews.get(sessionPath)?.();
}
export function attachLaneTrace(input: {
  harness: AgentHarness; session: Session<JsonlSessionMetadata>;
  pricing: NomiPricingBasis; secrets: readonly string[]; model: LaneTraceRun['model'];
  failureSink?: LaneTraceFailureSink;
  isTurnOver?: () => boolean;
  isContextOverflow?: (message: never) => boolean;
  onTurnCompleted?: (event: LaneTurnCompletedEvent) => void;
}) {
  const { harness, session, pricing, secrets, model } = input;
  const starts = new Map<string, number>();
  const tools = new Map<string, { started: number; runId: string; durationMs?: number; failureCode?: string }>();
  const pendingFailuresByTool = new Map<string, string[]>();
  type TurnTelemetryState = {
    startedAt: number;
    toolCallCount: number;
    retryCount: number;
    breakerTripped: boolean;
    lastAssistantFault: AgentFaultCategory | null;
    hadToolError: boolean;
  };
  const turnTelemetry = new Map<string, TurnTelemetryState>();
  let latestRunId = '';
  const ensureTurnState = (runId: string, startedAt = Date.now()): TurnTelemetryState => {
    latestRunId = runId;
    const existing = turnTelemetry.get(runId);
    if (existing) return existing;
    const created: TurnTelemetryState = { startedAt, toolCallCount: 0, retryCount: 0, breakerTripped: false, lastAssistantFault: null, hadToolError: false };
    turnTelemetry.set(runId, created);
    return created;
  };
  const noteToolFailure = (toolName: string, code: string, toolCallId?: string, breakerTripped = false): void => {
    if (breakerTripped && latestRunId) ensureTurnState(latestRunId).breakerTripped = true;
    if (!TELEMETRY_IDENTIFIER_PATTERN.test(code)) return;
    if (toolCallId) {
      const existing = tools.get(toolCallId);
      if (existing) existing.failureCode = code;
      else tools.set(toolCallId, { started: performance.now(), runId: '', failureCode: code });
      return;
    }
    const list = pendingFailuresByTool.get(toolName) ?? [];
    list.push(code);
    pendingFailuresByTool.set(toolName, list);
  };
  input.failureSink?.bind((event) => noteToolFailure(event.toolName, event.code, undefined, event.breakerTripped));
  let tail = Promise.resolve();
  const enqueue = (work: () => Promise<void>) => {
    tail = tail.then(work).catch(() => {
      logError('agent', 'derived-view-write-failed', new Error('Agent trace could not be written'));
    });
  };
  const appendNote = (customType: string, data: JsonValue) => session.mutate(async (mutator, context) => {
    await mutator.commit([{ kind: 'entry', entry: { id: session.idGenerator.next(), parentId: null,
      type: 'custom', customType, data } }], context);
  }, BACKGROUND_CONTEXT);
  const publish = async () => {
    const redactions = collectTraceRedactions(await session.findEntries({ order: 'asc' }, BACKGROUND_CONTEXT), secrets);
    if (redactions !== null) await appendNote(LANE_TRACE_REDACTIONS_NOTE, redactions);
    return writeLaneTrace(session, secrets);
  };
  const refresh = () => {
    const next = tail.then(publish);
    tail = next.then(() => undefined, () => {
      logError('agent', 'derived-view-write-failed', new Error('Agent trace could not be written'));
    });
    return next;
  };
  const unregister = registerLiveLaneTrace(session.metadata.path, refresh);
  const stops = [
    harness.hooks.on('before_request', event => {
      if (event.step === 'assistant' && event.attempt > 1) ensureTurnState(event.runId).retryCount += 1;
      return undefined;
    }),
    harness.events.on('run_start', event => {
      starts.set(event.runId, event.startedAt);
      ensureTurnState(event.runId, event.startedAt);
    }),
    harness.events.on('tool_start', event => {
      const existing = tools.get(event.toolCallId);
      tools.set(event.toolCallId, { started: performance.now(), runId: event.runId, ...(existing?.failureCode ? { failureCode: existing.failureCode } : {}) });
    }),
    harness.events.on('tool_end', event => {
      const turnState = ensureTurnState(event.runId);
      turnState.toolCallCount += 1;
      if (event.isError) {
        turnState.retryCount += 1;
        turnState.hadToolError = true;
      }
      const queued = event.isError ? pendingFailuresByTool.get(event.toolName)?.shift() : undefined;
      const tool = tools.get(event.toolCallId);
      if (tool) {
        if (!tool.runId) tool.runId = event.runId;
        tool.durationMs = Math.max(0, performance.now() - tool.started);
        if (queued && !tool.failureCode) tool.failureCode = queued;
      } else if (event.isError && queued) {
        tools.set(event.toolCallId, { started: performance.now(), runId: event.runId, failureCode: queued });
      }
    }),
    harness.events.on('message_end', event => {
      if (event.message.role !== 'assistant' || !event.runId) return;
      const fault = assistantFaultCategory(event.message, Boolean(input.isContextOverflow?.(event.message as never)));
      if (fault) ensureTurnState(event.runId).lastAssistantFault = fault;
    }),
    harness.events.on('run_end', event => {
      pendingFailuresByTool.clear();
      const turnState = turnTelemetry.get(event.runId);
      turnTelemetry.delete(event.runId);
      if (input.onTurnCompleted) {
        const durationMs = Math.max(0, event.endedAt - (turnState?.startedAt ?? event.endedAt));
        const breakerTripped = Boolean(turnState?.breakerTripped || input.isTurnOver?.());
        let result: TelemetryResult = 'success';
        let faultCategory: AgentFaultCategory | undefined;
        if (breakerTripped) {
          result = 'failure';
          faultCategory = 'tool_refused';
        } else if (event.status === 'aborted') {
          result = 'cancel';
        } else if (event.status === 'failed' || turnState?.lastAssistantFault) {
          result = 'failure';
          faultCategory = turnState?.lastAssistantFault ?? (turnState?.hadToolError ? 'tool_refused' : 'other');
        }
        input.onTurnCompleted({
          result,
          durationMs,
          toolCallCount: turnState?.toolCallCount ?? 0,
          retryCount: clampAgentRetryCount(turnState?.retryCount ?? 0),
          breakerTripped,
          ...(result === 'failure' && faultCategory ? { faultCategory } : {}),
        });
      }
      const observations = [...tools].filter(([, tool]) => tool.runId === event.runId);
      const note: LaneTraceRun = {
        runId: event.runId, fromTipId: event.fromTipId, tipId: event.tipId,
        startedAt: starts.get(event.runId) ?? null, endedAt: event.endedAt, status: event.status, pricing, model,
        // 这条记录写进 pi 会话（项目目录）：只记「失败了」，不记 pi 给的错误对象（可能带上游原话）。
        error: event.status === 'failed' ? LANE_RUN_FAILED : null,
        tools: observations.flatMap(([toolCallId, tool]) => (
          tool.durationMs === undefined && !tool.failureCode
            ? []
            : [{
                toolCallId,
                ...(tool.durationMs === undefined ? {} : { durationMs: tool.durationMs }),
                ...(tool.failureCode ? { failureCode: tool.failureCode } : {}),
              }]
        )),
      };
      starts.delete(event.runId);
      for (const [id] of observations) tools.delete(id);
      // Do not await a writing lane command inside pi's event delivery barrier.
      enqueue(async () => {
        await appendNote(LANE_TRACE_NOTE, traceSafeValue(note, secrets) as JsonValue);
        await publish();
      });
    }),
  ];
  return {
    noteToolFailure,
    refresh,
    flush: async () => { await tail; },
    close: async () => {
      for (const stop of stops) stop();
      unregister();
      await tail;
      await publish().catch(() => {
        logError('agent', 'derived-view-write-failed', new Error('Agent trace could not be written'));
      });
    },
  };
}

function assistantFaultCategory(
  message: { readonly errorMessage?: string; readonly stopReason?: string; readonly diagnostics?: readonly { readonly type?: unknown; readonly details?: unknown }[] },
  contextOverflow: boolean,
): AgentFaultCategory | null {
  if (laneOutputTruncatedOf(message)) return 'protocol_or_schema';
  if (contextOverflow) return 'context_overflow';
  const fault = laneAssistantFaultOf(message.errorMessage);
  if (fault) {
    if (fault.kind === 'model-timeout') return 'timeout';
    if (fault.kind === 'stream-cut') return 'stream_cut';
    if (fault.kind === 'context-overflow') return 'context_overflow';
    if (fault.kind === 'output-truncated') return 'protocol_or_schema';
  }
  const vendorText = laneVendorFailureText(message);
  if (vendorText) {
    const structured = parseVendorErrorFromMessage(vendorText);
    const status = typeof structured?.httpStatus === 'number' ? structured.httpStatus : 0;
    if (structured?.category === 'auth' || status === 401 || status === 403) return 'auth';
    if (structured?.category === 'balance' || structured?.category === 'quota' || status === 402 || status === 429) return 'quota';
    if (structured?.category === 'timeout' || status === 408 || status === 504) return 'timeout';
    if (structured?.category === 'input' || (status >= 400 && status < 500)) return 'protocol_or_schema';
    return 'upstream';
  }
  if (message.stopReason !== 'error' && !message.errorMessage) return null;
  const kind = laneErrorKind(message.errorMessage ?? '');
  if (kind === 'auth') return 'auth';
  if (kind === 'balance' || kind === 'rate-limit' || kind === BALANCE_CLASSIFIER_MARKER || kind === 'rate limit') return 'quota';
  if (kind === 'timeout' || kind.startsWith('model-timeout:')) return 'timeout';
  if (kind === 'stream-cut') return 'stream_cut';
  if (kind === 'context-overflow') return 'context_overflow';
  if (kind === 'protocol-error' || kind === 'output-truncated' || kind === 'upstream-4xx') return 'protocol_or_schema';
  if (kind === 'upstream-5xx' || kind === 'network' || kind === 'server error' || kind === 'network error') return 'upstream';
  return 'other';
}
