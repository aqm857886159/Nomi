import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertAgentContextBinding, contextBindingKey } from './contextBinding';

describe('explicit Agent working-context binding', () => {
  it('hashes the untouched area session key and the separate thread as one stable pair', () => {
    const binding = { sessionKey: 'nomi:workbench:project-1:creation', threadId: 'thread-1' };
    const expected = createHash('sha256').update(JSON.stringify([binding.sessionKey, binding.threadId])).digest('hex');
    expect(contextBindingKey(binding)).toBe(expected);
    expect(binding.sessionKey).toBe('nomi:workbench:project-1:creation');
    expect(contextBindingKey({ ...binding, sessionKey: 'nomi:workbench:project-1:generation' })).not.toBe(expected);
    expect(contextBindingKey({ ...binding, threadId: 'thread-2' })).not.toBe(expected);
  });

  it.each([
    { sessionKey: 'nomi:workbench:project-1:creation' },
    { sessionKey: 'nomi:workbench:project-1:creation', threadId: '' },
    { sessionKey: 'nomi:workbench:project-1:creation', threadId: ' thread-1 ' },
    { sessionKey: 'nomi:workbench:project-1', threadId: 'thread-1' },
    { sessionKey: 'nomi:workbench:project-1:creation:thread-1', threadId: 'thread-1' },
    { sessionKey: ' nomi:workbench:project-1:creation ', threadId: 'thread-1' },
  ])('rejects an ambiguous or altered persistent binding: %j', (binding) => {
    expect(() => assertAgentContextBinding(binding)).toThrow(/binding/i);
  });

  it('accepts an explicit local-area binding without normalizing its key', () => {
    expect(() => assertAgentContextBinding({ sessionKey: 'nomi:workbench:local:generation', threadId: 'archive:one' })).not.toThrow();
  });
});
