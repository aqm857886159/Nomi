import { collectTraceRedactions, LANE_TRACE_REDACTIONS_NOTE } from './laneTraceRedaction.mjs';
import type { JsonValue } from '@earendil-works/pi-agent-core/harness/session';
import type { AgentHarness, Session } from '@earendil-works/pi-agent-core';
import type { JsonlSessionMetadata } from '@earendil-works/pi-agent-core/harness/session';
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';
import type { NomiPricingBasis } from '../shared/agentLane/laneModelConfig.js';
import { logError } from '../logging/logger.js';
import { LANE_TRACE_NOTE, traceSafeValue, writeLaneTrace, type LaneTraceRun } from './laneTrace.mjs';

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
}) {
  const { harness, session, pricing, secrets, model } = input;
  const starts = new Map<string, number>();
  const tools = new Map<string, { started: number; runId: string; durationMs?: number }>();
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
    harness.events.on('run_start', event => { starts.set(event.runId, event.startedAt); }),
    harness.events.on('tool_start', event => { tools.set(event.toolCallId, { started: performance.now(), runId: event.runId }); }),
    harness.events.on('tool_end', event => {
      const tool = tools.get(event.toolCallId);
      if (tool) tool.durationMs = Math.max(0, performance.now() - tool.started);
    }),
    harness.events.on('run_end', event => {
      const observations = [...tools].filter(([, tool]) => tool.runId === event.runId);
      const note: LaneTraceRun = {
        runId: event.runId, fromTipId: event.fromTipId, tipId: event.tipId,
        startedAt: starts.get(event.runId) ?? null, endedAt: event.endedAt, status: event.status, pricing, model,
        error: event.status === 'failed' ? JSON.stringify(event.error) : null,
        tools: observations.flatMap(([toolCallId, tool]) => tool.durationMs === undefined ? [] : [{ toolCallId, durationMs: tool.durationMs }]),
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
