import { ipcMain, shell } from 'electron';
import { createRequire } from 'node:module';
import { assertTrustedSender } from '../ipcSenderGuard';
import { activeTaskProjectFallback } from '../tasks/activeProjectFallback';
import { getWorkspaceRepositoryDeps } from '../runtimePaths';
import { resolveWorkspaceProjectDir } from '../workspace/workspaceRepository';
import { parseLaneCommand } from '../agentLane/laneCommandCodec';
import type { AgentTraceOpenResult } from '../shared/contracts/agentTrace';

interface AgentTraceDependencies {
  activeProject(): string;
  projectDirectory(projectId: string): string | null;
  traceDirectory(projectDir: string, laneName?: string): Promise<string>;
  openPath(directory: string): Promise<string>;
}

const dependencies: AgentTraceDependencies = {
  activeProject: activeTaskProjectFallback,
  projectDirectory: (projectId) => resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps()),
  traceDirectory: async (projectDir, laneName) => {
    const native = createRequire(__filename)('../agentLane/laneNativeLoader.cjs') as {
      openLaneTraceDirectory(projectDir: string, laneName?: string): Promise<string>;
    };
    return native.openLaneTraceDirectory(projectDir, laneName);
  },
  openPath: (directory) => shell.openPath(directory),
};

export function registerAgentTraceIpc(deps: AgentTraceDependencies = dependencies): void {
  ipcMain.handle('nomi:diagnostics:open-agent-trace', async (event, laneName: unknown): Promise<AgentTraceOpenResult> => {
    assertTrustedSender(event);
    if (laneName !== undefined) {
      try { parseLaneCommand({ kind: 'lane-select', laneName }); }
      catch { return { ok: false, reason: 'invalid-lane' }; }
    }
    try {
      const projectId = deps.activeProject();
      if (!projectId) return { ok: false, reason: 'no-project' };
      const projectDir = deps.projectDirectory(projectId);
      if (!projectDir) return { ok: false, reason: 'no-project' };
      const directory = await deps.traceDirectory(projectDir, laneName as string | undefined);
      // A slow rebuild must not reveal the previous project's directory after a switch.
      if (deps.activeProject() !== projectId) return { ok: false, reason: 'project-changed' };
      assertTrustedSender(event);
      const error = await deps.openPath(directory);
      return error ? { ok: false, reason: 'open-failed' } : { ok: true };
    } catch {
      // Native errors can carry paths or provider text; only a bounded status crosses IPC.
      return { ok: false, reason: 'open-failed' };
    }
  });
}
