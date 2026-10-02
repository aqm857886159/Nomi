import type { ArchetypeMode } from './types';

export type SourceTaskResult = {
  taskId?: string;
  provider?: string;
  modelKey?: string;
  params?: Record<string, unknown>;
};
type SourceIssue = 'missing' | 'multiple' | 'unknown' | 'provider' | 'model' | 'parameter' | 'conflict';
type Resolution = { taskId: string } | { error: SourceIssue; values: Record<string, string> };
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/** Shared source contract, with no uploads, provider calls or inferred historical results. */
export function resolveSourceTaskInput(
  requirement: NonNullable<ArchetypeMode['sourceTask']>,
  input: { explicitId?: unknown; provider: string; sources: SourceTaskResult[] },
): Resolution {
  const explicit = text(input.explicitId);
  const fail = (error: SourceIssue, values: Record<string, string> = {}): Resolution => ({ error, values });
  if (input.sources.length > 1) return fail('multiple');
  const source = input.sources[0];
  if (!source) return explicit ? { taskId: explicit } : fail('missing');
  if (!source.taskId || !source.provider || !source.modelKey || !source.params) return fail('unknown');
  if (source.provider !== input.provider) return fail('provider');
  if (source.modelKey !== requirement.modelKey) return fail('model', { model: requirement.modelKey });
  for (const [key, expected] of Object.entries(requirement.params)) {
    const actual = text(source.params[key]);
    if (!actual) return fail('unknown');
    if (actual !== expected) return fail('parameter', { key, actual, expected });
  }
  if (explicit && explicit !== source.taskId) return fail('conflict');
  return { taskId: source.taskId };
}
