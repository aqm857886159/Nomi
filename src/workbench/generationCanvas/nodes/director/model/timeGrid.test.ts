import { describe, expect, it } from 'vitest'
import type { DirectorCamera, DirectorObject } from './directorTypes'
import {
  DIRECTOR_MAX_DURATION_SECONDS,
  ensureDurationSeconds,
  entityClips,
  quantizeToFrame,
  sameFrameTime,
  sceneContentEndSeconds,
  secondsToFrame,
} from './timeGrid'

function object(overrides: Partial<DirectorObject> = {}): DirectorObject {
  return {
    id: 'o',
    name: 'o',
    type: 'character',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    locked: false,
    ...overrides,
  }
}

function camera(overrides: Partial<DirectorCamera> = {}): DirectorCamera {
  return { id: 'c', name: 'c', position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, roll: 0, fov: 50, focalLengthMm: 26, ...overrides }
}

describe('timeGrid', () => {
  it('quantizes to the 30fps grid and compares within half a frame', () => {
    expect(quantizeToFrame(1.02)).toBeCloseTo(31 / 30, 6)
    expect(quantizeToFrame(1.0166)).toBeCloseTo(1, 6)
    expect(secondsToFrame(2.5)).toBe(75)
    expect(sameFrameTime(1, 1 + 1 / 90)).toBe(true)
    expect(sameFrameTime(1, 1 + 1 / 30)).toBe(false)
  })

  it('collects every clip kind of an entity', () => {
    const o = object({
      trajectoryClips: [{ id: 't', startTime: 0, endTime: 2, startFrame: 0, endFrame: 60 }],
      actionClips: [{ id: 'a', name: 'walk', clipType: 'action', startTime: 1, endTime: 3, startFrame: 30, endFrame: 90 }],
      lookAtClips: [
        {
          id: 'l', name: '', targetType: 'camera', targetId: '', enablePitch: false, targetHeightOffset: 0, targetBodyPart: 'face',
          startTime: 2, endTime: 5, startFrame: 60, endFrame: 150, blendInDuration: 0.4, blendOutDuration: 0.4, weight: 1, clampingAngle: 80,
        },
      ],
    })
    expect(entityClips(o)).toHaveLength(3)
  })

  it('content end is the max clip end across objects and cameras, 0 when empty', () => {
    const scene = {
      objects: [object({ trajectoryClips: [{ id: 't', startTime: 0, endTime: 2.5, startFrame: 0, endFrame: 75 }] })],
      cameras: [
        camera({
          closeupClips: [
            {
              id: 'k', entityId: 'c', targetObjectId: 'o', startTime: 3, endTime: 7, startFrame: 90, endFrame: 210, anchor: 'face',
              facingMode: 'look_at_target', azimuth: 'front', horizontalAngle: 0, pitchAngle: 0, distance: 1.2, height: 0, motionPreset: 'static',
            },
          ],
        }),
      ],
    }
    expect(sceneContentEndSeconds(scene)).toBe(7)
    expect(sceneContentEndSeconds({ objects: [object()], cameras: [] })).toBe(0)
  })

  it('ensureDuration grows with a margin but never shrinks or exceeds the cap', () => {
    expect(ensureDurationSeconds(10, 12)).toBe(14)
    expect(ensureDurationSeconds(20, 5)).toBe(20)
    expect(ensureDurationSeconds(10, 59.5)).toBe(DIRECTOR_MAX_DURATION_SECONDS)
  })
})
