import type { ProjectAgentRuntimeContext } from '../shared/projectAgentContracts';
import { asRecord, assertAllowedKeys, assertSafeInteger } from './projectAgentStateValidationPrimitives';
import { ProjectAgentStateError } from './projectAgentStateError';

export function assertProjectAgentRuntimeContext(value: unknown): asserts value is ProjectAgentRuntimeContext {
  const context = asRecord(value);
  const keys = ['normalRequests', 'summaryRequests', 'compactions', 'retainedMessages'] as const;
  assertAllowedKeys(context, keys);
  for (const key of keys) { assertSafeInteger(context[key]); if ((context[key] as number) < 0) throw new ProjectAgentStateError('invalid_state'); }
}
