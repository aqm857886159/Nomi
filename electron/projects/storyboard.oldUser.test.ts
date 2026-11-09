import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
const dirs = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: (name: string) => path.join(dirs.root, name), getAppPath: () => process.cwd(), getName: () => 'Nomi', getVersion: () => '0.24.1', on: () => undefined } }))
import { createProject, readProject, saveProject } from './repository'
import { openWorkspaceFolder } from '../workspace/workspaceIpc'
import { createWorkbenchProjectPersistenceService } from '../../src/workbench/project/projectPersistenceService'
import { useWorkbenchStore } from '../../src/workbench/workbenchStore'
const fixture = fileURLToPath(new URL('../../tests/fixtures/old-user-data/projects/v0.24.1-storyboard', import.meta.url))
function snapshot(folder: string): Record<string, { bytes: string; mtime: string }> {
  return Object.fromEntries(fs.readdirSync(folder, { recursive: true }).flatMap(name => {
    const relative = String(name), file = path.join(folder, relative)
    return fs.statSync(file).isFile() ? [[relative, { bytes: fs.readFileSync(file).toString('base64'), mtime: fs.statSync(file, { bigint: true }).mtimeNs.toString() }]] : []
  }))
}
it('opens a real v0.24.1 storyboard with every authored field and no project writes', async () => {
  dirs.root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-storyboard-upgrade-')))
  vi.stubEnv('NOMI_SETTINGS_DIR', path.join(dirs.root, 'settings'))
  vi.stubEnv('NOMI_PROJECTS_DIR', path.join(dirs.root, 'projects'))
  const folder = path.join(dirs.root, 'old-project')
  fs.cpSync(path.join(fixture, 'project'), folder, { recursive: true })
  const manifest = JSON.parse(fs.readFileSync(path.join(fixture, 'manifest.json'), 'utf8'))
  const originalRecord = JSON.parse(fs.readFileSync(path.join(folder, '.nomi/project.json'), 'utf8'))
  const before = snapshot(folder)
  const save = vi.fn(saveProject)
  const storage = new Map<string, string>()
  vi.stubGlobal('window', { nomiDesktop: { projects: { read: readProject, readAsync: async (id: string) => readProject(id), save } },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} })
  try {
    await openWorkspaceFolder({ rootPath: folder, initialize: false }, { createProject, selectedRootPaths: new Set([folder]), confirmInitialize: () => true, homedir: dirs.root })
    const service = createWorkbenchProjectPersistenceService({ setActiveProject: () => {}, isActiveProject: id => id === manifest.projectId })
    const opened = await service.hydrateProject(manifest.projectId, { signal: new AbortController().signal, assertCurrent: () => {} })
    expect(opened).not.toBeNull()
    expect(opened?.payload).toEqual(originalRecord.payload)
    expect(useWorkbenchStore.getState().workbenchDocuments).toEqual(originalRecord.payload.workbenchDocuments)
    const design = useWorkbenchStore.getState().storyboardDesignsByDocumentId[manifest.documentId].find(value => value.id === manifest.designId)
    expect(design?.plan).toEqual(manifest.expectedPlan)
    expect(design?.plan.shots.map(shot => shot.durationSec)).toEqual([5, 8])
    expect(save).not.toHaveBeenCalled()
    expect(snapshot(folder)).toEqual(before)
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    fs.rmSync(dirs.root, { recursive: true, force: true })
  }
})
