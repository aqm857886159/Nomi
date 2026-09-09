import { logError } from '../logging/logger.js';
import { registerLiveLaneTrace } from './laneTraceRecorder.mjs';
import { writeLaneTrace } from './laneTrace.mjs';
import type { OpenLaneOptions } from './laneRuntimePort.js';
import { findLaneReceiptAuthority } from './laneReceiptAuthority.mjs';
// Opening saved conversation history does not require a configured model or credentials.
// Reads use pi's Session/Branch API; execution still has exactly one owner, openLane.
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';
import type { LaneSnapshot } from '@earendil-works/pi-agent-core';
import type { LaneHandle } from '../shared/agentLane/laneContracts.js';
import { projectLaneSnapshot } from '../shared/agentLane/laneProjection.js';
import { openLaneSession } from './laneSession.mjs';

export async function openLaneHistory(options: Pick<OpenLaneOptions, 'projectDir' | 'laneName' | 'tasks'>): Promise<LaneHandle> {
  const context = BACKGROUND_CONTEXT;
  const opened = await openLaneSession(options, context);
  const laneName = options.laneName ?? 'main';
  let unregisterTrace: (() => void) | undefined;
  try {
    await writeLaneTrace(opened.session).catch(() => {
      logError('agent', 'derived-view-write-failed', new Error('Agent trace could not be written'));
    });
    const branch = await opened.session.branch(laneName, context);
    const transcript = branch ? await branch.findEntries({ order: 'oldestFirst' }, context) : [];
    const stats = await opened.session.getStats(context);
    const snapshot: LaneSnapshot = {
      lane: laneName, transcript, tipId: branch ? await branch.getTipId(context) : null,
      stats, operation: null, queues: [], faulted: false,
      // No model is selected in this read-only view. These fields never reach a provider.
      configuration: { model: { provider: '', modelId: '' }, thinkingLevel: 'off', activeToolNames: [] },
    };
    const model = { pricing: 'unpriced' as const, supportedThinkingLevels: ['off' as const] };
    let projection = projectLaneSnapshot(snapshot, model, undefined, options.tasks);
    const listeners = new Set<(next: typeof projection) => void>();
    const unavailable = () => { throw new Error('Model is not configured'); };
    let closing: Promise<void> | undefined;
    unregisterTrace = registerLiveLaneTrace(opened.session.metadata.path, () => writeLaneTrace(opened.session));
    return {
      laneName, sessionId: opened.sessionId,
      receiptAuthority: (proposalId) => findLaneReceiptAuthority(snapshot, proposalId),
      projection: () => projection,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      execute: async (command) => { if (command.kind === 'abort') return {}; return unavailable(); },
      appendTaskNote: async () => unavailable(),
      refreshTasks: () => {
        projection = projectLaneSnapshot(snapshot, model, undefined, options.tasks);
        for (const listener of listeners) listener(projection);
      },
      close: () => closing ??= (async () => {
        unregisterTrace?.();
        listeners.clear();
        try { await opened.session.close(context); }
        finally { await opened.release(context); }
      })(),
    };
  } catch (error) {
    unregisterTrace?.();
    try { await opened.session.close(context); }
    finally { await opened.release(context); }
    throw error;
  }
}
