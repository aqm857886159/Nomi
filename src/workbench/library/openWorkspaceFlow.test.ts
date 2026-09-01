import { describe, expect, it, vi } from 'vitest'
import { openWorkspaceFromLibrary, openWorkspaceProjectFromPicker } from './openWorkspaceFlow'
import type { DesktopBridge } from '../../desktop/bridge'

function desktopBridge(overrides: Partial<DesktopBridge['workspace']>): DesktopBridge {
  return {
    platform: 'darwin',
    workspace: {
      selectFolder: vi.fn(async () => ({ canceled: true as const })),
      openFolder: vi.fn(async () => ({ id: 'project-id' })),
      listFiles: vi.fn(async () => ({ files: [] })) as never,
      revealFile: vi.fn(async () => ({ ok: true })),
      revealProjectFolder: vi.fn(async () => ({ ok: true })),
      ...overrides,
    },
    projects: {} as DesktopBridge['projects'],
    assets: {} as DesktopBridge['assets'],
    exports: {} as DesktopBridge['exports'],
    tasks: {} as DesktopBridge['tasks'],
    modelCatalog: {} as DesktopBridge['modelCatalog'],
  } as unknown as DesktopBridge
}

describe('openWorkspaceFromLibrary', () => {
  it('does nothing when folder selection is canceled', async () => {
    const bridge = desktopBridge({ selectFolder: vi.fn(async () => ({ canceled: true as const })) })
    const hydrateProject = vi.fn()

    await openWorkspaceFromLibrary({ bridge, hydrateProject, confirmInitialize: vi.fn(), refreshProjects: vi.fn(), showMessage: vi.fn() })

    expect(bridge.workspace.openFolder).not.toHaveBeenCalled()
    expect(hydrateProject).not.toHaveBeenCalled()
  })

  it('opens existing workspace without reinitializing', async () => {
    const bridge = desktopBridge({
      selectFolder: vi.fn(async () => ({ canceled: false, rootPath: '/tmp/existing' })),
      openFolder: vi.fn(async () => ({ id: 'existing-id' })),
    })
    const hydrateProject = vi.fn(async () => true)
    const refreshProjects = vi.fn()

    await openWorkspaceFromLibrary({ bridge, hydrateProject, confirmInitialize: vi.fn(), refreshProjects, showMessage: vi.fn() })

    expect(bridge.workspace.openFolder).toHaveBeenCalledWith({ rootPath: '/tmp/existing', initialize: false })
    expect(refreshProjects).toHaveBeenCalled()
    expect(hydrateProject).toHaveBeenCalledWith('existing-id')
  })

  it('initializes selected folder when user confirms', async () => {
    const bridge = desktopBridge({
      selectFolder: vi.fn(async () => ({ canceled: false, rootPath: '/tmp/new-folder' })),
      openFolder: vi
        .fn()
        .mockRejectedValueOnce(new Error('Workspace folder is not initialized'))
        .mockResolvedValueOnce({ id: 'new-id' }),
    })
    const hydrateProject = vi.fn(async () => true)
    const confirmInitialize = vi.fn(async () => true)

    await openWorkspaceFromLibrary({ bridge, hydrateProject, confirmInitialize, refreshProjects: vi.fn(), showMessage: vi.fn() })

    expect(confirmInitialize).toHaveBeenCalledWith('/tmp/new-folder')
    expect(bridge.workspace.openFolder).toHaveBeenLastCalledWith({ rootPath: '/tmp/new-folder', initialize: true })
    expect(hydrateProject).toHaveBeenCalledWith('new-id')
  })

  it('surfaces permission errors as user-facing messages', async () => {
    const bridge = desktopBridge({
      selectFolder: vi.fn(async () => ({ canceled: false, rootPath: '/tmp/blocked' })),
      openFolder: vi.fn(async () => { throw new Error('EACCES: permission denied') }),
    })
    const showMessage = vi.fn()

    await openWorkspaceFromLibrary({ bridge, hydrateProject: vi.fn(), confirmInitialize: vi.fn(), refreshProjects: vi.fn(), showMessage })

    expect(showMessage).toHaveBeenCalledWith('EACCES: permission denied', 'error')
  })

  it('passes a suggested project name when initializing from Try Now style flows', async () => {
    const bridge = desktopBridge({
      selectFolder: vi.fn(async () => ({ canceled: false, rootPath: '/tmp/try-now' })),
      openFolder: vi
        .fn()
        .mockRejectedValueOnce(new Error('Workspace folder is not initialized'))
        .mockResolvedValueOnce({ id: 'try-now-id' }),
    })

    const projectId = await openWorkspaceProjectFromPicker({
      bridge,
      name: 'Example Story',
      confirmInitialize: vi.fn(async () => true),
      showMessage: vi.fn(),
    })

    expect(projectId).toBe('try-now-id')
    expect(bridge.workspace.openFolder).toHaveBeenNthCalledWith(1, { rootPath: '/tmp/try-now', initialize: false, name: 'Example Story' })
    expect(bridge.workspace.openFolder).toHaveBeenNthCalledWith(2, { rootPath: '/tmp/try-now', initialize: true, name: 'Example Story' })
  })
})
