import { describe, expect, it } from 'vitest'
import { createDirectorStore } from './directorStore'
import type { DirectorObject } from './directorTypes'
import { normalizeDirectorProject } from './directorProject'
import { CAMERA_PRESETS, buildCameraFromPreset } from './cameraPresets'
import { Euler, MathUtils, Vector3 } from 'three'

function setup() {
  const store = createDirectorStore({ defaultSceneName: 'S' })
  const api = store.getState()
  const object = (name: string, type: DirectorObject['type'] = 'cube'): Omit<DirectorObject, 'id'> => ({ name, type, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, locked: false })
  const source = api.addObject(object('Source'))
  const target = api.addObject(object('Target'))
  const clip = api.addTrajectoryClip(source, 0, 4)!
  api.insertWaypointsBatch(source, clip.id, [0, 4].map(time => ({ time, x: 0, y: 0, z: 0, yaw: 20, pitch: 10, roll: 30 })))
  const points = () => store.getState().findObject(source)!.motionTrajectory!
  return { store, api, source, target, points, object }
}

describe('waypoint aim and batch orientation', () => {
  it.each(['object', 'camera'] as const)('aims the actual %s Euler forward axis at side/elevated and rear targets', kind => {
    const { api, source, target, points, store } = setup()
    const cameraId = api.addCamera(buildCameraFromPreset({ preset: CAMERA_PRESETS[0], id: 'camera', name: 'Camera' }))
    const cameraClip = api.addTrajectoryClip(cameraId, 0, 4)!
    api.insertWaypointsBatch(cameraId, cameraClip.id, [{ time: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 }])
    const id = kind === 'object' ? source : cameraId
    const keys = () => kind === 'object' ? points() : store.getState().findCamera(cameraId)!.motionTrajectory!
    for (const position of [{ x: 4, y: 3, z: 5 }, { x: 4, y: 3, z: -5 }, { x: -4, y: -3, z: -5 }, { x: 0, y: 5, z: 0 }]) {
      api.updateObject(target, { position })
      api.aimWaypointsAt(id, [keys()[0].id], target)
      const point = keys()[0]
      const forward = new Vector3(0, 0, 1).applyEuler(new Euler(...[point.pitch, point.yaw, point.roll].map(MathUtils.degToRad) as [number, number, number], kind === 'object' ? 'XYZ' : 'YXZ'))
      expect(forward.distanceTo(new Vector3(position.x, position.y, position.z).normalize())).toBeLessThan(0.0002)
      expect(point.roll).toBe(0)
    }
  })

  it('bakes each waypoint using the target position at that waypoint time in one undo', () => {
    const { api, source, target, points } = setup()
    const clip = api.addTrajectoryClip(target, 0, 4)!
    api.insertWaypointsBatch(target, clip.id, [{ time: 0, x: 0, y: 0, z: 10, yaw: 0, pitch: 0, roll: 0 }, { time: 4, x: 10, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 }])
    const before = api.exportProject()
    expect(api.aimWaypointsAt(source, points().map(point => point.id), target)).toBe(2)
    expect(points().map(({ yaw, pitch, roll, lookAtObjectId }) => ({ yaw, pitch, roll, lookAtObjectId }))).toEqual([{ yaw: 0, pitch: 0, roll: 0, lookAtObjectId: undefined }, { yaw: 90, pitch: 0, roll: 0, lookAtObjectId: undefined }])
    api.undo()
    expect(api.exportProject()).toEqual(before)
  })

  it('remembers a single target across reload and clearing keeps baked angles', () => {
    const { api, source, target, points } = setup()
    api.updateObject(target, { position: { x: 10, y: 0, z: 0 } })
    api.aimWaypointsAt(source, [points()[0].id], target, true)
    expect(points()[0]).toMatchObject({ yaw: 90, lookAtObjectId: target })
    expect(normalizeDirectorProject(api.exportProject()).scenes[0].objects.find(item => item.id === source)!.motionTrajectory![0].lookAtObjectId).toBe(target)
    api.aimWaypointsAt(source, [points()[0].id], null, true)
    expect(points()[0]).toMatchObject({ yaw: 90 })
    expect(points()[0].lookAtObjectId).toBeUndefined()
  })

  it('aims character targets at the approved 1.2 m height', () => {
    const { api, source, points, object } = setup()
    const target = api.addObject({ ...object('Character', 'character'), position: { x: 0, y: 0, z: 1.2 } })
    api.aimWaypointsAt(source, [points()[0].id], target)
    expect(points()[0]).toMatchObject({ yaw: 0, pitch: -45, roll: 0 })
  })

  it('converts nested target and source parent coordinates before aiming', () => {
    const { api, source, target, points, object } = setup()
    const group = api.addObject({ ...object('Group', 'group'), position: { x: 10, y: 0, z: 0 }, rotation: { x: 0, y: 90, z: 0 } })
    api.updateObject(source, { parentId: group })
    api.updateObject(target, { position: { x: 20, y: 0, z: 0 } })
    api.aimWaypointsAt(source, [points()[0].id], target)
    expect(points()[0]).toMatchObject({ yaw: 0, pitch: 0 })
  })

  it('rejects self, group and missing targets without touching history or the project', () => {
    const { api, source, points, object } = setup()
    const group = api.addObject(object('Group', 'group'))
    const before = api.exportProject()
    for (const target of [source, group, 'missing']) expect(api.aimWaypointsAt(source, [points()[0].id], target)).toBe(0)
    expect(api.exportProject()).toEqual(before)
  })

  it('patches only selected waypoint angles with a single undo', () => {
    const { api, source, points } = setup()
    const before = api.exportProject()
    expect(api.updateWaypointAngles(source, [points()[0].id], { pitch: -25, roll: 15 })).toBe(1)
    expect(points()[0]).toMatchObject({ pitch: -25, roll: 15, yaw: 20 })
    expect(points()[1]).toMatchObject({ pitch: 10, roll: 30, yaw: 20 })
    api.undo()
    expect(api.exportProject()).toEqual(before)
  })

  it('rejects nonfinite orientation patches as a whole', () => {
    const { api, source, points } = setup()
    const before = api.exportProject()
    expect(api.updateWaypointAngles(source, points().map(point => point.id), { pitch: 30, roll: Number.NaN })).toBe(0)
    expect(api.exportProject()).toEqual(before)
  })
})
