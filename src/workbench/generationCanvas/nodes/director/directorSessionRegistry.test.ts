import { describe, expect, it } from 'vitest'
import { createDirectorStore } from './model/directorStore'
import { createDefaultProject } from './model/directorProject'
import { hasDirectorSession, registerDirectorSession, writeExternalDirectorProject } from './directorSessionRegistry'

describe('director session registry', () => {
  it('routes an external write into the mounted store and removes it on unmount', () => {
    const store = createDirectorStore({ defaultSceneName: 'Scene 1' })
    const persisted: { project: ReturnType<typeof store.getState>['project'] | null } = { project: null }
    const unregister = registerDirectorSession('node-1', {
      store,
      defaultSceneName: 'Scene 1',
      onExternalProjectChange: project => { persisted.project = project },
    })
    const project = createDefaultProject('Scene 1')
    project.scenes[0].name = 'AI revision'
    project.scenes[0].cameras = [
      { id: 'camera-1', name: 'Wide', position: { x: 0, y: 1, z: 4 }, yaw: 0, pitch: 0, roll: 0, fov: 45, focalLengthMm: 29 },
      { id: 'camera-2', name: 'Medium', position: { x: 0, y: 1, z: 3 }, yaw: 0, pitch: 0, roll: 0, fov: 45, focalLengthMm: 29 },
      { id: 'camera-3', name: 'Close', position: { x: 0, y: 1, z: 2 }, yaw: 0, pitch: 0, roll: 0, fov: 45, focalLengthMm: 29 },
    ]
    expect(writeExternalDirectorProject('node-1', project)).toBe(true)
    expect(store.getState().project.scenes[0].name).toBe('AI revision')
    if (!persisted.project) throw new Error('external write was not persisted')
    expect(persisted.project.scenes[0].cameras).toHaveLength(3)
    const reloaded = createDirectorStore({ rawProject: persisted.project, defaultSceneName: 'Scene 1' })
    expect(reloaded.getState().project.scenes[0].cameras).toHaveLength(3)
    expect(hasDirectorSession('node-1')).toBe(true)
    unregister()
    expect(hasDirectorSession('node-1')).toBe(false)
    expect(writeExternalDirectorProject('node-1', project)).toBe(false)
  })
})
