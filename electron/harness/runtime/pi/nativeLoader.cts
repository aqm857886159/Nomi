import type { RunAgentTurn, RuntimeSnapshotCodec } from '../runtimePort.js';

/** Compiled CommonJS retains this native import; only actual Agent use loads pi. */
export const runAgentTurn: RunAgentTurn = async (request, hooks) =>
  (await import('./run.mjs')).runAgentTurn(request, hooks);

export const snapshotCodec: RuntimeSnapshotCodec = {
  importLegacy: async (turns, options) => (await import('./contextCodec.mjs')).importLegacyContext(turns, options),
  inspect: async (snapshot, options) => (await import('./contextCodec.mjs')).inspectContextSnapshot(snapshot, options),
};
