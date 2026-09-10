import { describe, expect, it } from 'vitest'
import type { DirectorCamera, DirectorObject } from './directorTypes'
import { findWaypointAt, resolveEditLayer } from './editLayer'

const clip = { id: 't', startTime: 1, endTime: 3, startFrame: 30, endFrame: 90 }

function object(overrides: Partial<DirectorObject> = {}): DirectorObject {
  return {
    id: 'o', name: 'o', type: 'character', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    visible: true, locked: false, ...overrides,
  }
}

describe('editLayer', () => {
  it('rest when the entity has no clips and no waypoints', () => {
    expect(resolveEditLayer(object(), { currentTime: 2 }, false)).toBe('rest')
  })

  it('keyframe when the playhead sits on a waypoint (within half a frame), readonly elsewhere inside a clip', () => {
    const entity = object({
      trajectoryClips: [clip],
      motionTrajectory: [
        { id: 'w1', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, time: 1, frameIndex: 30, clipId: 't' },
        { id: 'w2', x: 1, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, time: 3, frameIndex: 90, clipId: 't' },
      ],
    })
    expect(resolveEditLayer(entity, { currentTime: 1 + 1 / 90 }, false)).toBe('keyframe')
    expect(resolveEditLayer(entity, { currentTime: 2 }, false)).toBe('evaluated-readonly')
    expect(resolveEditLayer(entity, { currentTime: 5 }, false)).toBe('evaluated-readonly')
    expect(findWaypointAt(entity.motionTrajectory, 2.99)?.id).toBe('w2')
    expect(findWaypointAt(entity.motionTrajectory, 2, undefined, 't')).toBeUndefined()
  })

  it('an explicitly selected waypoint always edits that keyframe', () => {
    expect(resolveEditLayer(object(), { currentTime: 0, activeWaypointId: 'w' }, false)).toBe('keyframe')
  })

  it('cameras inside a closeup clip are readonly', () => {
    const camera: DirectorCamera = {
      id: 'c', name: 'c', position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, roll: 0, fov: 50, focalLengthMm: 26,
      closeupClips: [{
        id: 'k', entityId: 'c', targetObjectId: 'o', startTime: 0, endTime: 4, startFrame: 0, endFrame: 120, anchor: 'face',
        facingMode: 'look_at_target', azimuth: 'front', horizontalAngle: 0, pitchAngle: 0, distance: 1.2, height: 0, motionPreset: 'static',
      }],
    }
    expect(resolveEditLayer(camera, { currentTime: 2 }, true)).toBe('evaluated-readonly')
    expect(resolveEditLayer(camera, { currentTime: 6 }, true)).toBe('rest')
  })
})
