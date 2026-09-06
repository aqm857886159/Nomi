import path from 'node:path';
import { getWorkspaceRepositoryDeps } from '../../runtimePaths';
import { resolveWorkspaceProjectDir } from '../../workspace/workspaceRepository';
import { captureAgentContextBinding, type AgentContextBinding } from './contextBinding';

/**
 * Electron/main path policy stays out of the pure store and SDK codec. A thread's
 * durable context lives beside the project it belongs to, so moving or backing up
 * the project carries the conversation with it.
 *
 * The file name is NOT `agent-session.json`: that name belongs to the retired
 * pre-Host context, which `projectAgentMigration` archives and deletes on every
 * project open (and refuses to delete, failing project hydration, if it changed
 * since the archive). A live file must never share a retired path.
 */
export function resolveAgentContextFile(binding: AgentContextBinding): string {
  const canonical = captureAgentContextBinding(binding);
  const root = resolveWorkspaceProjectDir(canonical.project.projectId, getWorkspaceRepositoryDeps());
  if (!root || !path.isAbsolute(root)) throw new Error('Cannot resolve the persistent Agent context project');
  return path.join(root, '.nomi', 'agent-thread-context-v1.json');
}
