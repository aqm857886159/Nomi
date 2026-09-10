import { describe, expect, it } from 'vitest'
import { createCloseupClip, findCloseupClipAt, motionOffsets, solveCloseupPose } from './closeupRig'

describe('closeupRig', () => {
  const clip = createCloseupClip({ id: 'c1', entityId: 'cam', targetObjectId: 'obj', startTime: 1, duration: 4 })

  it('creates a face-anchored static front closeup by default, quantized to frames', () => {
    expect(clip.startTime).toBe(1)
    expect(clip.endTime).toBe(5)
    expect(clip.startFrame).toBe(30)
    expect(clip.endFrame).toBe(150)
    expect(clip.anchor).toBe('face')
    expect(clip.distance).toBe(1.2)
    expect(clip.motionPreset).toBe('static')
  })

  it('motion presets match the specified offsets at full progress', () => {
    expect(motionOffsets('push_in', 1).distanceScale).toBeCloseTo(0.5)
    expect(motionOffsets('pull_out', 1).distanceScale).toBeCloseTo(1.5)
    expect(motionOffsets('orbit', 0.5).angleOffsetDeg).toBeCloseTo(180)
    expect(motionOffsets('half_arc', 1).angleOffsetDeg).toBeCloseTo(180)
    expect(motionOffsets('crane', 1).heightOffset).toBeCloseTo(1.5)
    expect(motionOffsets('truck', 1).truckOffset).toBeCloseTo(1.2)
    expect(motionOffsets('spiral', 1)).toEqual({ angleOffsetDeg: 360, distanceScale: 0.7, heightOffset: 0.8, truckOffset: 0 })
    expect(motionOffsets('static', 0.7)).toEqual({ angleOffsetDeg: 0, distanceScale: 1, heightOffset: 0, truckOffset: 0 })
  })

  it('places the camera in front of the target at anchor height and looks at the anchor', () => {
    const pose = solveCloseupPose({ clip, currentTime: 1, targetPosition: { x: 2, y: 0, z: 3 }, targetRotationY: 0 })
    expect(pose.position.x).toBeCloseTo(2)
    expect(pose.position.y).toBeCloseTo(1.5)
    expect(pose.position.z).toBeCloseTo(3 + 1.2)
    expect(pose.lookAt).toEqual({ x: 2, y: 1.5, z: 3 })
  })

  it('follows the target yaw: a target facing +X puts the front camera on its +X side', () => {
    const pose = solveCloseupPose({ clip, currentTime: 1, targetPosition: { x: 0, y: 0, z: 0 }, targetRotationY: 90 })
    expect(pose.position.x).toBeCloseTo(1.2)
    expect(pose.position.z).toBeCloseTo(0)
  })

  it('push_in halves the distance by the end of the clip and never goes below 0.3m', () => {
    const pushIn = { ...clip, motionPreset: 'push_in' as const, distance: 0.5 }
    const end = solveCloseupPose({ clip: pushIn, currentTime: 5, targetPosition: { x: 0, y: 0, z: 0 }, targetRotationY: 0 })
    expect(end.position.z).toBeCloseTo(0.3)
  })

  it('orbit uses the reference yaw so a turning target does not break the circle', () => {
    const orbit = { ...clip, motionPreset: 'orbit' as const }
    const mid = solveCloseupPose({
      clip: orbit,
      currentTime: 3,
      targetPosition: { x: 0, y: 0, z: 0 },
      targetRotationY: 45,
      referenceRotationY: 0,
    })
    // 180° around from +Z front → behind the target on -Z
    expect(mid.position.z).toBeCloseTo(-1.2)
    expect(Math.abs(mid.position.x)).toBeLessThan(1e-6)
  })

  it('facing modes return explicit rotations instead of a look-at point', () => {
    const follow = solveCloseupPose({
      clip: { ...clip, facingMode: 'follow_subject_yaw', horizontalAngle: 10 },
      currentTime: 1,
      targetPosition: { x: 0, y: 0, z: 0 },
      targetRotationY: 350,
    })
    expect(follow.lookAt).toBeNull()
    expect(follow.rotation?.y).toBeCloseTo(0)
    const locked = solveCloseupPose({
      clip: { ...clip, facingMode: 'world_locked', horizontalAngle: -30, pitchAngle: 5 },
      currentTime: 1,
      targetPosition: { x: 0, y: 0, z: 0 },
      targetRotationY: 90,
    })
    expect(locked.rotation).toEqual({ x: 5, y: 330, z: 0 })
  })

  it('findCloseupClipAt prefers the clip that ends exactly at t when two overlap at the boundary', () => {
    const a = createCloseupClip({ id: 'a', entityId: 'cam', targetObjectId: 'obj', startTime: 0, duration: 2 })
    const b = createCloseupClip({ id: 'b', entityId: 'cam', targetObjectId: 'obj', startTime: 2, duration: 2 })
    expect(findCloseupClipAt([a, b], 2)?.id).toBe('a')
    expect(findCloseupClipAt([a, b], 3)?.id).toBe('b')
    expect(findCloseupClipAt([a, b], 5)).toBeUndefined()
    expect(findCloseupClipAt(undefined, 1)).toBeUndefined()
  })
})
