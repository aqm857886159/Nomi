import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertAgentContextBinding, captureAgentContextBinding, contextBindingKey } from './contextBinding';
import { createProjectAgentContextBinding } from '../../shared/contracts/projectAgentContextBinding';

const PROJECT = Object.freeze({
  projectId: 'project-1',
  immutableProjectUuid: '4d80f2e0-4a45-4a8f-8fe1-78ac659177c8',
  projectGeneration: 3,
});

describe('explicit Agent working-context binding', () => {
  it('reuses the canonical Host thread identity instead of a second session-key vocabulary', () => {
    const binding = createProjectAgentContextBinding(PROJECT, 'thread-1');
    expect(binding.sessionKey).toBe('nomi:project-agent:4d80f2e0-4a45-4a8f-8fe1-78ac659177c8:g3');
    const expected = createHash('sha256')
      .update(JSON.stringify([binding.sessionKey, binding.threadId])).digest('hex');
    expect(contextBindingKey(binding)).toBe(expected);
    expect(contextBindingKey(createProjectAgentContextBinding(PROJECT, 'thread-2'))).not.toBe(expected);
    expect(contextBindingKey(createProjectAgentContextBinding({ ...PROJECT, projectGeneration: 4 }, 'thread-1')))
      .not.toBe(expected);
  });

  it('survives a project rename because identity is the immutable UUID, not the display id', () => {
    expect(contextBindingKey(createProjectAgentContextBinding({ ...PROJECT, projectId: 'renamed' }, 'thread-1')))
      .toBe(contextBindingKey(createProjectAgentContextBinding(PROJECT, 'thread-1')));
  });

  it.each([
    { sessionKey: 'nomi:workbench:project-1:creation', threadId: 'thread-1' },
    { project: PROJECT, threadId: 'thread-1', sessionKey: 'nomi:workbench:project-1:creation' },
    { project: PROJECT, threadId: '', sessionKey: 'nomi:project-agent:4d80f2e0-4a45-4a8f-8fe1-78ac659177c8:g3' },
    { project: PROJECT, threadId: ' thread-1 ', sessionKey: 'nomi:project-agent:4d80f2e0-4a45-4a8f-8fe1-78ac659177c8:g3' },
    { project: PROJECT, threadId: 'thread-1' },
  ])('rejects an ambiguous or altered persistent binding: %j', (binding) => {
    expect(() => assertAgentContextBinding(binding)).toThrow();
  });

  it('returns a frozen canonical copy rather than the caller-owned object', () => {
    const callerOwned = {
      ...createProjectAgentContextBinding(PROJECT, 'thread-1'),
      project: { ...PROJECT } as { projectId: string; immutableProjectUuid: string; projectGeneration: number },
    };
    const captured = captureAgentContextBinding(callerOwned);
    callerOwned.project.projectId = 'attacker-mutated';
    expect(captured.project.projectId).toBe('project-1');
    expect(Object.isFrozen(captured)).toBe(true);
  });
});
