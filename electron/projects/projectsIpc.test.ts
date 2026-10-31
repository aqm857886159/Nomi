import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ handle: vi.fn(), guard: vi.fn(), log: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }))
vi.mock('../ipcSenderGuard', () => ({ assertTrustedSender: mocks.guard }))
vi.mock('../assets/scratchCleanup', () => ({ sweepAbandonedUploadStaging: vi.fn() }))
vi.mock('./repository', () => ({ projectDirById: vi.fn() }))
vi.mock('./projectCanvasWrite', () => ({ applyCanvasNodePatch: vi.fn() }))
vi.mock('../logging/logger', () => ({ logError: mocks.log }))
import { registerProjectsIpc } from './projectsIpc'
import { WORKSPACE_MANIFEST_BUSY_ERROR_NAME } from '../shared/contracts/workspaceBusy'

beforeEach(() => vi.clearAllMocks())
function handler(saveProject: () => unknown) {
  registerProjectsIpc({ registerSyncIpc: vi.fn(), listProjects: vi.fn(), createProject: vi.fn(), readProject: vi.fn(), saveProject, deleteProject: vi.fn(), diagnoseProject: vi.fn(), recoverProject: vi.fn() })
  return mocks.handle.mock.calls.find(([channel]) => channel === 'nomi:projects:save-async')![1]
}
const MATRIX = [
  ['EBUSY', Object.assign(new Error('private /Users/private/project'), { code: 'EBUSY', errno: -16, syscall: 'rename', path: '/Users/private/project' })],
  ['EPERM', Object.assign(new Error('private path'), { code: 'EPERM', errno: -1, syscall: 'open' })],
  ['ENOSPC', Object.assign(new Error('private path'), { code: 'ENOSPC', errno: -28, syscall: 'write' })],
  ['workspace-busy', Object.assign(new Error('private lock path'), { name: WORKSPACE_MANIFEST_BUSY_ERROR_NAME })],
  ['binding-stale', new Error('project_binding_stale')],
] as const
describe('save handler envelopes retain only closed structural facts', () => {
  it.each(MATRIX)('%s returns typed failure instead of throwing', async (code, error) => {
    const save = vi.fn(async () => { throw error })
    const result = await handler(save)({}, 'project', {})
    const kind = { EBUSY: 'in-use', EPERM: 'write-denied', ENOSPC: 'disk-full', 'workspace-busy': 'workspace-busy', 'binding-stale': 'binding-stale' }[code]
    expect(result).toEqual({ ok: false, error: 'project-save-failed', reason: {
      kind, code: code.startsWith('E') ? code : null, errno: 'errno' in error ? error.errno : null,
      syscall: 'syscall' in error ? error.syscall : null, stage: 'save-project',
    } })
    expect(mocks.guard).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toContain('private')
    expect(mocks.log).toHaveBeenCalledWith('workspace', 'project-save-rejected', undefined, expect.objectContaining({ channel: 'nomi:projects:save-async', reason: kind }))
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('private')
  })
  it.each(['EACCES', 'ENOENT'])('also preserves %s with the same errno reason table', async code => {
    const result = await handler(() => { throw Object.assign(new Error('private'), { code, errno: -13, syscall: 'open' }) })({}, 'project', {})
    expect(result.reason).toMatchObject({ code, kind: code === 'EACCES' ? 'write-denied' : 'not-found' })
  })
  it('awaits the save receipt before reporting success', async () => {
    let finish!: (value: unknown) => void
    const result = handler(() => new Promise(resolve => { finish = resolve }))({}, 'project', {})
    finish({ id: 'project', revision: 2 })
    await expect(result).resolves.toEqual({ ok: true, value: { id: 'project', revision: 2 } })
  })
  it('denies an untrusted caller without running the save, still returning an envelope', async () => {
    mocks.guard.mockImplementationOnce(() => { throw new Error('private sender URL') })
    const save = vi.fn()
    const result = await handler(save)({}, 'project', {})
    expect(result.reason).toMatchObject({ kind: 'unknown', stage: 'authorize' })
    expect(save).not.toHaveBeenCalled()
  })
  it('unknown error facts cannot expose paths through code, syscall, or message', async () => {
    const result = await handler(() => { throw { code: '/private/key', errno: Infinity, syscall: '/private/syscall', message: '/private/error' } })({}, 'project', {})
    expect(result.reason).toEqual({ kind: 'unknown', stage: 'save-project', code: null, errno: null, syscall: null })
  })
})
