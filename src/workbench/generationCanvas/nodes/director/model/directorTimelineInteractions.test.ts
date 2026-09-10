import { describe, expect, it } from 'vitest'
import { CAMERA_PRESETS, buildCameraFromPreset } from './cameraPresets'
import { createDirectorStore } from './directorStore'
import type { DirectorObject } from './directorTypes'
import { copyClipPayload, relocatePayload } from './timelineClipboard'
import { evaluateEntityTransform } from './trajectoryEval'
import { samplePoseAt } from './clipKeyframes'
import { Euler, MathUtils, Quaternion } from 'three'

function setup() {
  const store = createDirectorStore({ defaultSceneName: 'S' })
  const api = store.getState()
  const object: Omit<DirectorObject, 'id'> = {
    name: 'A', type: 'character', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }, visible: true, locked: false,
    boneRotations: { head: { x: 20, y: 0, z: 0 } }, hipsOffset: { x: 0, y: 1, z: 0 },
  }
  const id = api.addObject(object)
  const cameraId = api.addCamera(buildCameraFromPreset({ preset: CAMERA_PRESETS[0], id: 'camera', name: 'C' }))
  return { store, api, id, cameraId }
}

describe('director timeline interaction contracts', () => {
  it('samples compound-axis pose cuts with the same XYZ quaternion rotation as the renderer', () => {
    const rotations = [[120, -70, 45], [-140, 85, -120]]
    const keys = rotations.map(([x, y, z], index) => ({ id: String(index), time: index * 4, frame: index * 120, boneRotations: { head: { x, y, z } } }))
    for (const alpha of [0.05, 0.25, 0.5, 0.8, 0.99]) {
      const sampled = samplePoseAt({ id: 'pose', name: '', clipType: 'custom_pose', startTime: 0, endTime: 4, startFrame: 0, endFrame: 120, keyframes: keys }, alpha * 4).boneRotations.head
      const expected = new Quaternion().setFromEuler(new Euler(...rotations[0].map(MathUtils.degToRad) as [number, number, number]))
        .slerp(new Quaternion().setFromEuler(new Euler(...rotations[1].map(MathUtils.degToRad) as [number, number, number])), alpha)
      const actual = new Quaternion().setFromEuler(new Euler(...[sampled.x, sampled.y, sampled.z].map(MathUtils.degToRad) as [number, number, number]))
      expect(actual.angleTo(expected)).toBeLessThan(1e-6)
    }
  })

  it('returns a stable saved waypoint when overwriting an existing frame', () => {
    const { api, id } = setup()
    const clip = api.addTrajectoryClip(id, 0, 4)!
    api.insertWaypoint(id, 1, { x: 1 }, clip.id)
    const result = api.insertWaypoint(id, 1, { x: 2 }, clip.id)!
    expect(result.x).toBe(2)
    expect(result.id).toBeTruthy()
  })

  it('pastes a closeup into the destination camera with independent custom anchor', () => {
    const { api, cameraId, id, store } = setup()
    const source = api.addCloseupClip(cameraId, id, 0)!
    api.updateCloseupClip(cameraId, source.id, { customAnchor: { x: 1, y: 2, z: 3 } })
    const destination = api.addCamera(buildCameraFromPreset({ preset: CAMERA_PRESETS[0], id: 'camera2', name: 'D' }))
    const payload = copyClipPayload(store.getState().findCamera(cameraId)!, 'closeup', source.id)!
    const pasted = api.pasteClip(destination, payload, 0)!
    expect(store.getState().findCamera(destination)!.closeupClips!.find((clip) => clip.id === pasted)?.entityId).toBe(destination)
  })

  it('moves and copies untagged legacy waypoints using existing time ownership', () => {
    const { api, id, store } = setup()
    const clip = api.addTrajectoryClip(id, 0, 4)!
    api.updateObject(id, { motionTrajectory: [{ id: 'legacy', time: 2, frameIndex: 60, x: 2, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 }] })
    const copied = copyClipPayload(store.getState().findObject(id)!, 'trajectory', clip.id)!
    expect(copied.family === 'trajectory' && copied.waypoints).toHaveLength(1)
    api.moveClip(id, clip.id, 'trajectory', 4)
    expect(store.getState().findObject(id)!.motionTrajectory![0]).toMatchObject({ time: 6, clipId: clip.id })
  })

  it('keeps a whole recording when the first free gap is shorter than the recording', () => {
    const { api, id, cameraId, store } = setup()
    api.addCloseupClip(cameraId, id, 1, 2)
    api.startRecording(cameraId)
    const result = api.finishRecording([0, 2].map((time) => ({ time, position: { x: time, y: 1, z: 3 }, yaw: 0, pitch: 0, roll: 0, fov: 45 })), 2)
    expect(result).toMatchObject({ waypoints: 2 })
    expect(store.getState().findCamera(cameraId)!.trajectoryClips![0]).toMatchObject({ startTime: 3, endTime: 5 })
    expect(store.getState().findCamera(cameraId)!.motionTrajectory!.map((key) => key.time)).toEqual([3, 5])
  })
  it('creates a pose with the current first keyframe and selects its write target', () => {
    const { api, id, store } = setup()
    const clip = api.addActionClip(id, { name: 'Pose', clipType: 'custom_pose' })!
    expect(clip.keyframes).toHaveLength(1)
    expect(clip.keyframes![0]).toMatchObject({ time: 0, boneRotations: { head: { x: 20, y: 0, z: 0 } } })
    expect(store.getState().selection.boneKeyframeId).toBe(clip.keyframes![0].id)
  })

  it('starts the first appended pose at the playhead', () => {
    const { api, id } = setup()
    api.setTimelineContext({ currentTime: 7 })
    expect(api.addActionClip(id, { name: 'Pose', clipType: 'custom_pose' })?.startTime).toBe(7)
  })

  it.each([3, 5])('never extends camera motion across a closeup when inserting at %s', (time) => {
    const { api, cameraId, id, store } = setup()
    api.addTrajectoryClip(cameraId, 0, 2)
    api.addCloseupClip(cameraId, id, 2, 2)
    const before = store.getState().exportProject()
    expect(api.insertKeyframeAt(cameraId, time)).toBeNull()
    expect(store.getState().exportProject()).toEqual(before)
  })

  it('creates an absent motion clip at the requested insertion time', () => {
    const { api, id, store } = setup()
    expect(api.insertKeyframeAt(id, 5)).not.toBeNull()
    expect(store.getState().findObject(id)!.trajectoryClips![0].startTime).toBe(5)
  })

  it('rescales all trajectory keys on resize while preserving the path', () => {
    const { api, id, store } = setup()
    const clip = api.addTrajectoryClip(id, 0, 4)!
    api.insertWaypoint(id, 0, { x: 0 }, clip.id)
    api.insertWaypoint(id, 2, { x: 2 }, clip.id)
    api.insertWaypoint(id, 4, { x: 4 }, clip.id)
    expect(api.updateClipTime(id, clip.id, 'trajectory', 1, 3)).toBe(true)
    expect(store.getState().findObject(id)!.motionTrajectory!.map((key) => key.time)).toEqual([1, 2, 3])
    expect(evaluateEntityTransform(store.getState().findObject(id)!, 3).position.x).toBe(4)
  })

  it.each(['left', 'right', 'split'] as const)('preserves the motion at the %s cut boundary', (operation) => {
    const { api, id, store } = setup()
    const clip = api.addTrajectoryClip(id, 0, 4)!
    api.insertWaypoint(id, 0, { x: 0 }, clip.id)
    api.insertWaypoint(id, 4, { x: 4 }, clip.id)
    if (operation === 'split') expect(api.splitClip(id, clip.id, 'trajectory', 2)).not.toBeNull()
    else expect(api.trimClip(id, clip.id, 'trajectory', operation, 2)).toBe(true)
    const entity = store.getState().findObject(id)!
    const boundaries = entity.motionTrajectory!.filter((key) => key.time === 2)
    expect(boundaries).toHaveLength(operation === 'split' ? 2 : 1)
    expect(boundaries.every((key) => key.x === 2)).toBe(true)
    expect(new Set(boundaries.map((key) => key.id)).size).toBe(boundaries.length)
    expect(evaluateEntityTransform(entity, 2).position.x).toBe(2)
  })

  it.each(['left', 'right', 'split'] as const)('clips bone keys and samples a pose boundary for %s', (operation) => {
    const { api, id, store } = setup()
    const clip = api.addActionClip(id, { name: 'Pose', clipType: 'custom_pose' })!
    api.insertBoneKeyframe(id, 0)
    api.updateObject(id, { boneRotations: { head: { x: 60, y: 0, z: 0 } } })
    api.insertBoneKeyframe(id, 4)
    if (operation === 'split') api.splitClip(id, clip.id, 'action', 2)
    else api.trimClip(id, clip.id, 'action', operation, 2)
    const clips = store.getState().findObject(id)!.actionClips!
    expect(clips).toHaveLength(operation === 'split' ? 2 : 1)
    for (const item of clips) {
      expect(item.keyframes!.every((key) => key.time >= item.startTime && key.time <= item.endTime)).toBe(true)
      expect(item.keyframes!.find((key) => key.time === 2)?.boneRotations.head.x).toBeCloseTo(40)
    }
    const keys = clips.flatMap((item) => item.keyframes!)
    expect(new Set(keys.map((key) => key.id)).size).toBe(keys.length)
  })

  it('rescales pose keys rather than deleting them on resize', () => {
    const { api, id, store } = setup()
    const clip = api.addActionClip(id, { name: 'Pose', clipType: 'custom_pose' })!
    api.insertBoneKeyframe(id, 0)
    api.insertBoneKeyframe(id, 4)
    api.updateClipTime(id, clip.id, 'action', 1, 3)
    expect(store.getState().findObject(id)!.actionClips![0].keyframes!.map((key) => key.time)).toEqual([1, 3])
  })

  it('does not let a waypoint overtake a neighboring keyframe', () => {
    const { api, id } = setup()
    const clip = api.addTrajectoryClip(id, 0, 4)!
    const a = api.insertWaypoint(id, 0, { x: 0 }, clip.id)!
    api.insertWaypoint(id, 2, { x: 2 }, clip.id)
    api.insertWaypoint(id, 4, { x: 4 }, clip.id)
    expect(api.updateWaypointTime(id, a.id, 3)).toBeCloseTo(2 - 1 / 30)
  })

  it('rejects single and batch keyframes outside their owning clip', () => {
    const { api, id, store } = setup()
    const clip = api.addTrajectoryClip(id, 1, 2)!
    expect(api.insertWaypoint(id, 4, { x: 4 }, clip.id)).toBeNull()
    expect(api.insertWaypointsBatch(id, clip.id, [{ time: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 }])).toBe(0)
    expect(store.getState().findObject(id)!.motionTrajectory ?? []).toEqual([])
  })

  it('copies deeply so edits to a pasted pose cannot change clipboard contents', () => {
    const { api, id, store } = setup()
    const clip = api.addActionClip(id, { name: 'Pose', clipType: 'custom_pose' })!
    api.insertBoneKeyframe(id, 0)
    const source = store.getState().findObject(id)!
    const payload = copyClipPayload(source, 'action', clip.id)!
    const relocated = relocatePayload(payload, 4, { clipId: () => 'copy', keyframeId: () => 'copy-key', waypointId: () => 'copy-waypoint' })
    if (relocated.family !== 'action' || payload.family !== 'action') throw new Error('Unexpected family')
    relocated.clip.keyframes![0].boneRotations.head.x = 99
    relocated.clip.keyframes![0].hipsOffset!.y = 99
    expect(payload.clip.keyframes![0].boneRotations.head.x).toBe(20)
    expect(source.actionClips![0].keyframes![0].hipsOffset!.y).toBe(1)
  })

  it.each(['add-track', 'insert-pose', 'create-closeup', 'convert-closeup', 'record'] as const)('undoes %s as one user action', (operation) => {
    const { api, id, cameraId, store } = setup()
    const closeup = operation === 'convert-closeup' ? api.addCloseupClip(cameraId, id, 0) : null
    const before = store.getState().exportProject()
    if (operation === 'add-track') api.addEntityToTimeline(id)
    if (operation === 'insert-pose') api.insertBoneKeyframe(id, 1)
    if (operation === 'create-closeup') api.createCloseupForCharacter(id, 'New camera')
    if (operation === 'convert-closeup') api.convertCloseupToTrajectory(cameraId, closeup!.id)
    if (operation === 'record') {
      api.startRecording(cameraId)
      api.finishRecording([0, 1].map((time) => ({ time, position: { x: time, y: 1, z: 3 }, yaw: 0, pitch: 0, roll: 0, fov: 45 })), 1)
    }
    api.undo()
    expect(store.getState().exportProject()).toEqual(before)
  })
})
