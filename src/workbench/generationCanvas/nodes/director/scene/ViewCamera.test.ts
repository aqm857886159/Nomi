import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createDirectorStore, type DirectorStore } from '../model/directorStore'
import { DEFAULT_VIEW_SETTINGS, FREE_CAMERA_HOME } from './viewSettings'
import { matchesHotkey, isMacPlatform, DIRECTOR_HOTKEYS } from '../model/hotkeys'
import { buildCameraFromPreset, CAMERA_PRESETS } from '../model/cameraPresets'

const runtime = vi.hoisted(() => ({ store: null as unknown as DirectorStore, effects: [] as (() => (() => void) | void)[], frames: [] as ((state: unknown, delta: number) => void)[], three: {} as Record<string, unknown>, api: { current: null as unknown }, registry: {}, capture: vi.fn(), labels: vi.fn() }))
vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>()
  return { ...actual, default: { ...actual, useRef: (current: unknown) => ({ current }), useState: (initial: unknown) => [initial, vi.fn()], useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(), useLayoutEffect: (fn: () => (() => void) | void) => runtime.effects.push(fn), useEffect: (fn: () => (() => void) | void) => runtime.effects.push(fn) } }
})
vi.mock('@react-three/fiber', () => ({ createPortal: (children: unknown) => children, useThree: () => runtime.three, useFrame: (fn: (state: unknown, delta: number) => void) => runtime.frames.push(fn) }))
vi.mock('@react-three/drei', () => ({ OrbitControls: 'orbit-controls', TransformControls: 'transform-controls' }))
vi.mock('../DirectorEditorContext', () => ({ useDirectorStoreApi: () => runtime.store, useDirectorStore: (select: (state: ReturnType<DirectorStore['getState']>) => unknown) => select(runtime.store.getState()) }))
vi.mock('./ViewportApiContext', () => ({ useViewportApi: () => runtime.api }))
vi.mock('./SceneRegistryContext', () => ({ useSceneRegistry: () => runtime.registry }))
vi.mock('./entities/CharacterEntity', () => ({ CHARACTER_HEIGHT: 1.75 }))
vi.mock('./capture/directorCapture', async (original) => {
  const actual = await original<typeof import('./capture/directorCapture')>()
  return { ...actual, drawLabels: runtime.labels, FrameRenderer: class { renderToCanvas(...args: unknown[]) { runtime.capture(...args); return { getContext: () => ({}) } } dispose() {} }, encodeCanvas: async () => ({ dataUrl: 'frame', blob: new Blob() }) }
})
import { ViewCamera } from './ViewCamera'
import { useViewportPicking } from './useViewportPicking'
import { createSceneRefRegistry, DIRECTOR_IK_HANDLE_KEY, tagEntityObject } from './sceneRefs'
import { PipRenderer } from './PipRenderer'
import { CaptureBinder } from './capture/CaptureBinder'
import { useDirectorHotkeys } from '../useDirectorHotkeys'
import { LabelProjector } from './LabelProjector'
import { SkeletonVisual } from './character/SkeletonVisual'
import { SkeletonHandles } from './character/SkeletonHandles'
import type { CharacterRigApi } from './character/useCharacterRig'
import { useTimelinePlayback } from './useTimelinePlayback'

let handlers: Map<string, Set<(event: KeyboardEvent) => void>>
let cleanups: (() => void)[]
let overlay = false
let documentState: { activeElement: { tagName: string; type?: string } | null; querySelector: () => object | null }

// 生产键位里的 meta 在 macOS 是 ⌘、其它平台是 Ctrl，所以按 meta 的快捷键必须随平台派生修饰键；
// 写死 ctrlKey 会在 macOS 上恒不命中（Linux CI 照样绿，本机开发者却看到两条红）
const META: Partial<KeyboardEvent> = isMacPlatform() ? { metaKey: true } : { ctrlKey: true }

function key(code: string, fields: Partial<KeyboardEvent> = {}) {
  const event = { code, key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code, target: documentState.activeElement, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...fields } as unknown as KeyboardEvent
  handlers.get('keydown')?.forEach((fn) => fn(event))
}

