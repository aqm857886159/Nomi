import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { JsonValue } from '@earendil-works/pi-ai';
import type { LaneSnapshot } from '../shared/agentLane/laneSnapshotTypes.js';
import { openLaneSession } from './laneSession.mjs';

/** No provider, credentials, tools, native environment or execution API escapes. */
export async function openLegacyImportLane(projectDir: string, laneName: string, sessionId: string) {
  const opened = await openLaneSession({ projectDir, laneName, createSessionId: sessionId });
  let closing: Promise<void> | undefined;
  return {
    appendMessage: (message: AgentMessage) => opened.session.appendMessage(message),
    appendCustomEntry: (customType: string, data?: JsonValue) => opened.session.appendCustomEntry(customType, data),
    entries: async () => opened.session.branchEntries(),
    snapshot: async (): Promise<LaneSnapshot> => ({
      lane: laneName,
      transcript: opened.session.activeTranscript(),
      tipId: opened.session.getTipId(),
      configuration: {
        model: { provider: 'nomi-unconfigured', modelId: 'legacy-import' },
        thinkingLevel: 'off',
        activeToolNames: [],
      },
      stats: opened.session.getStats(),
      operation: null,
      queues: [],
      faulted: false,
    }),
    close: () => closing ??= opened.release(),
  };
}
