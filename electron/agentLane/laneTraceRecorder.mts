import { collectTraceRedactions, LANE_TRACE_REDACTIONS_NOTE } from './laneTraceRedaction.mjs';
import type { JsonValue } from '@earendil-works/pi-ai';
import type { LaneSession } from './laneSession.mjs';
import type { NomiPricingBasis } from '../shared/agentLane/laneModelConfig.js';
import { logError } from '../logging/logger.js';
import { LANE_RUN_FAILED, LANE_TRACE_NOTE, traceSafeValue, writeLaneTrace, type LaneTraceRun } from './laneTrace.mjs';

export interface LaneTraceRunStartEvent {
  readonly runId: string;
  readonly startedAt: number;
}

export interface LaneTraceToolStartEvent {
  readonly runId: string;
  readonly toolCallId: string;
}

export interface LaneTraceToolEndEvent {
  readonly toolCallId: string;
}

export interface LaneTraceRunEndEvent {
  readonly runId: string;
  readonly fromTipId: string | null;
  readonly tipId: string | null;
  readonly endedAt: number;
  readonly status: LaneTraceRun['status'];
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
  session: LaneSession;
  pricing: NomiPricingBasis;
  secrets: readonly string[];
  model: LaneTraceRun['model'];
}) {
  const { session, pricing, secrets, model } = input;
  const starts = new Map<string, number>();
  const tools = new Map<string, { started: number; runId: string; durationMs?: number }>();
  let closed = false;
  let tail = Promise.resolve();
  const enqueue = (work: () => Promise<void>) => {
    tail = tail.then(work).catch(() => {
      logError('agent', 'derived-view-write-failed', new Error('Agent trace could not be written'));
    });
  };
  const appendDetached = (customType: string, data?: JsonValue) =>
    session.appendDetachedCustomEntry
      ? session.appendDetachedCustomEntry(customType, data)
      : session.appendCustomEntry(customType, data);
  const publish = async () => {
    const redactions = collectTraceRedactions(session.entries(), secrets);
    if (redactions !== null) await appendDetached(LANE_TRACE_REDACTIONS_NOTE, redactions);
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
  return {
    onRunStart: (event: LaneTraceRunStartEvent) => {
      if (closed) return;
      starts.set(event.runId, event.startedAt);
    },
    onToolStart: (event: LaneTraceToolStartEvent) => {
      if (closed) return;
      tools.set(event.toolCallId, { started: performance.now(), runId: event.runId });
    },
    onToolEnd: (event: LaneTraceToolEndEvent) => {
      if (closed) return;
      const tool = tools.get(event.toolCallId);
      if (tool) tool.durationMs = Math.max(0, performance.now() - tool.started);
    },
    onRunEnd: (event: LaneTraceRunEndEvent) => {
      if (closed) return;
      const observations = [...tools].filter(([, tool]) => tool.runId === event.runId);
      const note: LaneTraceRun = {
        runId: event.runId,
        fromTipId: event.fromTipId,
        tipId: event.tipId,
        startedAt: starts.get(event.runId) ?? null,
        endedAt: event.endedAt,
        status: event.status,
        pricing,
        model,
        error: event.status === 'failed' ? LANE_RUN_FAILED : null,
        tools: observations.flatMap(([toolCallId, tool]) =>
          tool.durationMs === undefined ? [] : [{ toolCallId, durationMs: tool.durationMs }]),
      };
      starts.delete(event.runId);
      for (const [id] of observations) tools.delete(id);
      enqueue(async () => {
        if (closed) return;
        await appendDetached(LANE_TRACE_NOTE, traceSafeValue(note, secrets) as JsonValue);
        await publish();
      });
    },
    refresh,
    flush: async () => { await tail; },
    close: async () => {
      closed = true;
      unregister();
      await tail;
      await publish();
    },
  };
}