function setup() {
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 4, 8)
  camera.lookAt(0, 0, 0)
  const orbit = { target: new THREE.Vector3(), update: () => camera.lookAt(orbit.target), enabled: true }
  const hoveredRef = { current: true }
  runtime.three = { camera, gl: { domElement: { clientWidth: 100, clientHeight: 100 } }, size: { width: 100, height: 100 } }
  const rendered = ViewCamera({ settings: DEFAULT_VIEW_SETTINGS, hoveredRef })
  ;(rendered as unknown as { ref: { current: unknown } }).ref.current = orbit
  cleanups = runtime.effects.map((effect) => effect()).filter((fn): fn is () => void => Boolean(fn))
  return { camera, orbit, hoveredRef, frame: () => runtime.frames.forEach((fn) => fn(null, 0.1)) }
}

beforeEach(() => {
  runtime.store = createDirectorStore({ defaultSceneName: 'Scene' })
  runtime.effects = []; runtime.frames = []; handlers = new Map(); cleanups = []; overlay = false
  documentState = { activeElement: null, querySelector: () => overlay ? {} : null }
  vi.stubGlobal('document', documentState)
  vi.stubGlobal('window', { addEventListener: (name: string, fn: (event: KeyboardEvent) => void) => { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name)!.add(fn) }, removeEventListener: (name: string, fn: (event: KeyboardEvent) => void) => handlers.get(name)?.delete(fn) })
})
afterEach(() => { cleanups.forEach((fn) => fn()); vi.unstubAllGlobals() })

describe('director keyboard navigation boundary', () => {
  it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }])('does not fly from shortcut/composition %j', (fields) => {
    const { camera, frame } = setup(); const start = camera.position.clone()
    key('KeyD', fields); frame()
    expect(camera.position.distanceTo(start)).toBe(0)
  })
  it.each(['input', 'overlay', 'leave', 'orbit'] as const)('releases a held movement key when %s takes ownership', (kind) => {
    const { camera, hoveredRef, frame } = setup(); key('KeyW'); frame()
    const start = camera.position.clone()
    if (kind === 'input') documentState.activeElement = { tagName: 'INPUT', type: 'text' }
    if (kind === 'overlay') overlay = true
    if (kind === 'leave') hoveredRef.current = false
    if (kind === 'orbit') (runtime.api.current as { setOrbitEnabled: (value: boolean) => void }).setOrbitEnabled(false)
    frame()
    expect(camera.position.distanceTo(start)).toBe(0)
    documentState.activeElement = null; overlay = false; hoveredRef.current = true
    ;(runtime.api.current as { setOrbitEnabled: (value: boolean) => void }).setOrbitEnabled(true)
    frame()
    expect(camera.position.distanceTo(start)).toBe(0)
  })
  it('moves WASD in the horizontal plane even when looking downward', () => {
    const { camera, frame } = setup(); const y = camera.position.y
    key('KeyW'); frame()
    expect(camera.position.y).toBe(y)
    expect(camera.position.z).toBeLessThan(8)
  })
  it('orbits arrow keys around the current target without moving that target', () => {
    const { camera, orbit, frame } = setup(); const target = orbit.target.clone(); const start = camera.position.clone(); const radius = camera.position.distanceTo(target)
    key('ArrowLeft'); frame()
    expect(orbit.target.distanceTo(target)).toBe(0)
    expect(camera.position.distanceTo(start)).toBeGreaterThan(0)
    expect(camera.position.distanceTo(target)).toBeCloseTo(radius)
  })
  it('does not activate an unmodified binding when the other platform modifier is held', () => {
    const event = { key: 'r', ctrlKey: false, metaKey: true, shiftKey: false, altKey: false }
    expect(matchesHotkey(event, DIRECTOR_HOTKEYS.recordMotion, false)).toBe(false)
    expect(matchesHotkey({ ...event, metaKey: false, ctrlKey: true }, DIRECTOR_HOTKEYS.recordMotion, true)).toBe(false)
  })
})

