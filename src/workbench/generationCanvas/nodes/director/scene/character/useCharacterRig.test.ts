import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createDirectorStore, type DirectorStore } from '../../model/directorStore'
import { buildCameraFromPreset, CAMERA_PRESETS } from '../../model/cameraPresets'
import type { Vec3 } from '../../model/directorTypes'

const runtime = vi.hoisted(() => ({ store: null as unknown as DirectorStore, frame: () => {}, solve: vi.fn() }))
vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>()
  return { ...actual, default: { ...actual, useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(), useEffect: () => {} } }
})
vi.mock('@react-three/fiber', () => ({ useFrame: (frame: () => void) => { runtime.frame = frame } }))
vi.mock('../../DirectorEditorContext', () => ({ useDirectorStoreApi: () => runtime.store }))
vi.mock('./poseClipLibrary', () => ({ samplePoseClip: () => null, poseClipSourceBind: () => null, preloadPoseClips: async () => {} }))
vi.mock('../../model/lookAtSolve', async (original) => {
  const actual = await original<typeof import('../../model/lookAtSolve')>()
  return { ...actual, solveHeadAim: (input: Parameters<typeof actual.solveHeadAim>[0]) => { runtime.solve(input); return actual.solveHeadAim(input) } }
})
import { useCharacterRig } from './useCharacterRig'

function matrix(position: Vec3, rotation: Vec3, scale: Vec3): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(position.x, position.y, position.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation.x * Math.PI / 180, rotation.y * Math.PI / 180, rotation.z * Math.PI / 180)), new THREE.Vector3(scale.x, scale.y, scale.z))
}

beforeEach(() => { runtime.store = createDirectorStore({ defaultSceneName: 'Scene' }); runtime.solve.mockClear() })

describe('character gaze coordinate ownership', () => {
  it.each(['camera', 'object'] as const)('solves a %s gaze wholly in the character frame under scene and parent transforms', (targetType) => {
    const state = runtime.store.getState(), base = { rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, locked: false }
    const scene = { position: { x: 20, y: 3, z: -4 }, rotation: { x: 10, y: 40, z: 5 }, scale: 1.5 }
    state.patchSceneConfig(scene)
    const parent = { ...base, name: 'Actor group', type: 'group' as const, position: { x: 3, y: 1, z: 2 }, rotation: { x: 0, y: 70, z: 0 }, scale: { x: 2, y: 2, z: 2 } }
    const parentId = state.addObject(parent)
    const actor = { ...base, name: 'Actor', type: 'character' as const, position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 15, z: 0 }, parentId }
    const objectId = state.addObject(actor)
    let targetId: string
    let targetInScene: THREE.Vector3
    if (targetType === 'camera') {
      const position = { x: 5, y: 2, z: 12 }
      targetId = state.addCamera({ ...buildCameraFromPreset({ preset: CAMERA_PRESETS[1], id: 'camera', name: 'Camera' }), position })
      targetInScene = new THREE.Vector3(position.x, position.y, position.z)
    } else {
      const otherParent = { ...base, name: 'Target group', type: 'group' as const, position: { x: -4, y: 0, z: 8 }, rotation: { x: 0, y: -30, z: 0 }, scale: { x: 0.5, y: 0.5, z: 0.5 } }
      const otherParentId = state.addObject(otherParent)
      const position = { x: 1, y: 0, z: 2 }
      targetId = state.addObject({ ...base, name: 'Target', type: 'character', position, parentId: otherParentId })
      targetInScene = new THREE.Vector3(position.x, position.y, position.z).applyMatrix4(matrix(otherParent.position, otherParent.rotation, otherParent.scale)).add(new THREE.Vector3(0, 1.5, 0))
    }
    const clip = state.addLookAtClip(objectId, 'at_time', 0, 4)!
    state.updateLookAtClip(objectId, clip.id, { targetType, targetId, blendInDuration: 0, blendOutDuration: 0, enablePitch: true })
    const sceneMatrix = matrix(scene.position, scene.rotation, { x: scene.scale, y: scene.scale, z: scene.scale })
    const root = new THREE.Group(); root.matrixAutoUpdate = false
    root.matrix.copy(sceneMatrix).multiply(matrix(parent.position, parent.rotation, parent.scale)).multiply(matrix(actor.position, actor.rotation, actor.scale))
    const head = new THREE.Bone(); head.name = 'mixamorigHead'; head.position.y = 1.6; root.add(head); root.updateMatrixWorld(true)
    function CharacterHarness() { return useCharacterRig({ objectId, rig: 'mixamo', root, skinned: null, mountRef: { current: null }, mountBaseY: 0 }) }
    CharacterHarness(); runtime.frame()
    const actual = runtime.solve.mock.calls[0][0] as { headPosition: Vec3; targetPosition: Vec3; bodyYaw: number }
    const expectedTarget = root.worldToLocal(targetInScene.applyMatrix4(sceneMatrix))
    expect(actual.headPosition.x).toBeCloseTo(0); expect(actual.headPosition.y).toBeCloseTo(1.6); expect(actual.headPosition.z).toBeCloseTo(0)
    expect(actual.targetPosition.x).toBeCloseTo(expectedTarget.x); expect(actual.targetPosition.y).toBeCloseTo(expectedTarget.y); expect(actual.targetPosition.z).toBeCloseTo(expectedTarget.z)
    expect(actual.bodyYaw).toBe(0)
  })
})
