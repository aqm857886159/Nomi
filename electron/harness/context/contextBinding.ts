import { createHash } from 'node:crypto';
import {
  ProjectAgentContextBindingError,
  assertProjectAgentContextBinding,
} from '../../shared/contracts/projectAgentContextBinding';
import type { ProjectAgentContextBinding } from '../../shared/projectAgentContracts';

/**
 * One binding vocabulary for a Project Agent thread's durable context. The Host
 * already mints this identity for every turn (`ProjectAgentTurn.contextRef`), so
 * the harness reuses it instead of deriving a second `nomi:workbench:<area>` key
 * that would drift on project rename and split one thread across two records.
 */
export type AgentContextBinding = ProjectAgentContextBinding;

export type AgentContextScope =
  | { readonly kind: 'persistent'; readonly binding: AgentContextBinding }
  | { readonly kind: 'ephemeral' };

/** Validate identity, never repair it by trimming or appending a thread suffix. */
export function assertAgentContextBinding(binding: unknown): asserts binding is AgentContextBinding {
  assertProjectAgentContextBinding(binding);
}

/** The canonical copy the caller may keep; never the caller-owned object. */
export function captureAgentContextBinding(binding: unknown): AgentContextBinding {
  return assertProjectAgentContextBinding(binding);
}

export function contextBindingKey(binding: AgentContextBinding): string {
  const canonical = captureAgentContextBinding(binding);
  return createHash('sha256')
    .update(JSON.stringify([canonical.sessionKey, canonical.threadId]))
    .digest('hex');
}

export { ProjectAgentContextBindingError };
