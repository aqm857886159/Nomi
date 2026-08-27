import path from 'node:path';
import { projectIdFromSessionKey } from '../../events/eventLogRepository';
import { getSettingsRoot, getWorkspaceRepositoryDeps } from '../../runtimePaths';
import { resolveWorkspaceProjectDir } from '../../workspace/workspaceRepository';
import { assertAgentContextBinding, type AgentContextBinding } from './contextBinding';

/** Electron/main path policy stays out of the pure store and SDK codec. */
export function resolveAgentContextFile(binding: AgentContextBinding): string {
  assertAgentContextBinding(binding);
  const projectId = projectIdFromSessionKey(binding.sessionKey);
  const isLocal = binding.sessionKey === 'nomi:workbench:local:creation'
    || binding.sessionKey === 'nomi:workbench:local:generation';
  const root = isLocal ? getSettingsRoot()
    : projectId ? resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps()) : null;
  if (!root || !path.isAbsolute(root)) throw new Error('Cannot resolve the persistent Agent context project');
  return path.join(root, '.nomi', 'agent-session.json');
}