describe('director picking eligibility', () => {
  function PickingHarness(hidden: boolean, locked: boolean, handle: boolean) {
    const store = runtime.store
    const base = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, locked: false }
    const parentId = store.getState().addObject({ ...base, name: 'Group', type: 'group', visible: !hidden, locked })
    const id = store.getState().addObject({ ...base, name: 'Subject', type: 'character', parentId })
    store.getState().clearSelection()
    const scene = new THREE.Scene()
    const parent = new THREE.Group(); parent.visible = !hidden
    const root = new THREE.Group(); tagEntityObject(root, id, 'object')
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    if (handle) mesh.userData[DIRECTOR_IK_HANDLE_KEY] = { entityId: id, key: 'pelvis' }
    root.add(mesh); parent.add(root); scene.add(parent)
    scene.updateMatrixWorld(true)
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100); camera.position.z = 5; camera.updateMatrixWorld(true)
    const registry = createSceneRefRegistry(); registry.register(id, root); runtime.registry = registry
    const listeners = new Map<string, (event: unknown) => void>()
    const element = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), addEventListener: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) }
    runtime.three = { camera, scene, gl: { domElement: element } }
    useViewportPicking({ enabledRef: { current: true }, onPovRejected: vi.fn() })
    cleanups = runtime.effects.map((effect) => effect()).filter((fn): fn is () => void => Boolean(fn))
    const click = () => { const event = { clientX: 50, clientY: 50, button: 0, shiftKey: false }; listeners.get('pointerdown')?.(event); listeners.get('pointerup')?.(event) }
    return { mesh, root, click, id }
  }
  it('does not select a child hidden through a parent group', () => {
    const { click } = PickingHarness(true, false, false); click()
    expect(runtime.store.getState().selection.objectId).toBeNull()
  })
  it('does not let IK handles bypass parent locking', () => {
    const { click } = PickingHarness(false, true, true); click()
    expect(runtime.store.getState().selection.objectId).toBeNull()
  })
  it('does select visible unlocked geometry', () => {
    const { click, id } = PickingHarness(false, false, false); click()
    expect(runtime.store.getState().selection.objectId).toBe(id)
  })
  it('does not reintroduce skinned meshes through the entity registry', () => {
    const { root, click } = PickingHarness(false, false, false)
    const skinned = new THREE.SkinnedMesh(); skinned.raycast = vi.fn(); root.add(skinned)
    click()
    expect(skinned.raycast).not.toHaveBeenCalled()
  })
})

