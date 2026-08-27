import { SessionManager } from '@earendil-works/pi-coding-agent';
import type { RuntimeSnapshotCodec } from '../runtimePort.js';
import { exportSnapshot, importSnapshot } from './snapshot.mjs';

export const importLegacyContext: RuntimeSnapshotCodec['importLegacy'] = async (turns, options) => {
  const manager = SessionManager.inMemory(options.cwd);
  if (turns.length) {
    // The required zeros are schema placeholders, not claims about historical
    // usage/time/provider. This non-message entry explicitly records that loss.
    manager.appendCustomEntry('nomi-legacy-import', { source: 'legacy-limited', provider: 'unknown',
      model: 'unknown', timestamps: 'unknown', usage: 'unknown', toolNotes: 'ui-text-only' });
  }
  for (const turn of turns) {
    if (turn.role === 'user') {
      manager.appendMessage({ role: 'user', content: turn.content, timestamp: 0 });
    } else {
      manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: turn.content }],
        api: 'nomi-legacy-import', provider: 'nomi-legacy-import', model: 'unknown',
        timestamp: 0, stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
          totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    }
  }
  return exportSnapshot({ sessionManager: manager, isIdle: true, isCompacting: false });
};

export const inspectContextSnapshot: RuntimeSnapshotCodec['inspect'] = async (serialized, options) => {
  const manager = await importSnapshot(serialized, options);
  return { retainedMessages: manager.buildSessionContext().messages.length };
};
