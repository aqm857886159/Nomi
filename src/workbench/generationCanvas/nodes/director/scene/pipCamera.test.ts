import { describe, expect, it } from 'vitest'
import { CAMERA_PRESETS, buildCameraFromPreset } from '../model/cameraPresets'
import { createDirectorStore } from '../model/directorStore'
import type { DirectorObject } from '../model/directorTypes'
import { pipCameraIdOf } from './pipCamera'

const guard: Omit<DirectorObject, 'id'> = {
  name: 'Guard', type: 'character', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 }, visible: true, locked: false, boneRotations: {},
}

function twoCameras() {
  const store = createDirectorStore({ defaultSceneName: 'S1' })
  const api = store.getState()
  const wide = api.addCamera(buildCameraFromPreset({ preset: CAMERA_PRESETS[0], id: 'wide', name: 'wide' }))
  const medium = api.addCamera(buildCameraFromPreset({ preset: CAMERA_PRESETS[1], id: 'medium', name: 'medium' }))
  const guardId = api.addObject(guard)
  return { store, wide, medium, guardId }
}

describe('小窗跟随选中机位（previewCameraId 唯一写者 = store.select）', () => {
  it('selecting a camera switches the preview to it; selecting a character does not move it', () => {
    const { store, wide, medium, guardId } = twoCameras()
    store.getState().select({ cameraId: wide })
    expect(pipCameraIdOf(store.getState())).toBe(wide)
    store.getState().select({ cameraId: medium })
    expect(pipCameraIdOf(store.getState())).toBe(medium)
    store.getState().select({ objectId: guardId })
    expect(pipCameraIdOf(store.getState())).toBe(medium)
    store.getState().clearSelection()
    expect(pipCameraIdOf(store.getState())).toBe(medium)
  })

  it('re-selecting the already selected camera still pulls the preview back after a dropdown change', () => {
    const { store, wide, medium } = twoCameras()
    store.getState().select({ cameraId: medium })
    store.getState().setPreviewCamera(wide)
    store.getState().select({ cameraId: medium })
    expect(pipCameraIdOf(store.getState())).toBe(medium)
  })

  it('while playing the preview follows the program camera; after stop the last selection shows', () => {
    const { store, wide, medium } = twoCameras()
    store.getState().select({ cameraId: wide })
    store.getState().setTimelineContext({ isPlaying: true })
    store.getState().select({ cameraId: medium })
    const playing = pipCameraIdOf(store.getState())
    expect(playing === medium).toBe(false)
    store.getState().setTimelineContext({ isPlaying: false })
    expect(pipCameraIdOf(store.getState())).toBe(medium)
  })

  it('director view (followProgram) ignores selection', () => {
    const { store, wide, medium } = twoCameras()
    store.getState().select({ cameraId: wide })
    const before = pipCameraIdOf(store.getState(), { followProgram: true })
    store.getState().select({ cameraId: medium })
    expect(pipCameraIdOf(store.getState(), { followProgram: true })).toBe(before)
  })
})
