import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './directorProject'
import type { DirectorObject } from './directorTypes'
import { collectSnapCandidates, snapTime, snapToleranceSeconds } from './timelineSnap'

describe('timelineSnap', () => {
  it('collects playhead, clip edges and waypoints, skipping the dragged clip/waypoints', () => {
    const scene = createDefaultProject('s').scenes[0]
    const object: DirectorObject = {
      id: 'a',
      name: 'a',
      type: 'cube',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      locked: false,
      inTimeline: true,
      trajectoryClips: [
        { id: 't1', startTime: 0, endTime: 2, startFrame: 0, endFrame: 60 },
        { id: 't2', startTime: 4, endTime: 6, startFrame: 120, endFrame: 180 },
      ],
      motionTrajectory: [{ id: 'w1', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, time: 1, frameIndex: 30, clipId: 't1' }],
    }
    scene.objects = [object]
    const candidates = collectSnapCandidates(scene, 5, { clipId: 't2', waypointIds: ['w1'] })
    expect(candidates).toEqual([
      { time: 5, kind: 'playhead' },
      { time: 0, kind: 'clipEdge' },
      { time: 2, kind: 'clipEdge' },
    ])
  })

  it('snaps to the nearest candidate inside the tolerance only', () => {
    const candidates = [
      { time: 2, kind: 'clipEdge' as const },
      { time: 3, kind: 'keyframe' as const },
    ]
    expect(snapTime(2.05, candidates, 0.1)).toEqual({ time: 2, snapped: { time: 2, kind: 'clipEdge' } })
    expect(snapTime(2.5, candidates, 0.1)).toEqual({ time: 2.5, snapped: null })
    expect(snapToleranceSeconds(60)).toBeCloseTo(0.1)
    expect(snapToleranceSeconds(0)).toBe(0)
  })
})
