import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { fitEditorCameraToScene } from './scene3dFitView'
import { createDefaultScene3DState } from './scene3dSerializer'

// 视锥夹角：eye→point 与视向的夹角（度）。包围球 sin(半角) 拟合保证全部内容 ≤ 半 FOV(27.5°)。
function viewAngleDeg(
  pose: { position: [number, number, number]; target: [number, number, number] },
  point: [number, number, number],
): number {
  const eye = new THREE.Vector3(...pose.position)
  const dir = new THREE.Vector3(...pose.target).sub(eye).normalize()
  const toPoint = new THREE.Vector3(...point).sub(eye).normalize()
  return (Math.acos(THREE.MathUtils.clamp(dir.dot(toPoint), -1, 1)) * 180) / Math.PI
}

describe('fitEditorCameraToScene', () => {
  it('默认场景：假人与相机1 都进 55° 视锥（治「进门看不见相机」）', () => {
    const state = createDefaultScene3DState()
    const pose = fitEditorCameraToScene(state.objects, state.cameras)
    const halfFov = 55 / 2
    state.objects.forEach((object) => {
      expect(viewAngleDeg(pose, object.position)).toBeLessThan(halfFov)
    })
    state.cameras.forEach((camera) => {
      expect(viewAngleDeg(pose, camera.position)).toBeLessThan(halfFov)
    })
  })

  it('回归钉子：旧默认机位 [-5,3.2,6] 恰好把相机1 排出视锥（这就是要修的 bug）', () => {
    const state = createDefaultScene3DState()
    const legacyPose = { position: [-5, 3.2, 6] as [number, number, number], target: [0, 0.75, 0] as [number, number, number] }
    const camera1 = state.cameras[0]
    expect(viewAngleDeg(legacyPose, camera1.position)).toBeGreaterThan(55 / 2)
  })

  it('默认场景的出厂 editorCamera 就是 fit 结果（单一真相源）', () => {
    const state = createDefaultScene3DState()
    const pose = fitEditorCameraToScene(state.objects, state.cameras)
    expect(state.editorCamera.position).toEqual(pose.position)
    expect(state.editorCamera.target).toEqual(pose.target)
  })

  it('空场景回退旧默认机位', () => {
    const pose = fitEditorCameraToScene([], [])
    expect(pose.position).toEqual([-5, 3.2, 6])
    expect(pose.target).toEqual([0, 0.75, 0])
  })
})
