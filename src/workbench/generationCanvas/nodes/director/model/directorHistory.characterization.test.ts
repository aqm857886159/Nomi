import { describe, expect, it } from 'vitest'
import { buildCameraFromPreset, CAMERA_PRESETS } from './cameraPresets'
import { createDirectorStore } from './directorStore'

function editor(now?: () => number) {
  return createDirectorStore({ defaultSceneName: '#1', now }).getState()
}

describe('Director editing history', () => {
  it('keeps the newest 50 of 51 edits, replays each, and branches from undo', () => {
    const api = editor()
    const rename = (name: string) => api.renameSceneLayer(api.activeScene().id, name)
    for (let i = 2; i <= 52; i++) rename(`#${i}`)
    for (let i = 51; i >= 2; i--) {
      api.undo()
      expect(api.activeScene().name).toBe(`#${i}`)
    }
    api.undo()
    expect(api.activeScene().name).toBe('#2')
    for (let i = 3; i <= 52; i++) {
      api.redo()
      expect(api.activeScene().name).toBe(`#${i}`)
    }
    api.undo()
    rename('branch')
    api.redo()
    expect(api.activeScene().name).toBe('branch')
    api.undo()
    expect(api.activeScene().name).toBe('#51')
  })

  it('undoes each complete camera and object gizmo drag', () => {
    const api = editor()
    const camera = api.addCamera(buildCameraFromPreset({ preset: CAMERA_PRESETS[0], id: 'camera', name: 'POV' }))
    const object = api.addObject({ name: 'Box', type: 'cube', position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, locked: false })
    const before = api.exportProject()
    api.saveState()
    for (const x of [2, 4, 6]) api.writeCameraSpatialTransform(camera, { position: { x, y: 1, z: 5 } })
    const afterCamera = api.exportProject()
    expect(api.findCamera(camera)?.position.x).toBe(6)
    api.saveState()
    for (const x of [1, 3, 5]) api.writeObjectSpatialTransform(object, { position: { x, y: 0, z: 0 } })
    expect(api.findObject(object)?.position.x).toBe(5)
    api.undo()
    expect(api.exportProject()).toEqual(afterCamera)
    api.undo()
    expect(api.exportProject()).toEqual(before)
  })

  it('starts another step when the field changes during a named gesture', () => {
    const api = editor()
    const before = api.exportProject()
    api.saveState()
    for (const gridHeight of [2, 3, 4]) api.patchSceneConfig({ gridHeight })
    const afterHeight = api.exportProject()
    api.patchSceneConfig({ gridVisible: !api.activeScene().sceneConfig.gridVisible })
    api.undo()
    expect(api.exportProject()).toEqual(afterHeight)
    api.undo()
    expect(api.exportProject()).toEqual(before)
  })

  it('commits the outer transaction once and rolls nested failures back with redo intact', () => {
    const api = editor()
    const before = api.exportProject()
    api.withHistory(() => {
      api.createSceneLayer('Second')
      api.withHistory(() => api.addLight('point', 'Key'))
    })
    const after = api.exportProject()
    api.undo()
    expect(api.exportProject()).toEqual(before)
    expect(() => api.withHistory(() => {
      api.createSceneLayer('Abandoned')
      api.withHistory(() => {
        api.addLight('point', 'Temporary')
        throw new Error('cancel')
      })
    })).toThrow('cancel')
    expect(api.exportProject()).toEqual(before)
    api.undo()
    api.redo()
    expect(api.exportProject()).toEqual(after)
  })

  it('a transaction with no net edit preserves the next redo', () => {
    const api = editor()
    const before = api.activeScene().sceneConfig.gridHeight
    api.patchSceneConfig({ gridHeight: 9 })
    api.undo()
    api.withHistory(() => {
      api.saveState()
      api.patchSceneConfig({ gridHeight: 7 })
      api.patchSceneConfig({ gridHeight: before })
    })
    api.undo()
    api.redo()
    expect(api.activeScene().sceneConfig.gridHeight).toBe(9)
  })

  it('legacy bare gesture start eagerly discards redo even without a write', () => {
    const api = editor()
    const before = api.exportProject()
    api.patchSceneConfig({ gridHeight: 9 })
    api.undo()
    api.saveState()
    api.redo()
    expect(api.exportProject()).toEqual(before)
  })

  it('measures the wheel window from the last tick and splits after a pause', () => {
    let at = 0
    const api = editor(() => at)
    const before = api.activeScene().sceneConfig.gridHeight
    for (const [time, gridHeight] of [[0, 1], [199, 2], [398, 3], [599, 4], [615, 5]]) {
      at = time
      api.saveStateForWheel()
      api.patchSceneConfig({ gridHeight })
    }
    api.undo()
    expect(api.activeScene().sceneConfig.gridHeight).toBe(3)
    api.undo()
    expect(api.activeScene().sceneConfig.gridHeight).toBe(before)
    api.redo()
    expect(api.activeScene().sceneConfig.gridHeight).toBe(3)
  })

  it('clears only the reloaded node history, keeping its valid camera and playhead', () => {
    const store = createDirectorStore({ defaultSceneName: '#1' })
    const a = store.getState()
    const b = editor()
    const camera = a.addCamera(buildCameraFromPreset({ preset: CAMERA_PRESETS[0], id: 'a', name: 'A' }))
    a.select({ cameraId: camera })
    a.setActiveCamera(camera)
    a.setTimelineContext({ currentTime: 3 })
    const saved = a.exportProject()
    a.createSceneLayer('Discarded')
    a.undo()
    a.select({ cameraId: camera })
    a.setActiveCamera(camera)
    b.createSceneLayer('Independent')
    b.undo()
    a.loadProject(saved, 'A', { keepView: true })
    expect(store.getState()).toMatchObject({ activeCameraId: camera, selection: { cameraId: camera }, timeline: { currentTime: 3 } })
    a.undo()
    expect(a.exportProject()).toEqual(saved)
    a.redo()
    expect(a.exportProject()).toEqual(saved)
    b.redo()
    expect(b.activeScene().name).toBe('Independent')
    expect(a.activeScene().name).toBe('#1')
    const reopened = createDirectorStore({ rawProject: a.exportProject(), defaultSceneName: 'A' })
    expect(reopened.getState().exportProject()).toEqual(saved)
  })
})
