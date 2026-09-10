import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { poleRestPosition, rotateLimbPlaneToward } from './characterRig'

// 一条「肩 → 肘 → 手」的两节肢体：肩在原点，上臂沿 +x 0.3，前臂折向 +z 再向 +x（肘在 (0.3,0,0)，手在 (0.5,0,0.2)）
function buildLimb(): { root: THREE.Bone; mid: THREE.Bone; end: THREE.Bone; group: THREE.Group } {
  const group = new THREE.Group()
  const root = new THREE.Bone()
  const mid = new THREE.Bone()
  const end = new THREE.Bone()
  mid.position.set(0.3, 0, 0)
  end.position.set(0.2, 0, 0.2)
  root.add(mid)
  mid.add(end)
  group.add(root)
  group.updateMatrixWorld(true)
  return { root, mid, end, group }
}

describe('极向量几何', () => {
  it('静止位 = 中节偏离 根→末端 轴的方向 × distance，落在肢体平面外侧', () => {
    const { root, mid, end } = buildLimb()
    const out = poleRestPosition(root, mid, end, new THREE.Vector3(0, 0, 1), 0.35, new THREE.Vector3())
    const midWorld = mid.getWorldPosition(new THREE.Vector3())
    // 手在 +z 侧，肘相对轴偏向 −z → 极向量在肘的 −z 侧 0.35m
    expect(out.distanceTo(midWorld)).toBeCloseTo(0.35, 3)
    expect(out.z).toBeLessThan(midWorld.z)
  })

  it('肢体伸直时退回默认方向', () => {
    const { root, mid, end } = buildLimb()
    end.position.set(0.3, 0, 0)
    root.updateMatrixWorld(true)
    const out = poleRestPosition(root, mid, end, new THREE.Vector3(0, -1, 0), 0.2, new THREE.Vector3())
    expect(out.y).toBeCloseTo(-0.2, 3)
  })

  it('拖极向量到另一侧：整条肢体绕 根→末端 轴转，末端位置不变、肘转到靶点那一侧', () => {
    const { root, mid, end } = buildLimb()
    const endBefore = end.getWorldPosition(new THREE.Vector3())
    const rootBefore = root.getWorldPosition(new THREE.Vector3())
    // 靶点放到肢体平面的另一侧（+z 方向偏上）
    rotateLimbPlaneToward(root, mid, end, new THREE.Vector3(0.3, 0.5, 0.1))
    const endAfter = end.getWorldPosition(new THREE.Vector3())
    const midAfter = mid.getWorldPosition(new THREE.Vector3())
    expect(endAfter.distanceTo(endBefore)).toBeLessThan(1e-6)
    expect(root.getWorldPosition(new THREE.Vector3()).distanceTo(rootBefore)).toBeLessThan(1e-6)
    // 肘的「偏离轴分量」应指向 +y（靶点那一侧）
    const axis = endAfter.clone().sub(rootBefore).normalize()
    const side = midAfter.clone().sub(rootBefore)
    side.addScaledVector(axis, -side.dot(axis))
    expect(side.y).toBeGreaterThan(0.05)
  })
})
