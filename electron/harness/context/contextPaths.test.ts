import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const paths = vi.hoisted(() => ({ settings: vi.fn(), deps: vi.fn(), project: vi.fn() }));
vi.mock('../../runtimePaths', () => ({ getSettingsRoot: paths.settings, getWorkspaceRepositoryDeps: paths.deps }));
vi.mock('../../workspace/workspaceRepository', () => ({ resolveWorkspaceProjectDir: paths.project }));
import * as eventLog from '../../events/eventLogRepository';
import { resolveAgentContextFile } from './contextPaths';

describe('Agent persistent context path ownership', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-context-paths-'));
    paths.settings.mockReturnValue(path.join(root, 'settings'));
    paths.deps.mockReturnValue({ settingsRoot: path.join(root, 'settings'), defaultProjectsRoot: root });
    paths.project.mockReturnValue(path.join(root, 'project'));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

  it('reuses the canonical project parser with the untouched area key and the workspace resolver', () => {
    const parser = vi.spyOn(eventLog, 'projectIdFromSessionKey');
    const binding = { sessionKey: 'nomi:workbench:project-1:generation', threadId: 'not-a-path' };
    expect(resolveAgentContextFile(binding)).toBe(path.join(root, 'project', '.nomi', 'agent-session.json'));
    expect(parser).toHaveBeenCalledWith(binding.sessionKey);
    expect(paths.project).toHaveBeenCalledWith('project-1', paths.deps.mock.results[0].value);
  });

  it('keeps the explicit local bucket in settings rather than resolving a fake workspace project', () => {
    expect(resolveAgentContextFile({ sessionKey: 'nomi:workbench:local:creation', threadId: 'local-thread' }))
      .toBe(path.join(root, 'settings', '.nomi', 'agent-session.json'));
    expect(paths.project).not.toHaveBeenCalled();
    expect(paths.deps).not.toHaveBeenCalled();
  });

  it('rejects an unresolved real project rather than silently switching to the local bucket', () => {
    paths.project.mockReturnValue(null);
    expect(() => resolveAgentContextFile({ sessionKey: 'nomi:workbench:missing:creation', threadId: 'thread' })).toThrow(/resolv/i);
    expect(paths.settings).not.toHaveBeenCalled();
  });
});
