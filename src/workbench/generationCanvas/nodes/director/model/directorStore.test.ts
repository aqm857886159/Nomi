import { describe, expect, it } from 'vitest'
import { CAMERA_PRESETS, buildCameraFromPreset } from './cameraPresets'
import { createDirectorStore } from './directorStore'
import type { DirectorObject } from './directorTypes'

function character(name: string, x = 0): Omit<DirectorObject, 'id'> {
  return {
    name,
    type: 'character',
    position: { x, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    locked: false,
    boneRotations: { head: { x: 10, y: 0, z: 0 } },
  }
}

describe('directorStore', () => {
  it('boots from garbage with one scene and exports a clean project', () => {
    const store = createDirectorStore({ rawProject: { scenes: 'nope' }, defaultSceneName: 'S1' })
    expect(store.getState().project.scenes).toHaveLength(1)
    expect(store.getState().exportProject().scenes[0].name).toBe('S1')
  })

  it('adds entities, selects them, and undo/redo restores the tree', () => {
    const store = createDirectorStore({ defaultSceneName: 'S1' })
    const api = store.getState()
    const id = api.addObject(character('A'))
    expect(store.getState().selection.objectId).toBe(id)
    expect(store.getState().activeScene().objects).toHaveLength(1)
    api.undo()
    expect(store.getState().activeScene().objects).toHaveLength(0)
    expect(store.getState().selection.objectId).toBeNull()
    api.redo()
    expect(store.getState().activeScene().objects).toHaveLength(1)
  })

  it('groups around the centroid and ungrouping bakes positions back to world', () => {
    const store = createDirectorStore({ defaultSceneName: 'S1' })
    const api = store.getState()
    const a = api.addObject(character('A', 0))
    const b = api.addObject(character('B', 4))
    const groupId = api.groupObjects([a, b], 'G')!
    const group = store.getState().findObject(groupId)!
    expect(group.position.x).toBe(2)
    expect(store.getState().findObject(a)!.position.x).toBe(-2)
    const released = api.ungroupObjects(groupId)
    expect(released).toEqual([a, b])
    expect(store.getState().findObject(a)!.position.x).toBe(0)
    expect(store.getState().findObject(b)!.position.x).toBe(4)
    expect(store.getState().findObject(groupId)).toBeUndefined()
  })

  it('crowd matrix clones into a group; deleting the group cascades', () => {
    const store = createDirectorStore({ defaultSceneName: 'S1' })
    const api = store.getState()
    const a = api.addObject(character('A'))
    const groupId = api.batchCreateCrowd(a, 2, 3, 1, 'crowd')!
    expect(store.getState().activeScene().objects).toHaveLength(1 + 1 + 6)
    api.deleteObject(groupId)
    expect(store.getState().activeScene().objects).toHaveLength(1)
  })

  it('spatial writes respect the edit layer: rest → keyframe → readonly, autoKey unlocks readonly', () => {
    const store = createDirectorStore({ defaultSceneName: 'S1' })
    const api = store.getState()
    const a = api.addObject(character('A'))
    // rest：无片段直接改静止位姿
    expect(api.writeObjectSpatialTransform(a, { position: { x: 1, y: 0, z: 0 } }).layer).toBe('rest')
    expect(store.getState().findObject(a)!.position.x).toBe(1)
    // 有片段但播放头不在路标上 → 只读
    const clip = api.addTrajectoryClip(a, 0, 4)!
    api.setTimelineContext({ currentTime: 2 })
    expect(api.writeObjectSpatialTransform(a, { position: { x: 5, y: 0, z: 0 } })).toMatchObject({ layer: 'evaluated-readonly', applied: false })
    // 先插关键帧再写 → keyframe
    const point = api.insertWaypoint(a, 2, { x: 3, y: 0, z: 0 }, clip.id)!
    const write = api.writeObjectSpatialTransform(a, { position: { x: 5, y: 0, z: 0 } })
    expect(write.layer).toBe('keyframe')
    expect(write.keyframeId).toBe(point.id)
    expect(store.getState().findObject(a)!.motionTrajectory![0].x).toBe(5)
    // 片段外插关键帧：prepareClipForKeyframeInsert 扩片段
    expect(api.prepareClipForKeyframeInsert(a, 5)).toBe(true)
    expect(store.getState().findObject(a)!.trajectoryClips![0].endTime).toBe(5)
  })

  it('closeup clips lock POV entry and are placed after existing clips', () => {
    const store = createDirectorStore({ defaultSceneName: 'S1' })
    const api = store.getState()
    const a = api.addObject(character('A'))
    const cam = api.addCamera(buildCameraFromPreset({ preset: CAMERA_PRESETS[1], id: 'cam', name: '机位 1' }))
    const first = api.addCloseupClip(cam, a, 0, 4)!
    const second = api.addCloseupClip(cam, a, 1, 2)!
    expect(first.startTime).toBe(0)
    expect(second.startTime).toBe(4)
    expect(api.canEnterCameraPOV(cam, 2)).toEqual({ allowed: false, reasonKey: 'director.reason.closeupLocked' })
    expect(api.canEnterCameraPOV(cam, 7)).toEqual({ allowed: true })
    expect(api.canEnterCameraPOV('ghost')).toMatchObject({ allowed: false })
    api.deleteCloseupClip(cam, first.id)
    api.deleteCloseupClip(cam, second.id)
    expect(store.getState().findCamera(cam)!.inTimeline).toBe(false)
  })

  it('action, bone keyframe and look-at clips live on characters only', () => {
    const store = createDirectorStore({ defaultSceneName: 'S1' })
    const api = store.getState()
    const a = api.addObject(character('A'))
    const cube = api.addObject({ ...character('C'), type: 'cube' })
    expect(api.addActionClip(cube, { name: 'walk', clipType: 'action', actionPose: 'standard_walk' })).toBeNull()
    const walk = api.addActionClip(a, { name: 'walk', clipType: 'action', actionPose: 'standard_walk' })!
    const pose = api.addActionClip(a, { name: 'pose', clipType: 'custom_pose' })!
    expect(pose.startTime).toBe(walk.endTime)
    expect(api.insertBoneKeyframe(a, 1)).toBeNull()
    const keyframe = api.insertBoneKeyframe(a, pose.startTime + 1)!
    expect(keyframe.boneRotations.head).toEqual({ x: 10, y: 0, z: 0 })
    expect(api.updateBoneKeyframeTime(a, keyframe.id, pose.startTime + 2)).toBe(true)
    const look = api.addLookAtClip(a)!
    expect(look.startTime).toBe(0)
    expect(api.addLookAtClip(a, 'prepend')).toBeNull()
    api.clearActionClips(a)
    api.clearLookAtClips(a)
    expect(store.getState().findObject(a)!.inTimeline).toBe(false)
  })

  it('scene layers: create, duplicate with remapped ids, delete keeps at least one', () => {
    const store = createDirectorStore({ defaultSceneName: 'S1' })
    const api = store.getState()
    const a = api.addObject(character('A'))
    const copyId = api.duplicateSceneLayer(store.getState().project.activeSceneId, ' (副本)')
    const copy = store.getState().project.scenes.find((scene) => scene.id === copyId)!
    expect(copy.objects[0].id).not.toBe(a)
    expect(store.getState().project.activeSceneId).toBe(copyId)
    const layerId = api.createSceneLayer('S3')
    expect(store.getState().project.scenes).toHaveLength(3)
    expect(api.deleteSceneLayer(layerId)).toBe(true)
    expect(api.deleteSceneLayer(copyId)).toBe(true)
    expect(api.deleteSceneLayer(store.getState().project.activeSceneId)).toBe(false)
  })
})
