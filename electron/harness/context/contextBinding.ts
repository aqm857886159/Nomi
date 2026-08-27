import { createHash } from 'node:crypto';

export interface AgentContextBinding {
  readonly sessionKey: string;
  readonly threadId: string;
}

export type AgentContextScope =
  | { readonly kind: 'persistent'; readonly binding: AgentContextBinding }
  | { readonly kind: 'ephemeral' };

/** Validate identity, never repair it by trimming or appending a thread suffix. */
export function assertAgentContextBinding(binding: unknown): asserts binding is AgentContextBinding {
  const value = binding as Partial<AgentContextBinding> | null;
  if (!value || typeof value.sessionKey !== 'string'
    || !/^nomi:workbench:\S+:(?:creation|generation)$/.test(value.sessionKey)
    || typeof value.threadId !== 'string' || !value.threadId.trim()
    || value.threadId !== value.threadId.trim()) {
    throw new Error('Invalid Agent context binding: explicit area sessionKey and threadId are required');
  }
}

export function contextBindingKey(binding: AgentContextBinding): string {
  assertAgentContextBinding(binding);
  return createHash('sha256').update(JSON.stringify([binding.sessionKey, binding.threadId])).digest('hex');
}
