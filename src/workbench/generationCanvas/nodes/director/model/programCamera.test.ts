import { describe, expect, it } from 'vitest'
import type { DirectorCamera } from './directorTypes'
import { orderedCameraIds, programCameraIdAt } from './programCamera'

function camera(id: string, clips: Array<[number, number]>, closeups: Array<[number, number]> = []): DirectorCamera {
  return {
    id,
    name: id,
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    roll: 0,
    fov: 50,
    focalLengthMm: 26,
    trajectoryClips: clips.map(([startTime, endTime], index) => ({ id: `${id}-t${index}`, startTime, endTime, startFrame: startTime * 30, endFrame: endTime * 30 })),
    closeupClips: closeups.map(([startTime, endTime], index) => ({
      id: `${id}-c${index}`, entityId: id, targetObjectId: 'o', startTime, endTime, startFrame: startTime * 30, endFrame: endTime * 30,
      anchor: 'face', facingMode: 'look_at_target', azimuth: 'front', horizontalAngle: 0, pitchAngle: 0, distance: 1.2, height: 0, motionPreset: 'static',
    })),
  }
}

describe('programCamera', () => {
  const a = camera('a', [[0, 2]])
  const b = camera('b', [[1, 4]], [[5, 6]])

  it('track order decides priority when clips overlap; unlisted cameras come after listed ones', () => {
    expect(orderedCameraIds([a, b], ['b'])).toEqual(['b', 'a'])
    expect(programCameraIdAt(1.5, [a, b], [])).toBe('a')
    expect(programCameraIdAt(1.5, [a, b], ['b', 'a'])).toBe('b')
  })

  it('closeup clips count as coverage and gaps are black (null)', () => {
    expect(programCameraIdAt(5.5, [a, b], [])).toBe('b')
    expect(programCameraIdAt(4.5, [a, b], [])).toBeNull()
    expect(programCameraIdAt(0, [], [])).toBeNull()
  })
})