describe('camera world/local rendering agreement', () => {
  function cameraFixture() {
    const state = runtime.store.getState()
    state.patchSceneConfig({ position: { x: 5, y: 2, z: -3 }, rotation: { x: 15, y: 60, z: -5 }, scale: 2 })
    const data = buildCameraFromPreset({ preset: CAMERA_PRESETS[1], id: 'camera', name: 'Camera' })
    const id = state.addCamera(data)
    const c = runtime.store.getState().activeScene().sceneConfig
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...[c.rotation.x, c.rotation.y, c.rotation.z].map(THREE.MathUtils.degToRad) as [number, number, number]))
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(c.position.x, c.position.y, c.position.z), rotation, new THREE.Vector3(c.scale, c.scale, c.scale))
    const expected = new THREE.Vector3(data.position.x, data.position.y, data.position.z).applyMatrix4(matrix)
    return { id, data, expected, matrix }
  }
  it('places POV at the transformed camera model world position', () => {
    const { id, expected } = cameraFixture(); runtime.store.getState().enterCameraPOV(id)
    const { camera } = setup()
    expect(camera.position.distanceTo(expected)).toBeLessThan(1e-6)
  })
  it('resets a transformed POV to the world home shown by the free view', () => {
    const { id } = cameraFixture(); runtime.store.getState().enterCameraPOV(id)
    const { camera, frame } = setup()
    ;(runtime.api.current as { resetView: () => void }).resetView(); frame()
    expect(camera.position.distanceTo(new THREE.Vector3(FREE_CAMERA_HOME.position.x, FREE_CAMERA_HOME.position.y, FREE_CAMERA_HOME.position.z))).toBeLessThan(1e-6)
  })
  it('rejects focus movement at a readonly camera playhead without visual drift', () => {
    const { id } = cameraFixture(); const state = runtime.store.getState()
    state.addTrajectoryClip(id, 0, 4); state.setTimelineContext({ currentTime: 2 }); state.enterCameraPOV(id)
    const registry = createSceneRefRegistry(); const target = new THREE.Object3D(); target.position.set(-7, 0, 2); registry.register('target', target); runtime.registry = registry
    const { camera, frame } = setup(); const start = camera.position.clone()
    ;(runtime.api.current as { focusEntity: (id: string) => void }).focusEntity('target'); frame()
    expect(camera.position.distanceTo(start)).toBeLessThan(1e-6)
  })
  it('writes world navigation back in scene-local coordinates', () => {
    const { id, matrix } = cameraFixture(); runtime.store.getState().enterCameraPOV(id)
    const { camera, frame } = setup(); key('KeyD'); frame()
    const data = runtime.store.getState().findCamera(id)!
    expect(new THREE.Vector3(data.position.x, data.position.y, data.position.z).applyMatrix4(matrix).distanceTo(camera.position)).toBeLessThan(1e-5)
  })
  it('undo restores a whole POV keyboard gesture while retaining the camera', () => {
    const { id, data } = cameraFixture(); runtime.store.getState().enterCameraPOV(id)
    const { frame } = setup(); key('KeyD'); frame(); frame()
    runtime.store.getState().undo()
    expect(runtime.store.getState().findCamera(id)?.position).toEqual(data.position)
  })
  it('renders PIP from the same transformed world camera pose', () => {
    const { expected } = cameraFixture(); const render = vi.fn()
    runtime.registry = createSceneRefRegistry()
    runtime.three = { scene: new THREE.Scene(), size: { width: 100, height: 100 }, gl: { getViewport: vi.fn(), getScissor: vi.fn(), getScissorTest: () => false, setViewport: vi.fn(), setScissor: vi.fn(), setScissorTest: vi.fn(), render } }
    PipRenderer({ rectRef: { current: { x: 0, y: 0, width: 40, height: 40 } } })
    runtime.frames.forEach((fn) => fn(null, 0.1))
    const camera = render.mock.calls[0][1] as THREE.Camera
    expect(camera.position.distanceTo(expected)).toBeLessThan(1e-6)
  })
  it('restores PIP temporary visibility and renderer state if rendering throws', () => {
    cameraFixture(); const scene = new THREE.Scene(); const helper = new THREE.Object3D(); helper.userData.directorEditorOnly = true; scene.add(helper)
    runtime.registry = createSceneRefRegistry()
    const gl = { getViewport: (target: THREE.Vector4) => target.set(1, 2, 90, 80), getScissor: (target: THREE.Vector4) => target.set(3, 4, 50, 60), getScissorTest: () => true, setViewport: vi.fn(), setScissor: vi.fn(), setScissorTest: vi.fn(), render: () => { throw new Error('context lost') } }
    runtime.three = { scene, size: { width: 100, height: 100 }, gl }
    PipRenderer({ rectRef: { current: { x: 0, y: 0, width: 40, height: 40 } } })
    expect(() => runtime.frames[0](null, 0.1)).toThrow('context lost')
    expect(helper.visible).toBe(true)
    expect(gl.setViewport.mock.calls.at(-1)![0]).toEqual(new THREE.Vector4(1, 2, 90, 80))
    expect(gl.setScissor.mock.calls.at(-1)![0]).toEqual(new THREE.Vector4(3, 4, 50, 60))
  })
  it('renders an offline capture from the same transformed world camera pose', async () => {
    const { id, expected } = cameraFixture(); const registry = createSceneRefRegistry(); runtime.registry = registry
    runtime.three = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), gl: {} }
    CaptureBinder(); cleanups = runtime.effects.map((effect) => effect()).filter((fn): fn is () => void => Boolean(fn))
    await registry.captureFrame({ cameraId: id, width: 100, height: 100, burnLabels: false })
    const camera = runtime.capture.mock.calls.at(-1)![2] as THREE.Camera
    expect(camera.position.distanceTo(expected)).toBeLessThan(1e-6)
  })
})

