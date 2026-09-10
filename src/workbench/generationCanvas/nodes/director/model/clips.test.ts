import { describe, expect, it } from 'vitest'
import {
  clipBounds,
  clipsOverlap,
  createTrajectoryClip,
  duplicateClipAfter,
  findFreeStart,
  splitClipAt,
  trimClipToPlayhead,
  upsertWaypointAt,
  waypointBelongsToClip,
  waypointTimeBounds,
  fitClipAt,
} from './clips'
import type { Waypoint } from './directorTypes'

describe('clips', () => {
  const a = createTrajectoryClip('a', 0, 2)
  const b = createTrajectoryClip('b', 3, 5)

  it('detects overlap and finds the first free slot after occupied ranges', () => {
    expect(clipsOverlap([a, b], 1, 2.5)).toBe(true)
    expect(clipsOverlap([a, b], 2, 3)).toBe(false)
    expect(findFreeStart([a, b], 1, 1, 60)).toBe(2)
    expect(findFreeStart([a, b], 1, 1.5, 60)).toBe(5)
    expect(findFreeStart([a, b], 1, 4, 8)).toBeNull()
  })

  it('bounds a clip between its neighbours', () => {
    const middle = createTrajectoryClip('m', 2.5, 2.8)
    expect(clipBounds([a, middle, b], 'm', 60)).toEqual({ minBound: 2, maxBound: 3 })
    expect(clipBounds([a], 'a', 60)).toEqual({ minBound: 0, maxBound: 60 })
  })

  it('assigns waypoints to clips by clipId first, then by time with shared-boundary rule', () => {
    const c = createTrajectoryClip('c', 2, 4)
    const tagged: Waypoint = { id: 'w', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, time: 9, frameIndex: 270, clipId: 'a' }
    const boundary: Waypoint = { id: 'w2', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, time: 2, frameIndex: 60 }
    expect(waypointBelongsToClip(tagged, a, [a, c])).toBe(true)
    expect(waypointBelongsToClip(boundary, a, [a, c])).toBe(true)
    expect(waypointBelongsToClip(boundary, c, [a, c])).toBe(false)
  })

  it('upserts a waypoint on the same frame and keeps the list sorted', () => {
    const waypoints: Waypoint[] = []
    let n = 0
    const makeId = () => `w${(n += 1)}`
    const first = upsertWaypointAt(waypoints, 1.5, { x: 1 }, makeId, 'a')
    const second = upsertWaypointAt(waypoints, 0.5, { x: 2 }, makeId, 'a')
    const same = upsertWaypointAt(waypoints, 1.5 + 1 / 90, { yaw: 30 }, makeId, 'a')
    expect(first.created).toBe(true)
    expect(second.created).toBe(true)
    expect(same.created).toBe(false)
    expect(same.point.id).toBe('w1')
    expect(same.point.yaw).toBe(30)
    expect(waypoints.map((waypoint) => waypoint.time)).toEqual([0.5, 1.5])
  })

  it('trims, splits and duplicates clips on the frame grid', () => {
    const clip = createTrajectoryClip('x', 0, 4)
    expect(trimClipToPlayhead(clip, 1, 'left')).toBe(true)
    expect(clip.startTime).toBe(1)
    expect(trimClipToPlayhead(clip, 1, 'left')).toBe(false)
    const right = splitClipAt(clip, 2.5, 'y')
    expect(right?.startTime).toBe(2.5)
    expect(clip.endTime).toBe(2.5)
    const copy = duplicateClipAfter(clip, [clip, right!], 'z', 60)
    expect(copy?.startTime).toBe(4)
    expect(copy?.endTime).toBe(5.5)
  })

  it('clamps a dragged waypoint between its neighbours by one frame', () => {
    const clip = createTrajectoryClip('k', 0, 3)
    const waypoints: Waypoint[] = [
      { id: 'p', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, time: 1, frameIndex: 30, clipId: 'k' },
      { id: 'q', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, time: 2, frameIndex: 60, clipId: 'k' },
      { id: 'r', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, time: 2.5, frameIndex: 75, clipId: 'k' },
    ]
    const bounds = waypointTimeBounds(waypoints, clip, 'q', 2)
    expect(bounds.minTime).toBeCloseTo(1 + 1 / 30)
    expect(bounds.maxTime).toBeCloseTo(2.5 - 1 / 30)
  })
})

describe('fitClipAt（点哪儿落哪儿）', () => {
  const clips = [{ id: 'a', startTime: 3.3, endTime: 6.3 }]
  it('整段塞得下就落在首选位置', () => {
    expect(fitClipAt(clips, 7, 2, 60)).toEqual({ start: 7, duration: 2 })
  })
  it('塞不下但空档够就缩短到空档', () => {
    const placed = fitClipAt(clips, 1, 4, 60)
    expect(placed?.start).toBe(1)
    expect(placed?.duration).toBeCloseTo(2.3)
  })
  it('首选位置在片段里就退到片段末尾', () => {
    expect(fitClipAt(clips, 4, 2, 60)).toEqual({ start: 6.3, duration: 2 })
  })
  it('空档太小就退到下一个空位', () => {
    expect(fitClipAt(clips, 3.1, 2, 60)).toEqual({ start: 6.3, duration: 2 })
  })
})
