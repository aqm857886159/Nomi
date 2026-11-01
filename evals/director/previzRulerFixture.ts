/** Synthetic three-person street regression; no user project data. */
const scene = { environment: 'day', template: 'street', tags: ['街头', '追逐'] }
const shots = (first: Record<string, unknown> = {}) => [
  { id: 'chase_wide', window: [0, 3], transitionIn: 'cut', subject: 'thief', subjects: ['thief', 'police'], size: '全景', angle: 'front', height: 'eye', move: { kind: 'track_right' }, ...first },
  { id: 'trip_mid', window: [3, 6], transitionIn: 'cut', subject: 'thief', subjects: ['thief', 'passerby'], size: '中景', angle: 'side', height: 'eye', move: { kind: 'static' } },
  { id: 'catch_close', window: [6, 9], transitionIn: 'cut', subject: 'police', subjects: ['police', 'thief'], size: '中近景', angle: 'three_quarter', height: 'low', move: { kind: 'push_in', speed: 'slow' } },
]
const blocking = [
  { actor: 'thief', verb: 'run_to', target: 's1-street-road-left', window: [0, 3] },
  { actor: 'police', verb: 'chase', target: 'thief', window: [0, 3] },
  { actor: 'passerby', verb: 'sidestep', target: 'thief', window: [2, 3] },
  { actor: 'thief', verb: 'stop', window: [3, 6], action: 'fall' },
  { actor: 'police', verb: 'run_to', target: 'thief', window: [6, 9] },
]

export const PREVIZ_RULER_PLAN = { scene, actors: [
  { id: 'police', kind: 'person', desc: '警察', placement: { relation: 'at', ref: 's1-street-ground' } },
  { id: 'thief', kind: 'person', desc: '犯人', placement: { relation: 'in_front_of', ref: 'police' } },
  { id: 'passerby', kind: 'person', desc: '路人', placement: { relation: 'near', ref: 's1-street-building-right' } },
], blocking, shots: shots() }


import { createDefaultProject } from '../../src/workbench/generationCanvas/nodes/director/model/directorProject'
import type { DirectorObject } from '../../src/workbench/generationCanvas/nodes/director/model/directorTypes'

/** yaw=0 looks along +Z, so screen right is world -X. The subject stays still. */
export function rightTrackProject(yaw = 0, sign = 1) {
  const project = createDefaultProject('screen-right-ruler')
  const scene = project.scenes[0]
  const r = yaw * Math.PI / 180
  const start = { x: -20 * Math.sin(r), y: 1, z: -20 * Math.cos(r) }
  const end = { x: start.x - 2 * Math.cos(r) * sign, y: 1, z: start.z + 2 * Math.sin(r) * sign }
  scene.objects = [{ id: 'hero', name: 'hero', type: 'character', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, locked: false } satisfies DirectorObject]
  scene.cameras = [{
    id: 'camera', name: 'camera', position: start, yaw, pitch: 0, roll: 0, fov: 45, focalLengthMm: 0,
    motionTrajectory: [start, end].map((pos, index) => ({ ...pos, id: `point-${index}`, time: index * 2, frameIndex: index * 60, yaw, pitch: 0, roll: 0 })),
    trajectoryClips: [{ id: 'camera-clip', startTime: 0, endTime: 2, startFrame: 0, endFrame: 60 }],
  }]
  scene.timelineTrackOrder = ['camera']
  return project
}
