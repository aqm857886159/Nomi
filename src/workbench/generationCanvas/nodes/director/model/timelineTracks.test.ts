import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './directorProject'
import type { DirectorCamera, DirectorObject } from './directorTypes'
import { buildTimelineTracks, entitiesOutsideTimeline, familyMarkerTimes, orderedTimelineEntities, sceneSplitPoints, stepToNeighbor } from './timelineTracks'

const labeler = {
  trajectory: (clip: { startFrame: number; endFrame: number }) => `path ${clip.startFrame}~${clip.endFrame}`,
  action: (clip: { name: string }) => clip.name,
  lookat: () => 'look',
  closeup: () => 'closeup',
}

function character(id: string, extra: Partial<DirectorObject> = {}): DirectorObject {
  return {
    id,
    name: id,
    type: 'character',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    locked: false,
    ...extra,
  }
}

function camera(id: string, extra: Partial<DirectorCamera> = {}): DirectorCamera {
  return { id, name: id, position: { x: 0, y: 1, z: 3 }, yaw: 0, pitch: 0, roll: 0, fov: 45, focalLengthMm: 29, ...extra }
}

describe('timelineTracks', () => {
  it('orders pinned tracks first, then timelineTrackOrder, then unregistered entities in scene order', () => {
    const scene = createDefaultProject('s').scenes[0]
    scene.objects = [character('a', { inTimeline: true }), character('b', { inTimeline: true }), character('c', { inTimeline: true }), character('d')]
    scene.cameras = [camera('cam', { inTimeline: true })]
    scene.timelineTrackOrder = ['cam', 'b']
    scene.timelineTrackPins = ['c']
    expect(orderedTimelineEntities(scene).map((entity) => entity.id)).toEqual(['c', 'cam', 'b', 'a'])
    expect(entitiesOutsideTimeline(scene).map((entity) => entity.id)).toEqual(['d'])
  })

  it('builds character sub-tracks (trajectory/action/bone/lookat) and camera sub-tracks (trajectory/closeup)', () => {
    const scene = createDefaultProject('s').scenes[0]
    scene.objects = [
      character('a', {
        inTimeline: true,
        trajectoryClips: [{ id: 't1', startTime: 0, endTime: 2, startFrame: 0, endFrame: 60 }],
        motionTrajectory: [{ id: 'w1', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, time: 0, frameIndex: 0, clipId: 't1' }],
        actionClips: [
          { id: 'p1', name: 'pose', clipType: 'custom_pose', startTime: 2, endTime: 3, startFrame: 60, endFrame: 90, keyframes: [{ id: 'k1', time: 2.5, frame: 75, boneRotations: {} }] },
        ],
        actionTrackEnabled: false,
      }),
    ]
    scene.cameras = [camera('cam', { inTimeline: true, closeupClips: [] })]
    const tracks = buildTimelineTracks(scene, labeler)
    expect(tracks.map((track) => track.kind)).toEqual(['character', 'camera'])
    const [a, cam] = tracks
    expect(a.subTracks.map((sub) => sub.family)).toEqual(['trajectory', 'action', 'bone', 'lookat'])
    expect(a.subTracks[0].clips[0].label).toBe('path 0~60')
    expect(a.subTracks[0].markers).toHaveLength(1)
    expect(a.subTracks[1].enabled).toBe(false)
    expect(a.subTracks[1].clips[0].tone).toBe('pose')
    expect(a.subTracks[2].markers[0]).toEqual({ id: 'k1', time: 2.5, clipId: 'p1' })
    expect(cam.subTracks.map((sub) => sub.family)).toEqual(['trajectory', 'closeup'])
  })

  it('exposes marker times, split points and neighbor stepping', () => {
    const scene = createDefaultProject('s').scenes[0]
    const a = character('a', {
      inTimeline: true,
      trajectoryClips: [{ id: 't1', startTime: 1, endTime: 3, startFrame: 30, endFrame: 90 }],
      motionTrajectory: [
        { id: 'w1', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, time: 1, frameIndex: 30, clipId: 't1' },
        { id: 'w2', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, time: 2, frameIndex: 60, clipId: 't1' },
      ],
    })
    scene.objects = [a]
    expect(familyMarkerTimes(a, 'trajectory')).toEqual([1, 2])
    expect(sceneSplitPoints(scene)).toEqual([1, 3])
    expect(stepToNeighbor([1, 2, 3], 2, 'next')).toBe(3)
    expect(stepToNeighbor([1, 2, 3], 2, 'prev')).toBe(1)
    expect(stepToNeighbor([1, 2, 3], 3, 'next')).toBeNull()
  })
})
