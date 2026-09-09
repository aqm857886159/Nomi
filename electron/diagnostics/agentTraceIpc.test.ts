import { beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), guard: vi.fn(), openPath: vi.fn(),
  activeProject: vi.fn(), projectDirectory: vi.fn(), nativeRequireBase: undefined as string | undefined }));
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle }, shell: { openPath: mocks.openPath } }));
vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  return { ...actual, createRequire: (filename: string) => actual.createRequire(mocks.nativeRequireBase ?? filename) };
});
vi.mock('../ipcSenderGuard', () => ({ assertTrustedSender: mocks.guard }));
vi.mock('../tasks/activeProjectFallback', () => ({ activeTaskProjectFallback: mocks.activeProject }));
vi.mock('../runtimePaths', () => ({ getWorkspaceRepositoryDeps: vi.fn() }));
vi.mock('../workspace/workspaceRepository', () => ({ resolveWorkspaceProjectDir: mocks.projectDirectory }));
import { registerAgentTraceIpc } from './agentTraceIpc';

function setup() {
  const deps = {
    activeProject: vi.fn(() => 'isolated-project'),
    projectDirectory: vi.fn((): string | null => '/isolated/project'),
    traceDirectory: vi.fn(async () => '/isolated/project/.nomi/agent-sessions/session.trace'),
    openPath: vi.fn(async () => ''),
  };
  registerAgentTraceIpc(deps);
  const invoke = mocks.handle.mock.calls[0][1] as (event: unknown, lane?: unknown) => Promise<unknown>;
  return { deps, invoke };
}

beforeEach(() => { vi.resetAllMocks(); mocks.nativeRequireBase = undefined; });

it('resolves the default native loader from the emitted diagnostics directory', async () => {
  await mkdir('.tmp', { recursive: true });
  const root = await mkdtemp(path.resolve('.tmp/trace-ipc-loader-'));
  try {
    await mkdir(path.join(root, 'diagnostics'));
    await mkdir(path.join(root, 'agentLane'));
    await writeFile(path.join(root, 'agentLane/laneNativeLoader.cjs'),
      'exports.openLaneTraceDirectory = async (projectDir, lane) => projectDir + "/" + lane + ".trace";');
    mocks.nativeRequireBase = path.join(root, 'diagnostics/agentTraceIpc.js');
    mocks.activeProject.mockReturnValue('isolated-project');
    mocks.projectDirectory.mockReturnValue('/isolated/project');
    mocks.openPath.mockResolvedValue('');
    registerAgentTraceIpc();
    expect(await mocks.handle.mock.calls[0][1]({}, 'main')).toEqual({ ok: true });
    expect(mocks.openPath).toHaveBeenCalledWith('/isolated/project/main.trace');
  } finally { mocks.nativeRequireBase = undefined; await rm(root, { recursive: true, force: true }); }
});

it('rejects untrusted senders before resolving any project or revealing files', async () => {
  const { deps, invoke } = setup();
  mocks.guard.mockImplementation(() => { throw new Error('untrusted'); });
  await expect(invoke({})).rejects.toThrow('untrusted');
  expect(deps.activeProject).not.toHaveBeenCalled();
  expect(deps.openPath).not.toHaveBeenCalled();
});

it.each(['../../private', '/tmp', '..', 'a\\b', '', 4, null, { path: '/tmp' }])('rejects invalid lane input %j without filesystem access', async (lane) => {
  const { deps, invoke } = setup();
  expect(await invoke({}, lane)).toEqual({ ok: false, reason: 'invalid-lane' });
  expect(deps.traceDirectory).not.toHaveBeenCalled();
  expect(deps.openPath).not.toHaveBeenCalled();
});

it('opens the native-derived current project directory, or the requested validated lane', async () => {
  const { deps, invoke } = setup();
  expect(await invoke({})).toEqual({ ok: true });
  expect(deps.projectDirectory).toHaveBeenCalledWith('isolated-project');
  expect(deps.traceDirectory).toHaveBeenLastCalledWith('/isolated/project', undefined);
  expect(await invoke({}, '新对话 2')).toEqual({ ok: true });
  expect(deps.traceDirectory).toHaveBeenLastCalledWith('/isolated/project', '新对话 2');
  expect(deps.openPath).toHaveBeenLastCalledWith('/isolated/project/.nomi/agent-sessions/session.trace');
});

it('returns no-project without touching native sessions', async () => {
  const { deps, invoke } = setup();
  deps.activeProject.mockReturnValue('');
  expect(await invoke({})).toEqual({ ok: false, reason: 'no-project' });
  expect(deps.traceDirectory).not.toHaveBeenCalled();
});

it('handles an active project identity that no longer resolves to a directory', async () => {
  const { deps, invoke } = setup();
  deps.projectDirectory.mockReturnValue(null);
  expect(await invoke({})).toEqual({ ok: false, reason: 'no-project' });
  expect(deps.traceDirectory).not.toHaveBeenCalled();
  expect(deps.openPath).not.toHaveBeenCalled();
});

it('does not reveal a stale project after an asynchronous rebuild', async () => {
  const { deps, invoke } = setup();
  deps.traceDirectory.mockImplementation(async () => {
    deps.activeProject.mockReturnValue('different-project');
    return '/isolated/project/.nomi/agent-sessions';
  });
  expect(await invoke({})).toEqual({ ok: false, reason: 'project-changed' });
  expect(deps.openPath).not.toHaveBeenCalled();
});

it('revalidates the sender before calling the operating system', async () => {
  const { deps, invoke } = setup();
  mocks.guard.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('navigated'); });
  expect(await invoke({})).toEqual({ ok: false, reason: 'open-failed' });
  expect(deps.openPath).not.toHaveBeenCalled();
});

it('returns bounded failures for shell errors and rejected native reads', async () => {
  const { deps, invoke } = setup();
  deps.openPath.mockResolvedValue('OS error with private path');
  expect(await invoke({})).toEqual({ ok: false, reason: 'open-failed' });
  deps.traceDirectory.mockRejectedValue(new Error('private provider information'));
  expect(await invoke({})).toEqual({ ok: false, reason: 'open-failed' });
  expect(deps.openPath).toHaveBeenCalledTimes(1);
});
