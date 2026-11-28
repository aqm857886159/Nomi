import { openLaneHistoryPage } from './laneHistoryPage.mjs';
import { logError } from '../logging/logger.js';
import { registerLiveLaneTrace } from './laneTraceRecorder.mjs';
import { writeLaneTrace } from './laneTrace.mjs';
import type { OpenLaneOptions } from './laneRuntimePort.js';
import { findLaneReceiptAuthority } from './laneReceiptAuthority.mjs';
// Opening saved conversation history does not require a configured model or credentials.
// Reads use pi's SessionManager v3; execution still has exactly one owner, openLane.
import type { LaneSnapshot } from '../shared/agentLane/laneSnapshotTypes.js';
import type { LaneHandle } from '../shared/agentLane/laneContracts.js';
import { projectLaneSnapshot } from '../shared/agentLane/laneProjection.js';
import { isContextOverflow, isRetryableAssistantError } from '@earendil-works/pi-ai';
import { openLaneSession } from './laneSession.mjs';

export async function openLaneHistory(options: Pick<OpenLaneOptions, 'projectDir' | 'laneName' | 'tasks' | 'attachments'>): Promise<LaneHandle> {
  const opened = await openLaneSession(options);
  const laneName = options.laneName ?? 'main';
  let unregisterTrace: (() => void) | undefined;
  try {
    await writeLaneTrace(opened.session).catch(() => {
      logError('agent', 'derived-view-write-failed', new Error('Agent trace could not be written'));
    });
    const history = await openLaneHistoryPage(opened.session);
    // Runtime usage is separate from paged historical rows.
    const transcript = opened.session.activeTranscript();
    const stats = opened.session.getStats();
    const snapshot: LaneSnapshot = {
      lane: laneName,
      transcript,
      tipId: opened.session.getTipId(),
      stats,
      operation: null,
      queues: [],
      faulted: false,
      // No model is selected in this read-only view. These fields never reach a provider.
      configuration: { model: { provider: '', modelId: '' }, thinkingLevel: 'off', activeToolNames: [] },
    };
    const model = {
      pricing: 'unpriced' as const,
      supportedThinkingLevels: ['off' as const],
      isTransientError: isRetryableAssistantError,
      isContextOverflow: (message: Parameters<typeof isContextOverflow>[0]) => isContextOverflow(message),
    };
    let projection = {
      ...projectLaneSnapshot(snapshot, model, undefined, options.tasks, history.entries(), history.previousInputId(), options.attachments),
      history: history.state(),
    };
    const listeners = new Set<(next: typeof projection) => void>();
    const unavailable = () => { throw new Error('Model is not configured'); };
    let closing: Promise<void> | undefined;
    unregisterTrace = registerLiveLaneTrace(opened.session.metadata.path, () => writeLaneTrace(opened.session));
    return {
      laneName,
      sessionId: opened.sessionId,
      receiptAuthority: (proposalId) => findLaneReceiptAuthority(snapshot, proposalId),
      projection: () => projection,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      execute: async (command) => {
        if (command.kind === 'abort') return {};
        if (command.kind === 'history-older') {
          await history.older(command.before);
          projection = {
            ...projectLaneSnapshot(snapshot, model, undefined, options.tasks, history.entries(), history.previousInputId(), options.attachments),
            history: history.state(),
          };
          for (const listener of listeners) listener(projection);
          return {};
        }
        return unavailable();
      },
      appendTaskNote: async () => unavailable(),
      refreshTasks: () => {
        projection = {
          ...projectLaneSnapshot(snapshot, model, undefined, options.tasks, history.entries(), history.previousInputId(), options.attachments),
          history: history.state(),
        };
        for (const listener of listeners) listener(projection);
      },
      close: () => closing ??= (async () => {
        unregisterTrace?.();
        listeners.clear();
        await opened.release();
      })(),
    };
  } catch (error) {
    unregisterTrace?.();
    await opened.release();
    throw error;
  }
}