describe('multi-entity shortcut undo boundaries', () => {
  function HotkeyHarness() {
    useDirectorHotkeys({ scopeRef: { current: 'viewport' }, handlers: {} })
    cleanups = runtime.effects.map((effect) => effect()).filter((fn): fn is () => void => Boolean(fn))
  }
  function object(name: string) { return runtime.store.getState().addObject({ name, type: 'cube', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, locked: false }) }
  it('one undo restores all objects deleted by one Backspace', () => {
    const a = object('a'), b = object('b'); runtime.store.getState().select({ objectId: a, multiObjectIds: [a, b] }); HotkeyHarness()
    key('Backspace'); expect(runtime.store.getState().activeScene().objects).toHaveLength(0)
    runtime.store.getState().undo(); expect(runtime.store.getState().activeScene().objects).toHaveLength(2)
  })
  it('ungroups every selected group and restores them together on undo', () => {
    const state = runtime.store.getState()
    const groupA = state.groupObjects([object('a'), object('b')], 'A')!
    const groupB = state.groupObjects([object('c'), object('d')], 'B')!
    state.select({ objectId: groupA, multiObjectIds: [groupA, groupB] }); HotkeyHarness()
    key('KeyG', { ...META, shiftKey: true })
    expect(runtime.store.getState().activeScene().objects.filter((item) => item.type === 'group')).toHaveLength(0)
    state.undo(); expect(runtime.store.getState().activeScene().objects.filter((item) => item.type === 'group')).toHaveLength(2)
  })
  it('clones all selected roots as one undo operation', () => {
    const a = object('a'), b = object('b'); runtime.store.getState().select({ objectId: a, multiObjectIds: [a, b] }); HotkeyHarness()
    key('KeyD', { ...META }); expect(runtime.store.getState().activeScene().objects).toHaveLength(4)
    runtime.store.getState().undo(); expect(runtime.store.getState().activeScene().objects).toHaveLength(2)
  })
})

describe('character label visibility and world anchors', () => {
  function labelFixture(visible: boolean, auxiliary = false) {
    const state = runtime.store.getState(), base = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, locked: false }
    const parentId = state.addObject({ ...base, name: 'Group', type: 'group', visible, isAuxiliary: auxiliary })
    const id = state.addObject({ ...base, name: 'Character', type: 'character', parentId })
    const parent = new THREE.Group(); parent.visible = visible; parent.scale.setScalar(2); parent.rotation.z = Math.PI / 3
    const root = new THREE.Group(); parent.add(root); parent.updateMatrixWorld(true)
    const registry = createSceneRefRegistry(); registry.register(id, root); registry.register(parentId, parent); runtime.registry = registry
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100); camera.position.z = 10; camera.updateMatrixWorld(true)
    runtime.three = { camera, size: { width: 100, height: 100 }, scene: new THREE.Scene(), gl: {} }
    const onLabels = vi.fn(); LabelProjector({ onLabels }); CaptureBinder()
    cleanups = runtime.effects.map((effect) => effect()).filter((fn): fn is () => void => Boolean(fn))
    runtime.frames.forEach((fn) => fn(null, 0.1)); runtime.labels.mockClear()
    return { root, camera, onLabels, capture: () => registry.captureFrame({ cameraId: 'free', width: 100, height: 100, burnLabels: true }) }
  }
  it('hides labels in both viewport and capture when an ancestor is hidden', async () => {
    const { onLabels, capture } = labelFixture(false); await capture()
    expect(onLabels).not.toHaveBeenCalled()
    expect(runtime.labels.mock.calls[0][1]).toEqual([])
  })
  it('uses the transformed local head anchor in viewport and capture', async () => {
    const { root, camera, onLabels, capture } = labelFixture(true); await capture()
    const expected = root.localToWorld(new THREE.Vector3(0, 1.75 * 1.05, 0)).project(camera)
    const labels = [onLabels.mock.calls[0][0][0], runtime.labels.mock.calls[0][1][0]] as { x: number; y: number }[]
    for (const label of labels) { expect(label.x).toBeCloseTo((expected.x * 0.5 + 0.5) * 100); expect(label.y).toBeCloseTo((-expected.y * 0.5 + 0.5) * 100) }
  })
  it('keeps auxiliary-group labels in the viewport but excludes them from output', async () => {
    const { onLabels, capture } = labelFixture(true, true); await capture()
    expect(onLabels.mock.calls[0][0]).toHaveLength(1)
    expect(runtime.labels.mock.calls[0][1]).toEqual([])
  })
  it('hides portal skeletons and IK controls with their parent group', () => {
    const { root } = labelFixture(false)
    const state = runtime.store.getState(), objectId = state.activeScene().objects.find((object) => object.type === 'character')!.id
    state.patchSceneConfig({ showSkeleton: true }); state.select({ objectId }); state.setIkModeEnabled(true)
    const boneIndex = new Map<string, THREE.Bone>()
    expect(SkeletonVisual({ objectId, rig: 'mixamo', root, boneIndex })).toBeNull()
    expect(SkeletonHandles({ objectId, rig: 'mixamo', selected: true, api: { boneIndex } as CharacterRigApi })).toBeNull()
  })
})

