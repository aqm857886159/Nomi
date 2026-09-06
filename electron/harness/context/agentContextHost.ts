import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { appFetch } from '../../appFetch';
import { createAgentContextService } from './contextService';
import { createAgentContextStore } from './contextStore';
import { resolveAgentContextFile } from './contextPaths';
import type { RunAgentTurn, RuntimeSnapshotCodec } from '../runtime/runtimePort';
import { logWarn } from '../../logging/logger';

type NativePort = { runAgentTurn: RunAgentTurn; snapshotCodec: RuntimeSnapshotCodec };
// A runtime require keeps the native .cts/.mts island out of the CommonJS tsc graph.
const native = (): NativePort => createRequire(__filename)('../runtime/pi/nativeLoader.cjs') as NativePort;

/** One host instance: never replace the binding queues between calls. No eager SDK load. */
export const agentContextHost = createAgentContextService({
  store: createAgentContextStore({ resolveFile: resolveAgentContextFile }),
  runAgentTurn: (request, hooks) => native().runAgentTurn(request, { ...hooks, fetch: appFetch }),
  codec: {
    importLegacy: (turns, options) => native().snapshotCodec.importLegacy(turns, options),
    inspect: (snapshot, options) => native().snapshotCodec.inspect(snapshot, options),
  },
});

export interface AgentRuntimePaths { cwd: string; agentDir: string; tempRoot: string }

/** These are controlled scratch directories, never the renderer's cwd or project URL. */
export async function withAgentRuntimePaths<T>(work: (paths: AgentRuntimePaths) => Promise<T>): Promise<T> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nomi-agent-turn-'));
  const paths = { cwd: path.join(root, 'work'), agentDir: path.join(root, 'agent'), tempRoot: root };
  try {
    mkdirSync(paths.cwd);
    mkdirSync(paths.agentDir);
    return await work(paths);
  } finally {
    // Only this exact mkdtemp-owned root is removed. A cleanup failure must not erase actual usage.
    try { rmSync(root, { recursive: true, force: true }); }
    catch (error) { logWarn('agent', 'scratch-cleanup-failed', undefined, error); }
  }
}
