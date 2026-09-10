import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { transformCameraPose } from './cameraCoordinateSpace'
import { invertFrame, localFrame } from './sceneObjectGraph'

const rotation = { x: 17, y: 71, z: -9 }
const transform = { position: { x: 6, y: -2, z: 3 }, rotation, scale: { x: 2, y: 2, z: 2 } }
const quaternion = (pose: { pitch: number; yaw: number; roll: number }) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...[pose.pitch, pose.yaw, pose.roll].map(THREE.MathUtils.degToRad) as [number, number, number], 'YXZ'))

describe('logical camera coordinate-space conversion', () => {
  it.each([{ pitch: 21, yaw: 333, roll: 19 }, { pitch: 90, yaw: 61, roll: 7 }, { pitch: -90, yaw: 120, roll: -11 }])('matches a three matrix oracle and inverse at %j', (angles) => {
    const pose = { ...angles, position: { x: -1, y: 3, z: 7 }, fov: 47 }
    const parent = new THREE.Quaternion().setFromEuler(new THREE.Euler(...[rotation.x, rotation.y, rotation.z].map(THREE.MathUtils.degToRad) as [number, number, number]))
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(6, -2, 3), parent, new THREE.Vector3(2, 2, 2))
    const actual = transformCameraPose(pose, localFrame(transform))
    const expected = new THREE.Vector3(-1, 3, 7).applyMatrix4(matrix)
    expect(new THREE.Vector3(actual.position.x, actual.position.y, actual.position.z).distanceTo(expected)).toBeLessThan(1e-8)
    expect(quaternion(actual).angleTo(parent.multiply(quaternion(pose)))).toBeLessThan(1e-7)
    expect(actual.fov).toBe(pose.fov)
    const restored = transformCameraPose(actual, invertFrame(localFrame(transform)))
    expect(quaternion(restored).angleTo(quaternion(pose))).toBeLessThan(1e-7)
    expect(new THREE.Vector3(restored.position.x, restored.position.y, restored.position.z).distanceTo(new THREE.Vector3(-1, 3, 7))).toBeLessThan(1e-8)
  })
})
