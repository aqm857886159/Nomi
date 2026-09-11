import { describe, expect, it } from 'vitest'
import { createDirectorStore } from './directorStore'
import type { DirectorObject } from './directorTypes'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'

function worldMatrix(store: ReturnType<typeof createDirectorStore>, id: string): Matrix4 {
  const item = store.getState().findObject(id)!
  const vector = (v: { x: number; y: number; z: number }) => new Vector3(v.x, v.y, v.z)
  const local = new Matrix4().compose(vector(item.position), new Quaternion().setFromEuler(new Euler(...[item.rotation.x, item.rotation.y, item.rotation.z].map(v => v * Math.PI / 180) as [number, number, number], 'XYZ')), vector(item.scale))
  return item.parentId ? worldMatrix(store, item.parentId).multiply(local) : local
}

function expectMatrix(actual: Matrix4, expected: Matrix4) {
  actual.elements.forEach((value, index) => expect(value).toBeCloseTo(expected.elements[index], 6))
}

const object = (name: string, x = 0): Omit<DirectorObject, 'id'> => ({ name, type: 'character', position: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, locked: false })
const setup = () => createDirectorStore({ defaultSceneName: 'Scene 1' })

describe('director project transactions', () => {
  it('undo/redo restores the entire project including asset folders and entries', () => {
    const store = setup(), api = store.getState()
    const before = api.exportProject()
    const folder = api.addAssetFolder('Models')
    api.undo()
    expect(api.exportProject()).toEqual(before)
    api.redo()
    expect(store.getState().project.assets.folders).toEqual([folder])
    const item = api.addAssetItem({ name: 'Prop', kind: 'model', url: 'nomi-local://prop.glb', folderId: folder.id })
    api.undo()
    expect(store.getState().project.assets.items).toEqual([])
    api.redo()
    expect(store.getState().project.assets.items).toEqual([item])
  })

  it('one composed action has one undo step and exceptions restore both history stacks', () => {
    const store = setup(), api = store.getState()
    const before = api.exportProject()
    api.withHistory(() => { api.addObject(object('A')); api.addAssetFolder('F') })
    expect(store.getState().undoStack).toHaveLength(1)
    api.undo()
    expect(api.exportProject()).toEqual(before)
    const redo = store.getState().redoStack
    expect(() => api.withHistory(() => { api.addObject(object('B')); throw new Error('cancelled') })).toThrow('cancelled')
    expect(api.exportProject()).toEqual(before)
    expect(store.getState().redoStack).toEqual(redo)
  })

  it.each([false, true])('copies/moves a whole group using the project draft (move=%s)', move => {
    const store = setup(), api = store.getState()
    const sourceId = store.getState().project.activeSceneId
    const a = api.addObject(object('A')), b = api.addObject(object('B', 4))
    const group = api.groupObjects([a, b], 'Group')!
    api.addEntityToTimeline(a)
    api.toggleTimelineTrackPin(a)
    const targetId = api.createSceneLayer('Scene 2')
    api.setActiveScene(sourceId)
    const before = api.exportProject()
    expect(() => api.copyEntitiesToScene([group], targetId, move)).not.toThrow()
    const target = store.getState().project.scenes.find(scene => scene.id === targetId)!
    expect(target.objects).toHaveLength(3)
    const copiedGroup = target.objects.find(item => item.type === 'group')!
    expect(target.objects.filter(item => item.parentId === copiedGroup.id)).toHaveLength(2)
    const copiedA = target.objects.find(item => item.name === 'A')!
    expect(target.timelineTrackOrder).toContain(copiedA.id)
    expect(target.timelineTrackPins).toContain(copiedA.id)
    expect(api.activeScene().objects).toHaveLength(move ? 0 : 3)
    api.undo()
    expect(api.exportProject()).toEqual(before)
    api.redo()
    expect(store.getState().project.scenes.find(scene => scene.id === targetId)!.objects).toHaveLength(3)
  })

  it('copying a layer preserves remapped track priority and presentation', () => {
    const store = setup(), api = store.getState()
    const a = api.addObject(object('A')), b = api.addObject(object('B'))
    api.addEntityToTimeline(a); api.addEntityToTimeline(b)
    api.reorderTimelineTracks([b, a]); api.toggleTimelineTrackPin(b); api.toggleTimelineTrackFold(a)
    api.duplicateSceneLayer(store.getState().project.activeSceneId, ' copy')
    const scene = api.activeScene()
    const copiedA = scene.objects.find(item => item.name === 'A')!, copiedB = scene.objects.find(item => item.name === 'B')!
    expect(scene.timelineTrackOrder).toEqual([copiedB.id, copiedA.id])
    expect(scene.timelineTrackPins).toEqual([copiedB.id])
    expect(scene.timelineTrackFolds).toEqual([copiedA.id])
  })

  it('changing selected entity cannot retain a clip or bone belonging to another entity', () => {
    const store = setup(), api = store.getState()
    const a = api.addObject(object('A')), b = api.addObject(object('B'))
    const clip = api.addTrajectoryClip(a, 0, 4)!
    const point = api.insertWaypoint(a, 1, { x: 3 }, clip.id)!
    api.select({ objectId: a, clipId: clip.id, clipType: 'trajectory', activeWaypointId: point.id, selectedWaypointIds: [point.id], boneKey: 'head', ikTarget: 'head' })
    api.select({ objectId: b, multiObjectIds: [b] })
    expect(store.getState().selection).toMatchObject({ objectId: b, clipId: null, clipType: null, activeWaypointId: null, selectedWaypointIds: [], boneKey: null, ikTarget: null })
  })

  it('undoing a selected clip creation removes all stale editing references', () => {
    const store = setup(), api = store.getState()
    const id = api.addObject(object('A'))
    const clip = api.addTrajectoryClip(id, 0, 4)!
    api.select({ objectId: id, clipId: clip.id, clipType: 'trajectory' })
    api.undo()
    expect(store.getState().selection.clipId).toBeNull()
    expect(store.getState().activeTrajectoryClipIds).toEqual({})
  })

  it('ungrouping a nested group preserves the released parent and pose', () => {
    const store = setup(), api = store.getState()
    const a = api.addObject(object('A', 1)), b = api.addObject(object('B', 3)), c = api.addObject(object('C', 10))
    const inner = api.groupObjects([a, b], 'Inner')!
    const outer = api.groupObjects([inner, c], 'Outer')!
    api.updateObject(outer, { position: { x: 20, y: 0, z: 0 } })
    api.ungroupObjects(inner)
    expect(api.findObject(a)!.parentId).toBe(outer)
    expect(api.findObject(a)!.position.x).toBe(-5)
    expect(api.findObject(b)!.position.x).toBe(-3)
  })

  it('ungroup composes full XYZ rotation, scale and animated path in the parent space', () => {
    const store = setup(), api = store.getState()
    const a = api.addObject(object('A', 1)), b = api.addObject(object('B', 3))
    const group = api.groupObjects([a, b], 'G')!
    api.updateObject(group, { rotation: { x: 25, y: 40, z: 15 }, scale: { x: 2, y: 2, z: 2 } })
    api.updateObject(a, { rotation: { x: 12, y: 31, z: 54 } })
    const expected = worldMatrix(store, a)
    const clip = api.addTrajectoryClip(a, 0, 4)!
    api.insertWaypoint(a, 1, { x: 2, y: 1, z: 3, pitch: 12, yaw: 31, roll: 54 }, clip.id)
    const pathWorld = new Vector3(2, 1, 3).applyMatrix4(worldMatrix(store, group))
    api.ungroupObjects(group)
    expectMatrix(worldMatrix(store, a), expected)
    const point = api.findObject(a)!.motionTrajectory!.find(p => p.time === 1)!
    expect(point.x).toBeCloseTo(pathWorld.x, 6)
    expect(point.y).toBeCloseTo(pathWorld.y, 6)
    expect(point.z).toBeCloseTo(pathWorld.z, 6)
  })

  it('grouping mixed parents preserves world poses and includes a selected descendant only once', () => {
    const store = setup(), api = store.getState()
    const a = api.addObject(object('A', 1)), b = api.addObject(object('B', 3)), c = api.addObject(object('C', 10))
    const inner = api.groupObjects([a, b], 'Inner')!
    api.updateObject(inner, { rotation: { x: 30, y: 45, z: 10 } })
    const expectedA = worldMatrix(store, a), expectedB = worldMatrix(store, b)
    const outer = api.groupObjects([inner, a, c], 'Outer')!
    expect(api.findObject(a)!.parentId).toBe(inner)
    expect(api.findObject(inner)!.parentId).toBe(outer)
    expectMatrix(worldMatrix(store, a), expectedA)
    expectMatrix(worldMatrix(store, b), expectedB)
  })

  it('cloning a nested object keeps its parent and offsets both rest pose and path', () => {
    const store = setup(), api = store.getState()
    const a = api.addObject(object('A', 1)), b = api.addObject(object('B', 3))
    const group = api.groupObjects([a, b], 'G')!
    const clip = api.addTrajectoryClip(a, 0, 4)!
    const point = api.insertWaypoint(a, 1, { x: 2, z: 3 }, clip.id)!
    const clone = api.cloneObject(a, ' copy')!
    expect(api.findObject(clone)!.parentId).toBe(group)
    const copied = api.findObject(clone)!.motionTrajectory!.find(p => p.time === point.time)!
    expect(copied.x).toBe(point.x + 1)
    expect(copied.z).toBe(point.z + 1)
  })

  it.each(['toggleLightEnabled', 'toggleLightLock'] as const)('%s is one reversible user action', action => {
    const store = setup(), api = store.getState()
    const id = api.addLight('point', 'Light')
    const before = api.exportProject()
    api[action](id)
    api.undo()
    expect(api.exportProject()).toEqual(before)
  })

  it('loading cyclic or self-parented groups keeps every object reachable from the root', () => {
    const store = setup(), api = store.getState()
    const a = api.addObject({ ...object('A'), type: 'group' }), b = api.addObject({ ...object('B'), type: 'group' })
    const raw = api.exportProject(), scene = raw.scenes[0]
    scene.objects[0].parentId = b; scene.objects[1].parentId = a
    api.loadProject(raw, 'Scene')
    for (const item of api.activeScene().objects) {
      const visited = new Set<string>()
      let current: DirectorObject | undefined = item
      while (current) {
        expect(visited.has(current.id)).toBe(false)
        visited.add(current.id)
        current = current.parentId ? api.findObject(current.parentId) : undefined
      }
    }
  })

  it('transfers camera, camera path and light through the source and target layer transforms', () => {
    const store = setup(), api = store.getState(), sourceId = api.activeScene().id
    api.patchSceneConfig({ scale: 2, position: { x: 10, y: 0, z: 0 } })
    const cameraId = api.addCamera({ name: 'Camera', position: { x: 3, y: 1, z: 4 }, yaw: 0, pitch: 0, roll: 0, fov: 50 })
    const clip = api.addTrajectoryClip(cameraId, 0, 4)!
    api.insertWaypoint(cameraId, 1, { x: 4, y: 1, z: 5 }, clip.id)
    const lightId = api.addLight('point', 'Light', { position: { x: 3, y: 1, z: 4 } })
    const targetId = api.createSceneLayer('Target')
    api.patchSceneConfig({ position: { x: 1, y: 0, z: 0 } })
    api.setActiveScene(sourceId)
    api.copyEntitiesToScene([cameraId, lightId], targetId, true)
    api.setActiveScene(targetId)
    expect(api.findCamera(cameraId)!.position).toEqual({ x: 15, y: 2, z: 8 })
    expect(api.findCamera(cameraId)!.motionTrajectory!.find(p => p.time === 1)).toMatchObject({ x: 17, y: 2, z: 10 })
    expect(api.findLight(lightId)!.position).toEqual({ x: 15, y: 2, z: 8 })
  })

  it('crowd duplication of a nested character keeps the parent frame and offsets animated paths', () => {
    const store = setup(), api = store.getState()
    const a = api.addObject(object('A', 1)), b = api.addObject(object('B', 3))
    const parent = api.groupObjects([a, b], 'Parent')!
    const clip = api.addTrajectoryClip(a, 0, 4)!
    api.insertWaypoint(a, 1, { x: 2, z: 3 }, clip.id)
    const expected = worldMatrix(store, a)
    const crowd = api.batchCreateCrowd(a, 1, 1, 1, 'Crowd')!
    expect(api.findObject(crowd)!.parentId).toBe(parent)
    const copy = api.activeScene().objects.find(item => item.parentId === crowd)!
    expectMatrix(worldMatrix(store, copy.id), expected)
    expect(copy.motionTrajectory!.find(p => p.time === 1)).toMatchObject({ x: 3, z: 3 })
  })

  it.each(['ratio', 'resolution', 'pin', 'fold'] as const)('persistent %s edit is independently undoable', kind => {
    const store = setup(), api = store.getState()
    const id = api.addObject(object('A'))
    api.addEntityToTimeline(id)
    const before = api.exportProject()
    if (kind === 'ratio') api.setExportRatio('9:16')
    else if (kind === 'resolution') api.setExportResolution('1440')
    else if (kind === 'pin') api.toggleTimelineTrackPin(id)
    else api.toggleTimelineTrackFold(id)
    api.undo()
    expect(api.exportProject()).toEqual(before)
  })

  it('selecting a different entity kind cannot retain the previous owner', () => {
    const store = setup(), api = store.getState()
    const objectId = api.addObject(object('A'))
    const cameraId = api.addCamera({ name: 'Camera', position: { x: 0, y: 1, z: 3 }, yaw: 0, pitch: 0, roll: 0, fov: 50 })
    api.select({ objectId })
    api.select({ cameraId })
    expect(store.getState().selection).toMatchObject({ objectId: null, cameraId, lightId: null, multiObjectIds: [] })
  })

  it('read-only evaluated pose rejects scale together with position and rotation', () => {
    const store = setup(), api = store.getState()
    const id = api.addObject(object('A'))
    api.addTrajectoryClip(id, 0, 4)
    api.setTimelineContext({ currentTime: 2, autoKey: false })
    api.select({ activeWaypointId: null, selectedWaypointIds: [] })
    const before = api.exportProject()
    expect(api.writeObjectSpatialTransform(id, { scale: { x: 3, y: 3, z: 3 } })).toMatchObject({ layer: 'evaluated-readonly', applied: false })
    expect(api.exportProject()).toEqual(before)
  })

  it('waypoint target metadata follows layer remapping and is cleared when the target is removed', () => {
    const store = setup(), api = store.getState()
    const a = api.addObject(object('A')), b = api.addObject(object('B', 4))
    const clip = api.addTrajectoryClip(a, 0, 4)!
    const point = api.insertWaypoint(a, 1, { x: 1 }, clip.id)!
    api.aimWaypointsAt(a, [point.id], b, true)
    api.duplicateSceneLayer(api.activeScene().id, ' copy')
    const copiedA = api.activeScene().objects.find(item => item.name === 'A')!, copiedB = api.activeScene().objects.find(item => item.name === 'B')!
    expect(copiedA.motionTrajectory!.find(point => point.time === 1)!.lookAtObjectId).toBe(copiedB.id)
    api.deleteObject(copiedB.id)
    expect(api.findObject(copiedA.id)!.motionTrajectory!.find(point => point.time === 1)!.lookAtObjectId).toBeUndefined()
  })
})