describe('camera target hierarchy evaluation', () => {
  function targetFixture() {
    const state = runtime.store.getState(), base = { rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, locked: false }
    const parentId = state.addObject({ ...base, name: 'Group', type: 'group', position: { x: 10, y: 0, z: 0 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 2, y: 2, z: 2 } })
    const id = state.addObject({ ...base, name: 'Target', type: 'character', position: { x: 1, y: 0, z: 0 }, parentId })
    const cameraId = state.addCamera({ ...buildCameraFromPreset({ preset: CAMERA_PRESETS[1], id: 'camera', name: 'Camera' }), position: { x: 0, y: 2, z: 10 } })
    runtime.registry = createSceneRefRegistry()
    return { state, id, parentId, cameraId }
  }
  function PlaybackHarness() {
    useTimelinePlayback()
    runtime.frames.forEach((frame) => frame(null, 0))
  }
  it('aims at the scene-space position of a target in a rotated scaled group', () => {
    const { state, id, cameraId } = targetFixture()
    state.updateCamera(cameraId, { lookAtType: 'object', lookAtObjectId: id }); PlaybackHarness()
    const aim = runtime.store.getState().evaluatedPoses[cameraId].lookAtCoords!
    expect(aim.x).toBeCloseTo(10); expect(aim.z).toBeCloseTo(-2)
  })
  it('follows target movement after converting its parent-space displacement', () => {
    const { state, id, cameraId } = targetFixture()
    const clip = state.addTrajectoryClip(id, 0, 2)!
    state.insertWaypointsBatch(id, clip.id, [{ time: 0, x: 1, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 }, { time: 2, x: 2, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 }])
    state.updateCamera(cameraId, { rigType: 'follow', lookAtObjectId: id }); state.setTimelineContext({ currentTime: 2 }); PlaybackHarness()
    const position = runtime.store.getState().evaluatedPoses[cameraId].position
    expect(position.x).toBeCloseTo(0); expect(position.z).toBeCloseTo(8)
  })
  it.each(['live', 'bake'] as const)('keeps %s closeup position and facing relative to the complete target hierarchy', (mode) => {
    const { state, id, cameraId } = targetFixture()
    const clip = state.addCloseupClip(cameraId, id, 0, 4)!
    let position: { x: number; z: number }
    if (mode === 'live') { PlaybackHarness(); position = runtime.store.getState().evaluatedPoses[cameraId].position }
    else { state.convertCloseupToTrajectory(cameraId, clip.id); position = runtime.store.getState().findCamera(cameraId)!.motionTrajectory![0] }
    expect(position.x).toBeCloseTo(11.2); expect(position.z).toBeCloseTo(-2)
  })
  it('uses animated ancestor position now and ancestor heading at the orbit clip start', () => {
    const { state, id, parentId, cameraId } = targetFixture()
    const path = state.addTrajectoryClip(parentId, 0, 4)!
    state.insertWaypointsBatch(parentId, path.id, [{ time: 0, x: 10, y: 0, z: 0, yaw: 90, pitch: 0, roll: 0 }, { time: 4, x: 14, y: 0, z: 0, yaw: 210, pitch: 0, roll: 0 }])
    const closeup = state.addCloseupClip(cameraId, id, 0, 4)!
    state.updateCloseupClip(cameraId, closeup.id, { motionPreset: 'orbit' }); state.setTimelineContext({ currentTime: 2 }); PlaybackHarness()
    const target = new THREE.Vector3(1, 0, 0).multiplyScalar(2).applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(150)).add(new THREE.Vector3(12, 0, 0))
    const position = runtime.store.getState().evaluatedPoses[cameraId].position
    expect(position.x).toBeCloseTo(target.x - 1.2); expect(position.z).toBeCloseTo(target.z)
  })
})
