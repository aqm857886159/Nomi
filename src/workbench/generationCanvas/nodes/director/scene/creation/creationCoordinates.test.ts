import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createDirectorStore, type DirectorStore } from '../../model/directorStore'
import type { Vec3 } from '../../model/directorTypes'

const runtime = vi.hoisted(() => ({ store: null as unknown as DirectorStore, slots: [] as unknown[], cursor: 0, dirty: false, effects: [] as (() => void)[], api: { current: { groundPointFromClient: (_x: number, _y: number) => ({ x: 0, y: 0, z: 0 }), setOrbitEnabled: (_enabled: boolean) => {} } } }))
vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>()
  return { ...actual, default: { ...actual,
    useRef: (value: unknown) => { const i = runtime.cursor++; return runtime.slots[i] ??= { current: value } },
    useState: (value: unknown) => { const i = runtime.cursor++; if (!(i in runtime.slots)) runtime.slots[i] = typeof value === 'function' ? (value as () => unknown)() : value; return [runtime.slots[i], (next: unknown) => { const resolved = typeof next === 'function' ? (next as (old: unknown) => unknown)(runtime.slots[i]) : next; runtime.dirty ||= !Object.is(resolved, runtime.slots[i]); runtime.slots[i] = resolved }] },
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => void, deps: unknown[]) => { const i = runtime.cursor++, old = runtime.slots[i] as unknown[] | undefined; if (!old || deps.some((value, index) => value !== old[index])) runtime.effects.push(fn); runtime.slots[i] = deps },
  } }
})
vi.mock('../../DirectorEditorContext', () => ({ useDirectorStoreApi: () => runtime.store, useDirectorStore: (select: (state: ReturnType<DirectorStore['getState']>) => unknown) => select(runtime.store.getState()) }))
vi.mock('../ViewportApiContext', () => ({ useViewportApi: () => runtime.api }))
import { useCharacterPlacement } from './useCharacterPlacement'
import { useBoxDraw } from './useBoxDraw'
import { usePathDraw } from './usePathDraw'

function render<T>(hook: () => T): T { runtime.cursor = 0; runtime.dirty = false; const result = hook(); runtime.effects.splice(0).forEach((effect) => effect()); return result }
function pointer(x: number, y: number) { return { clientX: x, clientY: y, button: 0, shiftKey: false, preventDefault: vi.fn() } as unknown as React.PointerEvent }
function matrix(position: Vec3, rotation: Vec3, scale: Vec3) {
  return new THREE.Matrix4().compose(new THREE.Vector3(position.x, position.y, position.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(...[rotation.x, rotation.y, rotation.z].map(THREE.MathUtils.degToRad) as [number, number, number])), new THREE.Vector3(scale.x, scale.y, scale.z))
}
function sceneMatrix() { const c = runtime.store.getState().activeScene().sceneConfig; return matrix(c.position, c.rotation, { x: c.scale, y: c.scale, z: c.scale }) }
function expectPoint(point: Vec3, expected: Vec3) { expect(point.x).toBeCloseTo(expected.x, 4); expect(point.y).toBeCloseTo(expected.y, 4); expect(point.z).toBeCloseTo(expected.z, 4) }

beforeEach(() => {
  runtime.store = createDirectorStore({ defaultSceneName: 'Scene' }); runtime.slots = []; runtime.cursor = 0; runtime.effects = []
  runtime.store.getState().patchSceneConfig({ position: { x: 4, y: 2, z: -3 }, rotation: { x: 10, y: 60, z: -5 }, scale: 2, gridHeight: 1.5 })
  runtime.api.current.groundPointFromClient = (x, y) => ({ x, y: runtime.store.getState().activeScene().sceneConfig.gridHeight, z: y })
})

describe('world creation input to persisted local space', () => {
  it('activates the box mode UI immediately without requiring a first ground click', () => {
    const Hook = () => useBoxDraw({ boxName: () => 'Box' })
    let api = render(Hook); api.start()
    if (runtime.dirty) api = render(Hook)
    expect(api.active).toBe(true)
    api.cancel(); if (runtime.dirty) api = render(Hook)
    expect(api.active).toBe(false)
  })
  it('commits character position and orientation matching its world preview in a transformed scene', () => {
    const Hook = () => useCharacterPlacement({ characterName: () => 'Character' })
    let api = render(Hook); api.start('female'); api = render(Hook)
    api.onPointerDown(pointer(8, 6)); api = render(Hook)
    api.onPointerMove(pointer(9, 6)); api = render(Hook)
    api.onPointerUp(pointer(9, 6))
    const object = runtime.store.getState().activeScene().objects[0]
    const world = sceneMatrix().multiply(matrix(object.position, object.rotation, object.scale))
    expectPoint(new THREE.Vector3().setFromMatrixPosition(world), { x: 8, y: 1.5, z: 6 })
    expectPoint(new THREE.Vector3(0, 0, 1).transformDirection(world), { x: 1, y: 0, z: 0 })
  })
  it('commits the exact world box dimensions and bottom point previewed under global transform', () => {
    const Hook = () => useBoxDraw({ boxName: () => 'Box' })
    let api = render(Hook); api.start(); api = render(Hook)
    api.onPointerDown(pointer(8, 6)); api = render(Hook)
    api.onPointerMove(pointer(10, 9)); api = render(Hook)
    api.onPointerUp(pointer(10, 9)); api = render(Hook)
    api.onPointerMove(pointer(10, -91)); api = render(Hook)
    api.onPointerDown(pointer(10, -91))
    const object = runtime.store.getState().activeScene().objects[0]
    const world = sceneMatrix().multiply(matrix(object.position, object.rotation, object.scale))
    expectPoint(new THREE.Vector3().setFromMatrixPosition(world), { x: 9, y: 1.5, z: 7.5 })
    expectPoint(new THREE.Vector3().setFromMatrixScale(world), { x: 2, y: 1, z: 3 })
  })
  it.each(['waypoint', 'pencil'] as const)('writes %s path points in a nested parent space and retains the grid height', (mode) => {
    const state = runtime.store.getState(), base = { position: { x: 1, y: 2, z: -1 }, rotation: { x: 0, y: 30, z: 0 }, scale: { x: 2, y: 2, z: 2 }, visible: true, locked: false }
    const parentId = state.addObject({ ...base, name: 'Group', type: 'group' })
    const id = state.addObject({ ...base, position: { x: 0, y: 0, z: 0 }, name: 'Character', type: 'character', parentId })
    state.setDrawMode(mode)
    const api = render(() => usePathDraw({ notify: vi.fn() }))
    api.onPointerDown(pointer(8, 6))
    if (mode === 'pencil') { api.onPointerMove(pointer(10, 8)); api.onPointerUp(pointer(10, 8)) }
    const point = runtime.store.getState().findObject(id)!.motionTrajectory![0]
    const world = sceneMatrix().multiply(matrix(base.position, base.rotation, base.scale))
    expectPoint(new THREE.Vector3(point.x, point.y, point.z).applyMatrix4(world), { x: 8, y: 1.5, z: 6 })
  })
})
