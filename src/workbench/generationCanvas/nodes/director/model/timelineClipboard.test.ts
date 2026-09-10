import { describe, expect, it } from 'vitest'
import type { DirectorCamera, DirectorObject } from './directorTypes'
import { canPasteTo, copyClipPayload, relocatePayload } from './timelineClipboard'

const ids = { clipId: () => 'newclip', waypointId: () => 'newwp', keyframeId: () => 'newkf' }

const character: DirectorObject = {
  id: 'a',
  name: 'a',
  type: 'character',
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  visible: true,
  locked: false,
  inTimeline: true,
  trajectoryClips: [{ id: 't1', startTime: 1, endTime: 3, startFrame: 30, endFrame: 90 }],
  motionTrajectory: [
    { id: 'w1', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, time: 1, frameIndex: 30, clipId: 't1' },
    { id: 'w2', x: 1, y: 0, z: 0, yaw: 90, pitch: 0, roll: 0, time: 2.5, frameIndex: 75, clipId: 't1' },
  ],
  actionClips: [{ id: 'p1', name: 'pose', clipType: 'custom_pose', startTime: 4, endTime: 5, startFrame: 120, endFrame: 150, keyframes: [{ id: 'k1', time: 4.5, frame: 135, boneRotations: {} }] }],
}

const cube: DirectorObject = { ...character, id: 'b', type: 'cube', actionClips: undefined }
const camera: DirectorCamera = { id: 'cam', name: 'cam', position: { x: 0, y: 1, z: 3 }, yaw: 0, pitch: 0, roll: 0, fov: 45, focalLengthMm: 29, inTimeline: true, closeupClips: [] }

describe('timelineClipboard', () => {
  it('copies a trajectory clip together with its waypoints', () => {
    const payload = copyClipPayload(character, 'trajectory', 't1')
    expect(payload?.family).toBe('trajectory')
    if (payload?.family === 'trajectory') expect(payload.waypoints.map((waypoint) => waypoint.id)).toEqual(['w1', 'w2'])
  })

  it('enforces paste compatibility per family', () => {
    const trajectory = copyClipPayload(character, 'trajectory', 't1')!
    const pose = copyClipPayload(character, 'action', 'p1')!
    expect(canPasteTo(trajectory, camera)).toBe(true)
    expect(canPasteTo(pose, cube)).toBe(false)
    expect(canPasteTo(pose, character)).toBe(true)
    expect(canPasteTo(pose, camera)).toBe(false)
  })

  it('relocates clip, waypoints and keyframes keeping their relative timing and new ids', () => {
    const trajectory = relocatePayload(copyClipPayload(character, 'trajectory', 't1')!, 10, ids)
    expect(trajectory.clip).toMatchObject({ id: 'newclip', startTime: 10, endTime: 12, startFrame: 300, endFrame: 360 })
    if (trajectory.family === 'trajectory') {
      expect(trajectory.waypoints.map((waypoint) => waypoint.time)).toEqual([10, 11.5])
      expect(trajectory.waypoints.every((waypoint) => waypoint.clipId === 'newclip' && waypoint.id === 'newwp')).toBe(true)
    }
    const pose = relocatePayload(copyClipPayload(character, 'action', 'p1')!, 0, ids)
    if (pose.family === 'action') expect(pose.clip.keyframes?.[0]).toMatchObject({ id: 'newkf', time: 0.5, frame: 15 })
  })
})
