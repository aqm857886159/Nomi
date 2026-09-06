import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const paths = vi.hoisted(() => ({ deps: vi.fn(), project: vi.fn() }));
vi.mock('../../runtimePaths', () => ({ getWorkspaceRepositoryDeps: paths.deps }));
vi.mock('../../workspace/workspaceRepository', () => ({ resolveWorkspaceProjectDir: paths.project }));
import { resolveAgentContextFile } from './contextPaths';
import { createProjectAgentContextBinding } from '../../shared/contracts/projectAgentContextBinding';

const PROJECT = Object.freeze({
  projectId: 'project-1',
  immutableProjectUuid: '4d80f2e0-4a45-4a8f-8fe1-78ac659177c8',
  projectGeneration: 3,
});

describe('Agent persistent context path ownership', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-context-paths-'));
    paths.deps.mockReturnValue({ settingsRoot: path.join(root, 'settings'), defaultProjectsRoot: root });
    paths.project.mockReturnValue(path.join(root, 'project'));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

  it('never reuses the retired pre-Host context file name that project migration deletes', () => {
    expect(resolveAgentContextFile(createProjectAgentContextBinding(PROJECT, 'thread')))
      .not.toContain('agent-session.json');
  });

  it('keeps a thread context beside its own project, resolved from the canonical binding', () => {
    const binding = createProjectAgentContextBinding(PROJECT, 'not-a-path');
    expect(resolveAgentContextFile(binding)).toBe(path.join(root, 'project', '.nomi', 'agent-thread-context-v1.json'));
    expect(paths.project).toHaveBeenCalledWith('project-1', paths.deps.mock.results[0].value);
  });

  it('rejects an unresolved project rather than silently writing outside the workspace', () => {
    paths.project.mockReturnValue(null);
    expect(() => resolveAgentContextFile(createProjectAgentContextBinding(PROJECT, 'thread'))).toThrow(/resolv/i);
  });

  it('rejects a caller-supplied legacy area key instead of parsing a project out of it', () => {
    expect(() => resolveAgentContextFile(
      { sessionKey: 'nomi:workbench:project-1:generation', threadId: 'thread' } as never,
    )).toThrow();
    expect(paths.project).not.toHaveBeenCalled();
  });
});
