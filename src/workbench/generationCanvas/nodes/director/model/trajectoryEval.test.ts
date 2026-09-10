import { describe, expect, it } from 'vitest'
import { createTrajectoryClip } from './clips'
import type { DirectorObject, Waypoint } from './directorTypes'
import { evaluateEntityTransform, lerpAngleDeg, sampleWaypoints } from './trajectoryEval'

function wp(id: string, time: number, x: number, z: number, yaw = 0): Waypoint {
  return { id, x, y: 0, z, yaw, pitch: 0, roll: 0, time, frameIndex: Math.round(time * 30), clipId: 'c' }
}

function object(overrides: Partial<DirectorObject> = {}): DirectorObject {
  return {
    id: 'o', name: 'o', type: 'character', position: { x: 9, y: 0, z: 9 }, rotation: { x: 0, y: 45, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    visible: true, locked: false, ...overrides,
  }
}

describe('trajectoryEval', () => {
  it('lerpAngleDeg takes the shortest arc across 0/360', () => {
    expect(lerpAngleDeg(350, 10, 0.5)).toBeCloseTo(360)
    expect(lerpAngleDeg(10, 350, 0.5)).toBeCloseTo(0)
    expect(lerpAngleDeg(0, 90, 0.25)).toBeCloseTo(22.5)
  })

  it('two waypoints interpolate linearly by time, angles included', () => {
    const sample = sampleWaypoints([wp('a', 0, 0, 0, 0), wp('b', 2, 4, 0, 90)], 1)
    expect(sample?.position.x).toBeCloseTo(2)
    expect(sample?.rotation.y).toBeCloseTo(45)
  })

  it('three or more waypoints pass through the control points (Catmull-Rom) at keyframe times', () => {
    const points = [wp('a', 0, 0, 0), wp('b', 1, 1, 1), wp('c', 2, 2, 0)]
    const atB = sampleWaypoints(points, 1)
    expect(atB?.position.x).toBeCloseTo(1)
    expect(atB?.position.z).toBeCloseTo(1)
    const mid = sampleWaypoints(points, 0.5)
    expect(mid?.position.x).toBeGreaterThan(0)
    expect(mid?.position.x).toBeLessThan(1)
  })

  it('evaluate: sample inside the clip, hold on the last waypoint after it, rest elsewhere', () => {
    const clip = createTrajectoryClip('c', 0, 2)
    const entity = object({ trajectoryClips: [clip], motionTrajectory: [wp('a', 0, 0, 0, 0), wp('b', 2, 4, 0, 90)] })
    expect(evaluateEntityTransform(entity, 1)).toMatchObject({ source: 'sample', sourceClipId: 'c' })
    const held = evaluateEntityTransform(entity, 5)
    expect(held.source).toBe('hold')
    expect(held.position.x).toBe(4)
    expect(held.rotation.y).toBe(90)
    expect(evaluateEntityTransform(object(), 1)).toEqual({ position: { x: 9, y: 0, z: 9 }, rotation: { x: 0, y: 45, z: 0 }, source: 'rest' })
  })
})
